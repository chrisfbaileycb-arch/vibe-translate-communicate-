/**
 * Smoke test for the pure logic layer (no React, no DOM).
 * Run: npm test   ->   node --experimental-strip-types src/lib/smoke.test.ts
 */
import { parseUtterance, parseCorrection } from './parse.ts';
import { lint } from './lint.ts';
import { generate, generatePreviewDoc, exportModelAsJson } from './generate.ts';
import {
  codeToPictureDataUrl,
  looksLikeCode,
  reverseFromCode,
  reverseFromImageLocal,
  SAMPLE_REVERSE_IMAGES,
} from './reverse.ts';
import type { TargetId } from './types.ts';
import { classifyCommand } from './safety.ts';
import { appendWorkflowStep, buildWorkflowModel, ensureWorkflow, layoutGraph, looksLikeWorkflow, normalizeGraph } from './workflow.ts';
import { LocalRuleEngine, chatHeaders, isHuggingFaceEndpoint } from './engine.ts';
import { detectPresetForKey, keyPrefixWarning, presetForEndpoint, PROVIDER_PRESETS } from './vault.ts';
import { safetyNote, sanitizeCommand, translateShell, translateShellLocal } from './shell.ts';

let passed = 0;
const runtime = globalThis as { process?: { exitCode?: number } };
function ok(condition: boolean, name: string, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`ok   ${name}`);
  } else {
    console.error(`FAIL ${name} ${detail}`);
    if (runtime.process) runtime.process.exitCode = 1;
  }
}

// 1. speech -> semantic model, with the "2 inch legs" failure caught by the linter
const first = parseUtterance('Build a wooden table, 54 inch top, 2 inch legs', null, null);
ok(first.model.kind === 'furniture/table', 'detects a table');
const legHeight = first.model.props.find((p) => p.key === 'legs.height');
ok(legHeight?.value === 2, 'reads 2 inch legs literally', `got ${String(legHeight?.value)}`);
ok(first.model.warnings.some((w) => w.severity === 'error' && w.propKey === 'legs.height'), 'flags 2 inch legs as an ergonomic error');
ok(first.model.props.find((p) => p.key === 'material')?.value === 'wood', 'captures material');
ok(first.model.props.find((p) => p.key === 'top.width')?.value === 54, 'captures top width from the nearest word', `got ${String(first.model.props.find((p) => p.key === 'top.width')?.value)}`);

// 2. targeted correction mutates one node only
const corrected = parseCorrection('make the legs 29 inches', first.model, first.selection);
ok(corrected !== null, 'recognises a targeted correction');
ok(corrected?.model.props.find((p) => p.key === 'legs.height')?.value === 29, 'updates only the leg height');
ok(corrected?.model.props.find((p) => p.key === 'top.width')?.value === 54, 'leaves the top width alone');
ok(corrected?.changedKeys.length === 1, 'reports exactly one changed node');

// 3. selection + relative adjustment
const selected = parseUtterance('select the top width', corrected!.model, null);
ok(selected.selection === 'top.width', 'selection command resolves the node', `got ${String(selected.selection)}`);
const wider = parseUtterance('make it wider', selected.model, selected.selection);
ok(Number(wider.model.props.find((p) => p.key === 'top.width')?.value) > 54, 'relative correction widens the top');
ok(wider.model.props.find((p) => p.key === 'legs.height')?.value === 29, 'relative correction leaves other nodes alone');

// 4. all targets generate code with a usable line map
const model = wider.model;
for (const target of ['html', 'nextjs', 'python', 'typescript', 'json'] as TargetId[]) {
  const output = generate(model, target);
  ok(output.code.length > 200, `generates ${target} code`, `${output.code.length} chars`);
  ok(Object.keys(output.lineMap).length > 0, `${target} code has a node -> line map`);
}

// 5. the visual verifier is wired to the same node ids
const preview = generatePreviewDoc(model);
ok(preview.includes('data-node-id="legs.height"'), 'preview tags the legs with their node id');
ok(preview.includes('standard desk height'), 'preview shows the 30in reference line');
ok(lint(model).every((w) => w.severity !== 'error'), 'linter clears the error once the legs are fixed');
ok(!lint(model).some((w) => w.id === 'table.leg-height-under'), '29in sits inside the standard band');

// 6. reverse direction: code -> model + visual
const pyCode = ['class Table:', '    top_width = 48', '    leg_height = 2', '    top_thickness = 1.5', '    leg_count = 4'].join('\n');
const reversed = reverseFromCode(pyCode);
ok(reversed.renderKind === 'sketch', 'non-HTML source renders as a schematic');
ok(reversed.model.props.find((p) => p.key === 'legs.height')?.value === 2, 'reverse extraction reads leg_height');
ok((reversed.lineMap['legs.height'] ?? []).length === 1, 'reverse extraction keeps the source line');
ok(reversed.model.warnings.length > 0, 'reverse path runs the same constraint linter');

