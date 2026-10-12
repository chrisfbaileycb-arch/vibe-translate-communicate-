import type {
  IntentModel,
  IntentProp,
  TargetId,
  WorkflowDestination,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeType,
} from './types.ts';
import { newId } from './types.ts';

/**
 * Workflow layer: utterance -> DAG of Trigger / Validator / Transform / Action nodes.
 * Each node is mirrored as an IntentProp whose key is the node id, so the semantic
 * panel, the canvas and the generated code all share one selection.
 * Linting lives in lint.ts (this module stays free of that import to avoid a cycle).
 */

export const WORKFLOW_KIND = 'workflow/pipeline';

export const NODE_TYPE_LABEL: Record<WorkflowNodeType, string> = {
  trigger: 'Trigger',
  validator: 'Validator',
  transform: 'Transform / LLM',
  action: 'Action',
};

export function isWorkflowTarget(target: TargetId | undefined): boolean {
  return target === 'shell' || target === 'workflow';
}

const STEP_SPLIT = /\s*(?:\band then\b|\bthen\b|\bafter that\b|\bfinally\b|\bnext\b|->|→|;|\n)\s*/i;
/** Inside an utterance already known to be a workflow, commas separate steps too. */
const CLAUSE_SPLIT = /\s*(?:,\s*(?:and\s+)?(?:then\s+)?|\band then\b|\bthen\b|\bafter that\b|\bfinally\b|\bnext\b|->|→|;|\n)\s*/i;
const TRIGGER_RE = /^(?:when(?:ever)?|on|every|each|at|once|after|if|whenever)\b|\b(?:cron|nightly|hourly|daily|weekly|schedule[d]?|on push|on commit|webhook arrives)\b/i;
const VALIDATOR_RE = /\b(?:check|validate|verify|ensure|confirm|make sure|lint|guard|approve|run (?:the )?tests?|test)\b/i;
const TRANSFORM_RE = /\b(?:summari[sz]e|translate|convert|transform|format|parse|extract|classify|generate|rewrite|compress|zip|archive|tar|llm|ai|embed)\b/i;

