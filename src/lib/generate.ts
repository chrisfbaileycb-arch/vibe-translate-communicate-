import type { GeneratedCode, IntentModel, TargetId } from './types.ts';
import { findProp, propNumber } from './types.ts';
import { classifyCommand, worstLevel } from './safety.ts';
import { ensureWorkflow, NODE_TYPE_LABEL, topoOrder } from './workflow.ts';

/** Emits code lines while remembering which intent node each line came from. */
class CodeBuilder {
  private lines: { text: string; node?: string }[] = [];

  push(text = '', node?: string): this {
    this.lines.push({ text, node });
    return this;
  }

  block(lines: [string, string?][]): this {
    for (const [text, node] of lines) this.push(text, node);
    return this;
  }

  build(filename: string, language: string): GeneratedCode {
    const lineMap: Record<string, { start: number; end: number }[]> = {};
    this.lines.forEach((line, i) => {
      if (!line.node) return;
      const n = i + 1;
      const ranges = lineMap[line.node] ?? (lineMap[line.node] = []);
      const last = ranges[ranges.length - 1];
      if (last && last.end === n - 1) last.end = n;
      else ranges.push({ start: n, end: n });
    });
    return { filename, language, code: this.lines.map((l) => l.text).join('\n'), lineMap };
  }
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);
const num = (m: IntentModel, key: string, fallback: number): number => propNumber(m, key, fallback);
const str = (m: IntentModel, key: string, fallback = ''): string => {
  const p = findProp(m, key);
  return p ? String(p.value) : fallback;
};

const flagged = (m: IntentModel, key: string): boolean =>
  m.warnings.some((w) => w.propKey === key && (w.severity === 'warn' || w.severity === 'error'));

const flagFor = (m: IntentModel, key: string): string => (flagged(m, key) ? ' flagged' : '');
const badgeFor = (m: IntentModel, key: string): string => (flagged(m, key) ? '<span class="badge">!</span>' : '');

/** Every rendered part is focusable/clickable so the pixel -> syntax link works with a mouse, a keyboard or a screen reader. */
function nodeAttrs(key: string, label: string): string {
  return `data-node-id="${key}" role="button" tabindex="0" aria-label="${escapeHtml(label)}"`;
}

/* ---------------------------------- visual scene ---------------------------------- */