const htmlIn = '<html><body><div style="width:240px;height:120px;background:#2563eb">hello</div></body></html>';
const reversedHtml = reverseFromCode(htmlIn);
ok(reversedHtml.renderKind === 'html', 'HTML source is rendered exactly');
ok(reversedHtml.previewDoc.includes('hello'), 'HTML preview keeps the original markup');

// 6b. reverse React/TSX component (Hero section)
const heroCode = [
  '"use client"',
  'export function Hero({ eyebrow = "Innovate Without Limits", ctaLabel = "Explore Now" }) {',
  '  return <section className="h-[600px] pt-40"><h1>Title</h1></section>',
  '}'
].join('\n');
const reversedHero = reverseFromCode(heroCode);
ok(reversedHero.renderKind === 'html', 'React TSX component renders as live HTML');
ok(reversedHero.model.label === 'Hero', 'detects Hero component name');
ok(reversedHero.model.props.find((p) => p.key === 'eyebrow')?.value === 'Innovate Without Limits', 'extracts eyebrow default prop');
ok(reversedHero.model.props.find((p) => p.key === 'ctaLabel')?.value === 'Explore Now', 'extracts ctaLabel default prop');
ok(reversedHero.previewDoc.includes('tailwindcss'), 'embeds Tailwind CSS runtime in preview');

// 7. export semantic model as JSON
const exported = exportModelAsJson(model);
ok(exported.filename.endsWith('.intent.json'), 'exports with .intent.json extension');
ok(exported.json.includes(model.kind), 'exported json contains semantic model kind');
ok(JSON.parse(exported.json).props.length === model.props.length, 'exported json has matching props');

// 8. shell safety inspector
ok(classifyCommand('ls -la').level === 'safe', 'ls is read-only');
ok(classifyCommand('grep -rn "x" . | wc -l').level === 'safe', 'grep | wc is read-only');
ok(classifyCommand('curl -fsSL https://example.com').level === 'caution', 'curl is network (yellow)');
ok(classifyCommand('cp -r a b').level === 'caution', 'cp is a file write (yellow)');
ok(classifyCommand('echo hi > out.txt').level === 'caution', 'redirect overwrite is yellow');
ok(classifyCommand('rm -rf ./logs').level === 'destructive', 'rm -rf is red');
ok(classifyCommand('git push --force origin main').level === 'destructive', 'git push --force is red');
ok(classifyCommand('psql -c "DROP TABLE users;"').level === 'destructive', 'DROP TABLE is red');
ok(classifyCommand('find . -name "*.log" -delete').level === 'destructive', 'find -delete is red');
ok(classifyCommand('sudo ls').level === 'caution', 'sudo escalates to yellow');
ok(classifyCommand('frobnicate --all').level === 'caution', 'unknown commands are never green');
ok(classifyCommand('rm -rf x').flags.includes('-rf'), 'parses flags');

// 9. utterance -> workflow DAG
const wfText = 'Every night at 2am find old .log files in the logs folder, compress them, then delete old logs';
ok(looksLikeWorkflow(wfText), 'detects a workflow utterance');
ok(!looksLikeWorkflow('Build a wooden table, 48 inch top'), 'does not hijack object utterances');
const wf = buildWorkflowModel(wfText);
const wfNodes = wf.workflow!.nodes;
ok(wfNodes[0].type === 'trigger' && wfNodes[0].detail === 'cron: 0 2 * * *', 'first node is a cron trigger', JSON.stringify(wfNodes[0]));
ok(wfNodes.some((n) => n.type === 'transform' && n.command?.startsWith('tar')), 'compress becomes a tar transform');
ok(wfNodes.some((n) => n.command?.includes('-delete')), 'delete old becomes find -delete');
ok(wf.workflow!.edges.length === wfNodes.length - 1, 'linear chain of edges');
ok(wf.props.every((p) => wfNodes.some((n) => n.id === p.key)), 'every prop key is a node id');

