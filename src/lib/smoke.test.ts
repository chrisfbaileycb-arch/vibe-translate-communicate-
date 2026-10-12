/**
 * Smoke test for the pure logic layer (no React, no DOM).
 * Run: npm test   ->   node --experimental-strip-types src/lib/smoke.test.ts
 */
import { parseUtterance, parseCorrection } from './parse.ts';
import { lint } from './lint.ts';
import { generate, generatePreviewDoc } from './generate.ts';
import { reverseFromCode } from './reverse.ts';
import type { TargetId } from './types.ts';

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

console.log(`\n${passed} checks passed${runtime.process?.exitCode ? ' — WITH FAILURES' : ''}`);