const SCENE_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  background: radial-gradient(120% 120% at 20% 0%, #f8fafc 0%, #eef2f7 55%, #e2e8f0 100%); color: #0f172a; }
.scene { position: relative; width: 100%; height: 100vh; min-height: 360px; overflow: hidden; }
.floor { position: absolute; left: 4%; right: 4%; bottom: 58px; height: 2px;
  background: linear-gradient(90deg, transparent, #94a3b8 12%, #94a3b8 88%, transparent); }
.floor::after { content: "floor"; position: absolute; right: 0; top: 8px; font-size: 11px; letter-spacing: .12em;
  text-transform: uppercase; color: #94a3b8; }
.ref { position: absolute; left: 6%; right: 6%; border-top: 1.5px dashed #38bdf8; pointer-events: none; }
.ref span { position: absolute; right: 0; top: -20px; font-size: 11px; color: #0284c7; letter-spacing: .04em; }
.table-wrap { position: absolute; left: 50%; transform: translateX(-50%); }
.top { position: absolute; top: 0; left: 0; background: linear-gradient(180deg, #d7b98c, #b98f5c);
  border: 1px solid #8a6437; box-shadow: 0 10px 18px rgba(15, 23, 42, .18); }
.leg { position: absolute; background: linear-gradient(90deg, #a97b46, #8a5f33); border: 1px solid #6f4b26;
  border-radius: 3px 3px 2px 2px; }
.dim-h { position: absolute; left: 0; text-align: center; font-size: 12px; color: #334155;
  border-top: 1px solid #64748b; padding-top: 4px; }
.dim-h::before, .dim-h::after { content: ""; position: absolute; top: -4px; width: 1px; height: 7px; background: #64748b; }
.dim-h::before { left: 0; } .dim-h::after { right: 0; }
.dim-v { position: absolute; font-size: 12px; color: #334155; border-left: 1px solid #64748b; padding-left: 8px;
  display: flex; align-items: center; }
.badge { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px;
  border-radius: 50%; background: #f59e0b; color: #fff; font-size: 10px; font-weight: 700; margin-left: 5px;
  vertical-align: middle; }
.flagged { outline: 1.5px dashed #f59e0b; outline-offset: 4px; border-radius: 4px; }
.stage-label { position: absolute; left: 18px; top: 16px; font-size: 11px; letter-spacing: .16em;
  text-transform: uppercase; color: #64748b; }
.caption { position: absolute; left: 18px; bottom: 18px; font-size: 12px; color: #475569; max-width: 62%; line-height: 1.5; }
[data-node-id] { cursor: pointer; }
[data-node-id]:hover { filter: brightness(1.06); }
.picked { outline: 2px solid #2563eb !important; outline-offset: 4px; }
.btn-scene { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 26px; }
.min-target { border: 1.5px dashed #94a3b8; padding: 8px; border-radius: 10px; }
.ui-button { display: inline-flex; align-items: center; justify-content: center; color: #fff;
  font-weight: 600; letter-spacing: .01em; border: none; }
.spec-list { font-size: 12px; color: #475569; display: grid; grid-template-columns: auto auto; gap: 4px 14px; }
.spec-list b { color: #0f172a; font-weight: 600; }
.box-scene { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.box3d { background: linear-gradient(160deg, #cbd5e1, #94a3b8); border: 1px solid #64748b; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; color: #1e293b; font-size: 13px; text-align: center;
  box-shadow: 0 18px 30px rgba(15, 23, 42, .18); }
`;

function pushTableScene(b: CodeBuilder, m: IntentModel): void {
  const width = num(m, 'top.width', 48);
  const length = num(m, 'top.length', 48);
  const thickness = num(m, 'top.thickness', 1.5);
  const legHeight = num(m, 'legs.height', 30);
  const legThickness = num(m, 'legs.thickness', 2);
  const legCount = Math.max(1, Math.round(num(m, 'legs.count', 4)));
  const shape = str(m, 'top.shape', 'rectangular');
  const roundish = shape === 'round' || shape === 'oval';

  const scale = Math.max(0.8, Math.min(6, 420 / Math.max(width, 1), 250 / Math.max(legHeight, 1)));
  const topW = Math.round(width * scale);
  const topT = Math.max(7, Math.round(thickness * scale * 1.6));
  const legH = Math.round(legHeight * scale);
  const legT = Math.max(4, Math.round(legThickness * scale));
  const wrapH = topT + legH;
  const refY = Math.round(60 + 30 * scale);

  b.push(`    <!-- semantic model: ${m.kind} | each element carries data-node-id for two-way binding -->`);
  b.push('    <div class="scene">');
  b.push('      <div class="stage-label">visual verifier &middot; scratch render</div>');
  b.push('      <div class="floor"></div>');
  if (m.kind === 'furniture/table') {
    b.push(`      <div class="ref" style="bottom:${refY}px"><span>standard desk height 30&quot;</span></div>`);
  }
  b.push(
    `      <div class="table-wrap" style="width:${topW}px;height:${wrapH}px;bottom:60px">`,
    'top.width',
  );
  b.push(
    `        <div class="top${flagFor(m, 'top.width')}" ${nodeAttrs('top.width', `Top width ${fmt(width)} inches`)} style="width:${topW}px;height:${topT}px;${roundish ? `border-radius:${Math.round(topW / 2)}px/${Math.round(topT * 1.4)}px;` : 'border-radius:6px;'}">${badgeFor(m, 'top.width')}${badgeFor(m, 'top.thickness')}</div>`,
    'top.width',
  );

  const usable = topW - legT;
  for (let i = 0; i < legCount; i++) {
    const x = legCount === 1 ? Math.round((topW - legT) / 2) : Math.round((usable * i) / (legCount - 1));
    b.push(
      `        <div class="leg${flagFor(m, 'legs.height')}" ${nodeAttrs('legs.height', `Leg height ${fmt(legHeight)} inches`)} style="height:${legH}px;width:${legT}px;left:${x}px;top:${topT}px;"></div>`,
      'legs.height',
    );
  }
  b.push(
    `        <div class="dim-h" ${nodeAttrs('top.width', `Top width ${fmt(width)} inches`)} style="top:${wrapH + 12}px;width:${topW}px">${fmt(width)}&quot; wide ${badgeFor(m, 'top.width')}</div>`,
    'top.width',
  );
  b.push(
    `        <div class="dim-v${flagFor(m, 'legs.height')}" ${nodeAttrs('legs.height', `Leg height ${fmt(legHeight)} inches`)} style="left:-64px;top:${topT}px;height:${legH}px;justify-content:center;">${fmt(legHeight)}&quot; tall${badgeFor(m, 'legs.height')}</div>`,
    'legs.height',
  );
  b.push('      </div>');
  b.push(
    `      <div class="caption">${m.label}: ${fmt(width)}&quot; x ${fmt(length)}&quot; top, ${fmt(thickness)}&quot; thick, ${legCount} legs at ${fmt(legHeight)}&quot;. Click any part to select its source node.</div>`,
  );
  b.push('    </div>');
}

function pushButtonScene(b: CodeBuilder, m: IntentModel): void {
  const width = num(m, 'width', 160);
  const height = num(m, 'height', 48);
  const radius = num(m, 'radius', 8);
  const color = str(m, 'color', 'blue');
  const label = str(m, 'label', 'Button');
  const fill = /^#/.test(color) ? color : `var(--c, ${color})`;

  b.push('    <div class="btn-scene">');
  b.push('      <div class="stage-label">visual verifier &middot; scratch render</div>');
  b.push(`      <div class="min-target" ${nodeAttrs('height', 'Minimum tap target 44 by 44 pixels')} title="44x44px minimum tap target">`);
  b.push(
    `        <button class="ui-button${flagFor(m, 'height')}" ${nodeAttrs('height', `Button ${fmt(width)} by ${fmt(height)} pixels`)} style="width:${fmt(width)}px;height:${fmt(height)}px;border-radius:${fmt(radius)}px;background:${fill};">${escapeHtml(label)}${badgeFor(m, 'height')}</button>`,
    'height',
  );
  b.push('      </div>');
  b.push('      <div class="spec-list">');
  b.push(`        <b>Width</b><span ${nodeAttrs('width', 'Width')}>${fmt(width)}px</span>`, 'width');
  b.push(`        <b>Height</b><span ${nodeAttrs('height', 'Height')}>${fmt(height)}px</span>`, 'height');
  b.push(`        <b>Radius</b><span ${nodeAttrs('radius', 'Corner radius')}>${fmt(radius)}px</span>`, 'radius');
  b.push(`        <b>Fill</b><span ${nodeAttrs('color', 'Fill colour')}>${escapeHtml(color)}</span>`, 'color');
  b.push('      </div>');
  b.push('      <div class="caption">Dashed box = 44x44px minimum tap target. Click a part to select its source node.</div>');
  b.push('    </div>');
}

function pushBoxScene(b: CodeBuilder, m: IntentModel): void {
  const width = num(m, 'width', 240);
  const height = num(m, 'height', 160);
  const depth = num(m, 'depth', 40);
  const count = Math.max(1, Math.round(num(m, 'count', 1)));
  const w = Math.min(420, Math.round(width));
  const h = Math.min(240, Math.round(height));

  b.push('    <div class="box-scene">');
  b.push('      <div class="stage-label">visual verifier &middot; scratch render</div>');
  b.push(
    `      <div class="box3d" ${nodeAttrs('width', `${m.label} dimensions`)} style="width:${w}px;height:${h}px;">${escapeHtml(m.label)}<br>${fmt(width)} x ${fmt(height)} x ${fmt(depth)}</div>`,
    'width',
  );
  b.push(`      <div class="caption" ${nodeAttrs('count', 'Count')}>Count: ${count}. Click the block to select its source node.</div>`, 'count');
  b.push('    </div>');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/* ---------------------------------- targets ---------------------------------- */

function generateHtml(m: IntentModel): GeneratedCode {
  const b = new CodeBuilder();
  b.push('<!doctype html>');
  b.push('<html lang="en">');
  b.push('<head>');
  b.push('  <meta charset="utf-8" />');
  b.push('  <meta name="viewport" content="width=device-width, initial-scale=1" />');
  b.push(`  <title>${escapeHtml(m.label)} &middot; generated</title>`);
  b.push('  <style>');
  for (const line of SCENE_CSS.split('\n')) b.push(`  ${line}`);
  b.push('  </style>');
  b.push('</head>');
  b.push('<body>');
  if (m.kind === 'ui/button') pushButtonScene(b, m);
  else if (m.kind === 'furniture/table' || m.kind === 'furniture/chair') pushTableScene(b, m);
  else pushBoxScene(b, m);
  b.push('</body>');
  b.push('</html>');
  return b.build(`${slug(m.label)}.html`, 'html');
}

function generateNextjs(m: IntentModel): GeneratedCode {
  const b = new CodeBuilder();
  const iface = `${m.label.replace(/\s+/g, '')}Spec`;
  b.push(`'use client';`);
  b.push('');
  b.push(`// Generated from the semantic model "${m.kind}".`);
  b.push(`// Each property keeps its nodeId so the visual verifier can highlight its source.`);
  b.push('');
  b.push(`export interface ${iface} {`);
  for (const p of m.props) {
    const tsType = typeof p.value === 'number' ? 'number' : typeof p.value === 'boolean' ? 'boolean' : 'string';
    const opts = p.options ? ` // one of: ${p.options.join(' | ')}` : '';
    b.push(`  /** ${p.label}${p.unit ? ` (${p.unit})` : ''} — nodeId: ${p.nodeId} */`, p.nodeId);
    b.push(`  ${camel(p.key)}: ${tsType};${opts}`, p.nodeId);
  }
  b.push('}');
  b.push('');
  b.push(`export const default${iface}: ${iface} = {`);
  for (const p of m.props) {
    const literal = typeof p.value === 'number' ? fmt(p.value) : `'${String(p.value).replace(/'/g, "\\'")}'`;
    b.push(`  ${camel(p.key)}: ${literal},`, p.nodeId);
  }
  b.push('};');
  b.push('');
  b.push(`export function validate${m.label.replace(/\s+/g, '')}(spec: ${iface}): string[] {`);
  b.push('  const warnings: string[] = [];');
  for (const w of m.warnings) {
    b.push(`  // ${w.severity.toUpperCase()}: ${w.message.replace(/`/g, "'")}`);
    b.push(`  warnings.push('${w.message.replace(/'/g, "\\'")}');`);
  }
  b.push('  return warnings;');
  b.push('}');
  b.push('');
  b.push(`export default function ${m.label.replace(/\s+/g, '')}(spec: Partial<${iface}> = {}) {`);
  b.push(`  const s = { ...default${iface}, ...spec };`);
  b.push('  return (');
  b.push(`    <section data-node-id="${m.props[0]?.nodeId ?? 'root'}" aria-label="${escapeHtml(m.label)}">`);
  for (const p of m.props.slice(0, 4)) {
    b.push(`      <span data-node-id="${p.nodeId}">{s.${camel(p.key)}}${p.unit ?? ''}</span>`, p.nodeId);
  }
  b.push('    </section>');
  b.push('  );');
  b.push('}');
  return b.build(`${m.label.replace(/\s+/g, '')}.tsx`, 'typescript');
}

function generatePython(m: IntentModel): GeneratedCode {
  const b = new CodeBuilder();
  const cls = m.label.replace(/\s+/g, '');
  b.push('"""Generated from the semantic model — run locally: python ' + slug(m.label) + '.py"""');
  b.push('from dataclasses import dataclass, field');
  b.push('from typing import List');
  b.push('');
  b.push('');
  b.push('@dataclass');
  b.push(`class ${cls}:`);
  for (const p of m.props) {
    const pyType = typeof p.value === 'number' ? 'float' : typeof p.value === 'boolean' ? 'bool' : 'str';
    const literal = typeof p.value === 'number' ? fmt(p.value) : `'${String(p.value).replace(/'/g, "\\'")}'`;
    b.push(`    ${snake(p.key)}: ${pyType} = ${literal}  # ${p.label}${p.unit ? ` (${p.unit})` : ''} [nodeId=${p.nodeId}]`, p.nodeId);
  }
  b.push('');
  b.push('    def validate(self) -> List[str]:');
  b.push('        warnings: List[str] = []');
  for (const w of m.warnings) {
    b.push(`        # ${w.severity.toUpperCase()}: ${w.message.replace(/'/g, '')}`);
    b.push(`        warnings.append('${w.message.replace(/'/g, '')}')`);
  }
  b.push('        return warnings');
  b.push('');
  b.push('    def draw(self):');
  b.push('        """Wireframe render — matplotlib, no external assets."""');
  b.push('        import matplotlib.pyplot as plt');
  b.push('        from mpl_toolkits.mplot3d.art3d import Poly3DCollection');
  b.push('        fig = plt.figure()');
  b.push('        ax = fig.add_subplot(111, projection="3d")');
  if (m.kind === 'furniture/table' || m.kind === 'furniture/chair') {
    b.push('        w, l, h, t = self.top_width, self.top_length, self.legs_height, self.top_thickness', 'top.width');
    b.push('        top = [[0, 0, h], [w, 0, h], [w, l, h], [0, l, h]]', 'top.width');
    b.push('        ax.add_collection3d(Poly3DCollection([top], alpha=0.6, facecolor="#d7b98c"))');
    b.push('        for x, y in [(0, 0), (w, 0), (w, l), (0, l)]:');
    b.push('            ax.plot([x, x], [y, y], [0, h], color="#8a5f33", linewidth=3)', 'legs.height');
    b.push('        ax.set_xlim(0, max(w, 1)); ax.set_ylim(0, max(l, 1)); ax.set_zlim(0, max(h, 1) * 1.2)');
  } else {
    b.push('        ax.bar3d(0, 0, 0, self.width, self.depth, self.height, alpha=0.6)');
  }
  b.push('        plt.show()');
  b.push('');
  b.push('');
  b.push(`item = ${cls}()`);
  b.push('for message in item.validate():');
  b.push('    print("!", message)');
  b.push('item.draw()');
  return b.build(`${slug(m.label)}.py`, 'python');
}

function generateTypescript(m: IntentModel): GeneratedCode {
  const b = new CodeBuilder();
  const iface = `${m.label.replace(/\s+/g, '')}Spec`;
  b.push(`// Semantic contract for "${m.kind}" — this is the layer humans and AI both read.`);
  b.push('');
  b.push(`export interface ${iface} {`);
  for (const p of m.props) {
    const tsType = typeof p.value === 'number' ? 'number' : typeof p.value === 'boolean' ? 'boolean' : 'string';
    b.push(`  ${camel(p.key)}: ${tsType}; // ${p.label}${p.unit ? ` (${p.unit})` : ''} -> ${p.nodeId}`, p.nodeId);
  }
  b.push('}');
  b.push('');
  b.push(`export const defaults: ${iface} = {`);
  for (const p of m.props) {
    const literal = typeof p.value === 'number' ? fmt(p.value) : `'${String(p.value).replace(/'/g, "\\'")}'`;
    b.push(`  ${camel(p.key)}: ${literal},`, p.nodeId);
  }
  b.push('};');
  b.push('');
  b.push(`export const constraints = ${JSON.stringify(
    m.warnings.map((w) => ({ id: w.id, severity: w.severity, prop: w.propKey, message: w.message })),
    null,
    2,
  )} as const;`);
  return b.build(`${slug(m.label)}.ts`, 'typescript');
}

function generateJson(m: IntentModel): GeneratedCode {
  const b = new CodeBuilder();
  const json = JSON.stringify(m, null, 2);
  json.split('\n').forEach((line) => {
    const keyMatch = line.match(/"key": "([^"]+)"/);
    b.push(line, keyMatch?.[1]);
  });
  return b.build(`${slug(m.label)}.intent.json`, 'json');
}

function generateShell(m: IntentModel): GeneratedCode {
  const b = new CodeBuilder();
  const graph = ensureWorkflow(m, `${slug(m.label)}.json`);
  const { order } = topoOrder(graph);
  const safety = new Map(order.filter((n) => n.command).map((n) => [n.id, classifyCommand(n.command!)]));
  const overall = worstLevel([...safety.values()].map((s) => s.level));
  b.push('#!/usr/bin/env sh');
  b.push(`# ${m.label} — generated by LinguaCode${m.sourceText ? ` from: "${m.sourceText.replace(/\n/g, ' ')}"` : ''}`);
  b.push(`# Safety: ${overall.toUpperCase()} — review every step before running.`);
  b.push('set -eu');
  if (overall === 'destructive') {
    b.push('');
    b.push('# Destructive steps run only after an explicit yes (or LC_CONFIRM=yes for CI).');
    b.push('confirm() {');
    b.push('  [ "${LC_CONFIRM:-}" = "yes" ] && return 0');
    b.push('  printf "About to run: %s\\nType yes to continue: " "$1" >&2');
    b.push('  read -r answer && [ "$answer" = "yes" ] || { echo "Skipped." >&2; exit 1; }');
    b.push('}');
  }
  for (const node of order) {
    const level = safety.get(node.id)?.level;
    b.push('');
    b.push(`# [${node.id}] ${NODE_TYPE_LABEL[node.type]} · ${node.label}${level === 'destructive' ? '  !! DESTRUCTIVE' : ''}`, node.id);
    if (node.detail) b.push(`#   ${node.detail}`, node.id);
    if (!node.command) continue;
    if (level === 'destructive') b.push(`confirm ${shellQuote(node.command)}`, node.id);
    if (node.type === 'validator') {
      b.push(`${node.command} || { echo "validator ${node.id} failed: ${node.label.replace(/"/g, "'")}" >&2; exit 1; }`, node.id);
    } else {
      b.push(node.command, node.id);
    }
    if (node.command.endsWith("<<'EOF'")) {
      b.push(JSON.stringify(Object.fromEntries(m.props.map((p) => [p.key, p.value]))), node.id);
      b.push('EOF', node.id);
    }
  }
  b.push('');
  b.push('echo "workflow complete"');
  return b.build(`${slug(m.label)}.sh`, 'shell');
}

function generateWorkflow(m: IntentModel): GeneratedCode {
  const b = new CodeBuilder();
  const graph = ensureWorkflow(m, `${slug(m.label)}.tsx`);
  const { order } = topoOrder(graph);
  b.push('{');
  b.push(`  "workflow": ${JSON.stringify(m.label)},`);
  b.push('  "version": 1,');
  b.push('  "nodes": [');
  order.forEach((node, i) => {
    const entry = { ...node, safety: node.command ? classifyCommand(node.command).level : undefined };
    b.push(`    ${JSON.stringify(entry)}${i < order.length - 1 ? ',' : ''}`, node.id);
  });
  b.push('  ],');
  b.push('  "edges": [');
  graph.edges.forEach((edge, i) => {
    b.push(`    ${JSON.stringify(edge)}${i < graph.edges.length - 1 ? ',' : ''}`, edge.to);
  });
  b.push('  ]');
  b.push('}');
  return b.build(`${slug(m.label)}.dag.json`, 'json');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Exports and downloads the semantic IntentModel as a JSON file to the user's disk */
export function exportModelAsJson(model: IntentModel): { filename: string; json: string } {
  const filename = `${slug(model.label || 'semantic-model')}.intent.json`;
  const json = JSON.stringify(model, null, 2);
  if (typeof document !== 'undefined') {
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  return { filename, json };
}

export function generate(model: IntentModel, target: TargetId): GeneratedCode {
  switch (target) {
    case 'html':
      return generateHtml(model);
    case 'nextjs':
      return generateNextjs(model);
    case 'python':
      return generatePython(model);
    case 'typescript':
      return generateTypescript(model);
    case 'json':
      return generateJson(model);
    case 'shell':
      return generateShell(model);
    case 'workflow':
      return generateWorkflow(model);
  }
}

export function generatePreviewDoc(model: IntentModel): string {
  return generateHtml(model).code;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'generated';
}
function camel(key: string): string {
  return key.replace(/[_.](\w)/g, (_, c: string) => c.toUpperCase());
}
function snake(key: string): string {
  return key.replace(/[.\-]/g, '_');
}