const engine = new LocalRuleEngine();
const deploy = await engine.translate('When I say deploy, run the tests, then build, then push to main', null, null, 'shell');
ok(deploy.model.workflow?.nodes.map((n) => n.type).join(',') === 'trigger,validator,action,action', 'deploy pipeline node types', deploy.model.workflow?.nodes.map((n) => n.type).join(','));
ok(deploy.model.warnings.some((w) => w.propKey === 'step.4' && w.severity === 'warn'), 'git push is flagged as caution');
const appended = await engine.translate('then notify slack', deploy.model, null, 'shell');
ok(appended.model.workflow!.nodes.length === 5 && appended.selection === 'step.5', 'appends a step and selects it');
ok(appended.model.workflow!.nodes[4].destination === 'webhook', 'notify becomes a webhook action');
ok(deploy.model.workflow!.nodes.length === 4, 'append does not mutate the previous model');
ok(appendWorkflowStep(model, 'then x') === null, 'append ignores non-workflow models');

const risky = await engine.translate('when disk is full, delete the cache folder', null, null, 'workflow');
ok(risky.model.warnings.some((w) => w.severity === 'error' && w.id.endsWith('.destructive')), 'unguarded delete is an error');

// 10. shell + DAG generation keep the two-way node map
const sh = generate(deploy.model, 'shell');
ok(sh.filename.endsWith('.sh') && sh.code.startsWith('#!/usr/bin/env sh'), 'shell target emits a script');
ok(['step.1', 'step.2', 'step.3', 'step.4'].every((id) => sh.lineMap[id]?.length), 'every node maps to shell lines');
const riskySh = generate(risky.model, 'shell');
ok(riskySh.code.includes('confirm ') && riskySh.code.includes('LC_CONFIRM'), 'destructive steps are guarded by confirm');
const dag = generate(deploy.model, 'workflow');
const dagJson = JSON.parse(dag.code) as { nodes: { id: string }[]; edges: unknown[] };
ok(dagJson.nodes.length === 4 && dagJson.edges.length === 3, 'DAG target emits valid JSON');
ok(Object.keys(dag.lineMap).length === 4, 'every DAG node maps to code lines');
const tablePipeline = ensureWorkflow(first.model);
ok(tablePipeline.nodes.length === 4 && generate(first.model, 'shell').lineMap['pipe.validator'] !== undefined, 'object models get the translation pipeline');
const layout = layoutGraph(normalizeGraph({ nodes: [{ id: 'a', type: 'trigger' }, { id: 'b' }, { id: 'c' }], edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }] }));
ok(layout.nodes.find((n) => n.node.id === 'b')!.y === layout.nodes.find((n) => n.node.id === 'c')!.y, 'branches share a layer');

// 11. Hugging Face onramp
ok(detectPresetForKey('hf_abc123')?.endpoint === 'https://router.huggingface.co/v1', 'hf_ tokens map to the HF router');
ok(detectPresetForKey('sk-abc') === undefined, 'other keys are not auto-detected');
ok(isHuggingFaceEndpoint('https://router.huggingface.co/v1') && !isHuggingFaceEndpoint('https://api.openai.com/v1'), 'recognises the HF router endpoint');

// 12. voice -> one shell command + one safety line (Terminal Voice Companion)
const listCmd = translateShellLocal('list the files in the src folder');
ok(listCmd?.command === 'ls -la ./src' && listCmd.safety.level === 'safe', 'list files -> ls (green)', listCmd?.command);
ok(Boolean(listCmd?.note.startsWith('✓')), 'safe note is one green line');
const killCmd = translateShellLocal('kill whatever is running on port 3000');
ok(killCmd?.command === 'kill $(lsof -t -i:3000)' && killCmd.safety.level === 'destructive', 'kill port -> red', killCmd?.command);
const rmCmd = translateShellLocal('delete the node_modules folder');
ok(rmCmd?.command === 'rm -rf ./node_modules', 'delete folder -> rm -rf', rmCmd?.command);
ok(/^⛔ DESTRUCTIVE \(-rf\)/.test(rmCmd!.note) && !rmCmd!.note.includes('\n'), 'destructive note names the flag on one line', rmCmd?.note);
ok(translateShellLocal('push to main --force') !== null, 'force push maps');
ok(translateShellLocal('sing me a song') === null, 'non-shell requests are refused, not guessed');
ok(sanitizeCommand('```bash\n$ ls -la\n# comment\ngrep x f\n```') === 'ls -la && grep x f', 'LLM output collapses to one line');
ok(safetyNote(classifyCommand('curl https://x.io')).startsWith('⚠'), 'caution note');

const fakeFetch = (async (_url: string, init: { body: string }) => {
  const body = JSON.parse(init.body) as { response_format?: unknown };
  ok(body.response_format === undefined, 'HF router call omits response_format');
  return new Response(JSON.stringify({ choices: [{ message: { content: 'Sure! {"command": "rm -rf /tmp/x\\n"}' } }] }), { status: 200 });
}) as unknown as typeof fetch;
const remote = await translateShell('wipe tmp x', { id: 'remote', apiKey: 'hf_x', endpoint: 'https://router.huggingface.co/v1' }, fakeFetch);
ok(remote.command === 'rm -rf /tmp/x' && remote.safety.level === 'destructive', 'remote output is re-checked locally', remote.command);