const SCHEDULE_PREFIX = /^((?:every|each)\s+(?:\w+)(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|(?:nightly|hourly|daily|weekly)(?:\s+at\s+\d{1,2}\s*(?:am|pm)?)?)\s+(.+)$/i;

/** Strong signals that an utterance describes a pipeline rather than an object. */
export function looksLikeWorkflow(text: string): boolean {
  if (/\b(?:pipeline|workflow|script|automation|automate|cron|shell|bash)\b/i.test(text)) return true;
  return TRIGGER_RE.test(text.trim()) && STEP_SPLIT.test(text) && text.split(STEP_SPLIT).length >= 2;
}

function classifyStep(text: string, index: number): WorkflowNodeType {
  if (index === 0 && TRIGGER_RE.test(text)) return 'trigger';
  if (VALIDATOR_RE.test(text)) return 'validator';
  if (TRANSFORM_RE.test(text)) return 'transform';
  return 'action';
}

function firstPath(text: string): string | null {
  const quoted = text.match(/["'`]([^"'`]+)["'`]/);
  if (quoted) return quoted[1];
  const path = text.match(/(?:~|\.{1,2})?\/[\w.\-/]+|\b[\w\-]+\.(?:log|txt|json|csv|sql|db|tar\.gz|zip|md|ts|js|py|sh)\b/);
  return path ? path[0] : null;
}

function firstUrl(text: string): string | null {
  return text.match(/https?:\/\/\S+/)?.[0] ?? null;
}

function cronFor(text: string): string | null {
  const at = text.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  const hour = at ? (Number(at[1]) % 12) + (at[2].toLowerCase() === 'pm' ? 12 : 0) : 2;
  if (/\bhourly|every hour\b/i.test(text)) return '0 * * * *';
  if (/\bweekly|every week\b/i.test(text)) return `0 ${hour} * * 0`;
  if (/\b(?:nightly|daily|every (?:day|night)|at \d)/i.test(text)) return `0 ${hour} * * *`;
  return null;
}

function extensionGlob(text: string): string | null {
  const ext = text.match(/(?:^|\s)\*?\.(\w{1,6})\b(?!\/)/)?.[1] ?? text.match(/\b(log|csv|json|txt|tmp)\s+files?\b/i)?.[1];
  return ext ? `*.${ext.toLowerCase()}` : null;
}

function directory(text: string): string | null {
  const dirName = text.toLowerCase().match(/\b(?:the\s+)?(\w+)\s+(?:folder|directory|dir)\b/)?.[1];
  return dirName ? `./${dirName}` : null;
}

interface CommandGuess {
  command: string;
  destination: WorkflowDestination;
}

/**
 * Best-effort, deterministic step -> POSIX command. Shown to the user, never executed by the app.
 * `context` is the whole utterance: "compress them" borrows the folder/extension named in an earlier step.
 */
export function guessCommand(text: string, type: WorkflowNodeType, context = text): CommandGuess | null {
  const t = text.toLowerCase();
  const path = firstPath(text) ?? directory(text) ?? firstPath(context) ?? directory(context);
  const url = firstUrl(text) ?? firstUrl(context);
  const table = (text.match(/\btable\s+["'`]?(\w+)/i) ?? context.match(/\btable\s+["'`]?(\w+)/i))?.[1] ?? 'records';
  const target = path;
  const glob = extensionGlob(text) ?? extensionGlob(context) ?? '*';

  if (type === 'trigger') return null;
  const port = t.match(/\bport\s+(\d{2,5})\b/)?.[1];
  if (/\b(?:kill|stop|free)\b/.test(t) && port) return { command: `kill $(lsof -t -i:${port})`, destination: 'terminal' };
  if (/\bkill\b/.test(t)) {
    const name = text.match(/\bkill\s+(?:the\s+|all\s+)?["'`]?([\w.\-]+)/i)?.[1] ?? 'PROCESS';
    return { command: `pkill -f ${name}`, destination: 'terminal' };
  }
  if (/\bgit\b/.test(t) && /\bstatus\b/.test(t)) return { command: 'git status', destination: 'terminal' };
  if (/\bgit\b/.test(t) && /\b(?:log|history|commits)\b/.test(t)) return { command: 'git log --oneline -n 20', destination: 'terminal' };
  if (/\bprocess(?:es)?\b/.test(t) && /\b(?:list|show|running)\b/.test(t)) return { command: 'ps aux', destination: 'terminal' };
  if (/\bdrop\b/.test(t)) return { command: `psql "$DATABASE_URL" -c "DROP TABLE ${table};"`, destination: 'db' };
  if (/\btruncate\b/.test(t)) return { command: `psql "$DATABASE_URL" -c "TRUNCATE TABLE ${table};"`, destination: 'db' };
  if (/\b(?:delete|remove|clean ?up|purge|wipe|clear)\b/.test(t)) {
    if (/\bold\b|\bolder than\b/.test(t)) return { command: `find ${target ?? '.'} -name "${glob}" -mtime +7 -delete`, destination: 'file' };
    return { command: `rm -rf ${target ?? `./${glob}`}`, destination: 'file' };
  }
  if (/\b(?:notify|alert|slack|discord|webhook|ping me|message)\b/.test(t)) {
    return { command: `curl -fsS -X POST -H 'content-type: application/json' -d '{"text":"workflow step done"}' "${url ?? '$WEBHOOK_URL'}"`, destination: 'webhook' };
  }
  if (/\b(?:download|fetch|pull from|call|get)\b/.test(t) && url) return { command: `curl -fsSL "${url}" -o ${path ?? 'download.out'}`, destination: 'file' };
  if (/\b(?:compress|zip|archive|tar)\b/.test(t)) return { command: `tar -czf archive.tar.gz ${target ?? glob}`, destination: 'file' };
  if (/\b(?:summari[sz]e|translate|classify|rewrite|llm|ai)\b/.test(t)) {
    return { command: `curl -fsS "$LLM_ENDPOINT/chat/completions" -H "authorization: Bearer $API_KEY" -d @prompt.json > ${path ?? 'summary.json'}`, destination: 'file' };
  }
  if (/\b(?:convert|transform|format|parse|extract)\b/.test(t)) return { command: `jq '.' ${path ?? 'input.json'}`, destination: 'terminal' };
  if (/\b(?:backup|back up|copy)\b/.test(t)) return { command: `cp -r ${target ?? '.'} ./backup/`, destination: 'file' };
  if (/\b(?:move|rename)\b/.test(t)) return { command: `mv ${target ?? './source'} ./destination/`, destination: 'file' };
  if (/\bsync\b/.test(t)) return { command: `rsync -av ${target ?? './src/'} ./mirror/`, destination: 'file' };
  if (/\b(?:create|touch|make)\b.*\bfile\b/.test(t)) return { command: `touch ${path ?? 'new-file.txt'}`, destination: 'file' };
  if (/\b(?:deploy|push|ship|release)\b/.test(t)) return { command: 'git push origin main', destination: 'terminal' };
  if (/\binstall\b/.test(t)) return { command: 'npm ci', destination: 'terminal' };
  if (/\btests?\b/.test(t)) return { command: 'npm test', destination: 'terminal' };
  if (/\bbuild\b/.test(t)) return { command: 'npm run build', destination: 'terminal' };
  if (/\bdisk\b/.test(t)) return { command: 'df -h', destination: 'terminal' };
  if (/\b(?:search|grep|look for)\b/.test(t)) {
    const needle = text.match(/["'`]([^"'`]+)["'`]/)?.[1] ?? 'TODO';
    return { command: `grep -rn "${needle}" .`, destination: 'terminal' };
  }
  if (/\b(?:find|locate)\b/.test(t)) return { command: `find ${target ?? '.'} -name "${glob}"`, destination: 'terminal' };
  if (/\bcount\b/.test(t)) return { command: `wc -l ${path ?? glob}`, destination: 'terminal' };
  if (/\b(?:read|show|print|cat)\b/.test(t) && path) return { command: `cat ${path}`, destination: 'terminal' };
  if (/\b(?:list|show)\b/.test(t)) return { command: `ls -la ${target ?? '.'}`, destination: 'terminal' };
  if (type === 'validator') {
    return { command: path ? `test -e ${path}` : `test -n "\${INPUT:-}"`, destination: 'terminal' };
  }
  return { command: `echo "TODO: ${text.replace(/"/g, "'")}"`, destination: 'terminal' };
}

function tidy(text: string): string {
  const clean = text.replace(/^(?:and|then|also|please)\s+/i, '').replace(/[.,!]+$/, '').trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function makeNode(text: string, index: number, id: string, context = text): WorkflowNode {
  const type = classifyStep(text, index);
  const label = tidy(text);
  if (type === 'trigger') {
    const cron = cronFor(text);
    return { id, type, label, detail: cron ? `cron: ${cron}` : 'event' };
  }
  const guess = guessCommand(text, type, context);
  return { id, type, label, command: guess?.command, destination: guess?.destination };
}

function linear(nodes: WorkflowNode[]): WorkflowEdge[] {
  return nodes.slice(1).map((node, i) => ({ from: nodes[i].id, to: node.id }));
}

/** "When … , do A, then B" -> a trigger clause plus step clauses. */
function splitSteps(text: string): string[] {
  const clean = text.replace(/^(?:create|build|make|write)\s+(?:a|an)\s+(?:\w+\s+)?(?:pipeline|workflow|script)\s*(?:that|to|which|:)?\s*/i, '');
  const steps = clean.split(CLAUSE_SPLIT).flatMap((part, i) => {
    // "every night at 2am find old logs" -> schedule trigger + first step.
    const schedule = i === 0 ? part.match(SCHEDULE_PREFIX) : null;
    return schedule && schedule[2].trim() ? [schedule[1], schedule[2]] : [part];
  });
  return steps.map((s) => s.trim()).filter((s) => s.length > 1);
}

export function buildWorkflowGraph(text: string): WorkflowGraph {
  const steps = splitSteps(text);
  const nodes: WorkflowNode[] = [];
  if (steps.length === 0 || !TRIGGER_RE.test(steps[0])) {
    nodes.push({ id: 'step.1', type: 'trigger', label: 'Voice command', detail: 'mic' });
  }
  for (const step of steps) nodes.push(makeNode(step, nodes.length, `step.${nodes.length + 1}`, text));
  return { nodes, edges: linear(nodes) };
}

/** Workflow nodes as editable IntentProps: the command (or the label, for triggers) is the value. */
export function propsFromWorkflow(graph: WorkflowGraph, sourceText?: string): IntentProp[] {
  return graph.nodes.map((node) => ({
    key: node.id,
    nodeId: node.id,
    label: `${NODE_TYPE_LABEL[node.type]} · ${node.label}`,
    value: node.command ?? node.detail ?? node.label,
    confidence: node.command?.startsWith('echo "TODO') ? 0.4 : 0.75,
    source: sourceText ? node.label.toLowerCase() : undefined,
  }));
}

export function workflowModel(label: string, graph: WorkflowGraph, sourceText?: string): IntentModel {
  return {
    id: newId(),
    kind: WORKFLOW_KIND,
    label,
    props: propsFromWorkflow(graph, sourceText),
    warnings: [],
    sourceText,
    updatedAt: Date.now(),
    workflow: graph,
  };
}

function labelFor(text: string): string {
  const words = text
    .replace(/^(?:when(?:ever)?|every|on)\s+/i, '')
    .split(/[\s,]+/)
    .filter((w) => w.length > 2 && !/^(?:the|and|then|that|with|from|into)$/i.test(w))
    .slice(0, 3);
  const title = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return `${title || 'Untitled'} Pipeline`;
}

export function buildWorkflowModel(text: string): IntentModel {
  return workflowModel(labelFor(text), buildWorkflowGraph(text), text);
}

/** "then notify slack" on an existing workflow appends one node after the current sinks. */
export function appendWorkflowStep(model: IntentModel, text: string): IntentModel | null {
  if (!model.workflow) return null;
  const match = text.match(/^(?:and then|then|add (?:a )?step:?|after that|finally|next)\s+(.+)$/i);
  if (!match) return null;
  const graph = model.workflow;
  const id = `step.${graph.nodes.length + 1}`;
  const node = makeNode(match[1], graph.nodes.length, id, `${model.sourceText ?? ''} ${match[1]}`);
  const sinks = graph.nodes.filter((n) => !graph.edges.some((e) => e.from === n.id));
  graph.nodes.push(node);
  for (const sink of sinks) graph.edges.push({ from: sink.id, to: id });
  model.props = propsFromWorkflow(graph, model.sourceText);
  return model;
}

/** After a manual edit of a node prop, write the value back to the node. Mutates `model`. */
export function applyPropToWorkflow(model: IntentModel, key: string): void {
  const node = model.workflow?.nodes.find((n) => n.id === key);
  const prop = model.props.find((p) => p.key === key);
  if (!node || !prop) return;
  const value = String(prop.value);
  if (node.command !== undefined) node.command = value;
  else if (node.detail !== undefined) node.detail = value;
  else node.label = value;
}

/**
 * The workflow to show for a model. Non-workflow models get LinguaCode's own
 * translation pipeline, so the canvas is meaningful for any intent.
 */
export function ensureWorkflow(model: IntentModel, fileName = 'output'): WorkflowGraph {
  if (model.workflow) return model.workflow;
  const errors = model.warnings.filter((w) => w.severity === 'error').length;
  const nodes: WorkflowNode[] = [
    { id: 'pipe.trigger', type: 'trigger', label: 'Voice / text intent', detail: model.sourceText ? `"${model.sourceText}"` : 'mic' },
    {
      id: 'pipe.validator',
      type: 'validator',
      label: 'Domain constraint linter',
      detail: `${model.warnings.length} note(s), ${errors} error(s)`,
      command: `test ${errors} -eq 0`,
    },
    { id: 'pipe.transform', type: 'transform', label: `Semantic model → ${model.kind}`, detail: `${model.props.length} properties` },
    {
      id: 'pipe.action',
      type: 'action',
      label: `Write ${fileName}`,
      destination: 'file',
      command: `cat > ${fileName} <<'EOF'`,
    },
  ];
  return { nodes, edges: linear(nodes) };
}

/** Kahn's algorithm. Nodes on a cycle are appended at the end so nothing disappears. */
export function topoOrder(graph: WorkflowGraph): { order: WorkflowNode[]; cyclic: boolean } {
  const indegree = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) if (indegree.has(e.to) && indegree.has(e.from)) indegree.set(e.to, indegree.get(e.to)! + 1);
  const queue = graph.nodes.filter((n) => indegree.get(n.id) === 0);
  const order: WorkflowNode[] = [];
  while (queue.length) {
    const node = queue.shift()!;
    order.push(node);
    for (const e of graph.edges) {
      if (e.from !== node.id || !indegree.has(e.to)) continue;
      const next = indegree.get(e.to)! - 1;
      indegree.set(e.to, next);
      if (next === 0) queue.push(graph.nodes.find((n) => n.id === e.to)!);
    }
  }
  const cyclic = order.length < graph.nodes.length;
  if (cyclic) order.push(...graph.nodes.filter((n) => !order.includes(n)));
  return { order, cyclic };
}

export interface PositionedNode {
  node: WorkflowNode;
  x: number;
  y: number;
}

export interface GraphLayout {
  nodes: PositionedNode[];
  width: number;
  height: number;
  nodeWidth: number;
  nodeHeight: number;
}

/** Layered top-down layout: a node's row is the longest path from any source. */
export function layoutGraph(graph: WorkflowGraph): GraphLayout {
  const nodeWidth = 236;
  const nodeHeight = 58;
  const gapX = 28;
  const gapY = 42;
  const pad = 20;
  const { order } = topoOrder(graph);
  const layer = new Map<string, number>();
  for (const node of order) {
    const parents = graph.edges.filter((e) => e.to === node.id).map((e) => layer.get(e.from)).filter((l): l is number => l !== undefined);
    layer.set(node.id, parents.length ? Math.max(...parents) + 1 : 0);
  }
  const rows: WorkflowNode[][] = [];
  for (const node of order) (rows[layer.get(node.id)!] ??= []).push(node);
  const widest = Math.max(1, ...rows.map((r) => r.length));
  const width = pad * 2 + widest * nodeWidth + (widest - 1) * gapX;
  const nodes: PositionedNode[] = [];
  rows.forEach((row, r) => {
    const rowWidth = row.length * nodeWidth + (row.length - 1) * gapX;
    const startX = (width - rowWidth) / 2;
    row.forEach((node, c) => nodes.push({ node, x: startX + c * (nodeWidth + gapX), y: pad + r * (nodeHeight + gapY) }));
  });
  const height = pad * 2 + rows.length * nodeHeight + Math.max(0, rows.length - 1) * gapY;
  return { nodes, width, height, nodeWidth, nodeHeight };
}

/** Accepts the loosely-typed graph an LLM returns and makes it safe to render. */
export function normalizeGraph(raw: { nodes?: Partial<WorkflowNode>[]; edges?: Partial<WorkflowEdge>[] }): WorkflowGraph {
  const types: WorkflowNodeType[] = ['trigger', 'validator', 'transform', 'action'];
  const nodes: WorkflowNode[] = (raw.nodes ?? []).map((n, i) => ({
    id: n.id && /^[\w.\-]+$/.test(n.id) ? n.id : `step.${i + 1}`,
    type: types.includes(n.type as WorkflowNodeType) ? (n.type as WorkflowNodeType) : 'action',
    label: String(n.label ?? `Step ${i + 1}`),
    command: n.command ? String(n.command) : undefined,
    detail: n.detail ? String(n.detail) : undefined,
    destination: n.destination,
  }));
  const ids = new Set(nodes.map((n) => n.id));
  let edges: WorkflowEdge[] = (raw.edges ?? [])
    .filter((e): e is WorkflowEdge => typeof e.from === 'string' && typeof e.to === 'string' && ids.has(e.from) && ids.has(e.to))
    .map((e) => ({ from: e.from, to: e.to, label: e.label }));
  if (edges.length === 0 && nodes.length > 1) edges = linear(nodes);
  return { nodes, edges };
}