// 13. direct BYOK inputs + OpenRouter protocol
ok(PROVIDER_PRESETS[0].endpoint === 'https://openrouter.ai/api/v1' && PROVIDER_PRESETS[0].defaultModel === 'qwen/qwen-2.5-coder-32b-instruct', 'OpenRouter is the default');
ok(presetForEndpoint('https://openrouter.ai/api/v1/')?.id === 'openrouter', 'chip derives from a typed URL (trailing slash ok)');
ok(presetForEndpoint('https://my-proxy.example/v1') === undefined, 'custom URLs are not forced onto a preset');
ok(detectPresetForKey('sk-or-v1-abc')?.id === 'openrouter', 'sk-or- keys prefill OpenRouter');
ok(keyPrefixWarning('sk-abc', 'https://openrouter.ai/api/v1') !== null, 'mismatched key gets a non-blocking warning');
ok(keyPrefixWarning('anything', 'https://my-proxy.example/v1') === null, 'custom endpoints accept any key');
const orHeaders = chatHeaders('https://openrouter.ai/api/v1', 'sk-or-x');
ok(orHeaders['HTTP-Referer'] === 'https://linguacode.app' && orHeaders['X-Title'] === 'LinguaCode', 'OpenRouter attribution headers');
ok(orHeaders.authorization === 'Bearer sk-or-x', 'standard bearer auth');
ok(!('X-Title' in chatHeaders('https://api.openai.com/v1', 'sk-x')), 'no OpenRouter headers elsewhere');
ok(classifyCommand('awk "{print $1}" f').level === 'safe', 'awk is green');
ok(classifyCommand('git commit -m wip').level === 'caution', 'git commit is yellow');
ok(classifyCommand('kill -9 1234').level === 'destructive', 'kill -9 is red');
ok(classifyCommand('psql -c "TRUNCATE logs"').level === 'destructive', 'truncate is red');

// 14. picture -> code reverse flow
ok(SAMPLE_REVERSE_IMAGES.length === 4, 'sample reverse pictures are available');
const revCard = reverseFromImageLocal(
  { width: 480, height: 320, primaryColor: '#38bdf8', backgroundColor: '#0f172a', sampleId: 'pricing-card' },
  '',
  'nextjs',
);
ok(revCard.model.kind === 'ui/card' && revCard.code.includes('ProPricingCard'), 'pricing card picture reverses to TSX code');
ok(Boolean(revCard.model.workflow?.nodes.length), 'reversed picture includes reverse workflow DAG');
const revPipe = reverseFromImageLocal(
  { width: 480, height: 320, primaryColor: '#38bdf8', backgroundColor: '#09101d', sampleId: 'cicd-pipeline' },
  '',
  'shell',
);
ok(revPipe.model.workflow?.nodes.length === 4 && revPipe.code.includes('#!/usr/bin/env sh'), 'pipeline diagram picture reverses to shell workflow');

// 15. code -> picture & workflow round-trip verification
const roundTripCard = reverseFromCode(revCard.code);
ok(
  roundTripCard.model.kind === 'ui/card' &&
    roundTripCard.model.props.find((p) => p.key === 'price')?.value === '$29/mo',
  'generated TSX card round-trips through reverseFromCode with intact props',
);
ok(
  Boolean(roundTripCard.model.workflow?.nodes.length) &&
    roundTripCard.model.workflow!.nodes.every((n) => (roundTripCard.lineMap[n.id]?.length ?? 0) > 0),
  'every workflow node in reversed TSX is bound to code lines in lineMap',
);
const roundTripShell = reverseFromCode(revPipe.code);
ok(
  roundTripShell.model.kind === 'workflow/pipeline' &&
    roundTripShell.model.workflow?.nodes.length === 4 &&
    (roundTripShell.lineMap['step.2']?.length ?? 0) > 0,
  'shell pipeline script reverses to workflow/pipeline model + DAG with lineMap bindings',
);
ok(
  codeToPictureDataUrl(roundTripCard.model).startsWith('data:image/svg+xml;utf8,') &&
    looksLikeCode(revCard.code),
  'codeToPictureDataUrl synthesizes valid SVG picture from reversed code',
);

console.log(`\n${passed} checks passed${runtime.process?.exitCode ? ' — WITH FAILURES' : ''}`);


