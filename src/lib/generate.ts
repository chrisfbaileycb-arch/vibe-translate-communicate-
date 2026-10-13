import type { GeneratedCode, IntentModel, TargetId } from './types.ts';
import { findProp, propNumber } from './types.ts';
import { classifyCommand, worstLevel } from './safety.ts';
import { ensureWorkflow, NODE_TYPE_LABEL, topoOrder } from './workflow.ts';

/** Emits code lines while remembering which intent node(s) each line came from. */
class CodeBuilder {
  private lines: { text: string; nodes: string[] }[] = [];

  push(text = '', node?: string | (string | undefined)[]): this {
    const nodes = Array.isArray(node)
      ? node.filter((n): n is string => Boolean(n))
      : node
      ? [node]
      : [];
    this.lines.push({ text, nodes });
    return this;
  }

  block(lines: [string, (string | (string | undefined)[])?][]): this {
    for (const [text, node] of lines) this.push(text, node);
    return this;
  }

  build(filename: string, language: string): GeneratedCode {
    const lineMap: Record<string, { start: number; end: number }[]> = {};
    this.lines.forEach((line, i) => {
      if (line.nodes.length === 0) return;
      const n = i + 1;
      for (const nodeId of line.nodes) {
        const ranges = lineMap[nodeId] ?? (lineMap[nodeId] = []);
        const last = ranges[ranges.length - 1];
        if (last && last.end === n - 1) last.end = n;
        else ranges.push({ start: n, end: n });
      }
    });
    return { filename, language, code: this.lines.map((l) => l.text).join('\n'), lineMap };
  }
}

function workflowStageIds(m: IntentModel, fileName: string) {
  const wf = ensureWorkflow(m, fileName);
  const triggerId = wf.nodes.find((n) => n.type === 'trigger')?.id ?? wf.nodes[0]?.id;
  const validatorId = wf.nodes.find((n) => n.type === 'validator')?.id ?? wf.nodes[1]?.id;
  const transformId = wf.nodes.find((n) => n.type === 'transform')?.id ?? wf.nodes[2]?.id;
  const actionId = wf.nodes.find((n) => n.type === 'action')?.id ?? wf.nodes[wf.nodes.length - 1]?.id;
  return { triggerId, validatorId, transformId, actionId };
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

function pushUiSurfaceScene(b: CodeBuilder, m: IntentModel): void {
  const title = str(m, 'title', m.label || 'Component Title');
  const subtitle = str(m, 'subtitle', 'Reverse-engineered semantic interface with live two-way binding.');
  const badge = str(m, 'badge', str(m, 'eyebrow', 'REVERSED FROM PICTURE'));
  const ctaLabel = str(m, 'ctaLabel', 'Get Started');
  const price = str(m, 'price', '');
  const primaryColor = str(m, 'primaryColor', '#38bdf8');
  const bgColor = str(m, 'backgroundColor', '#0f172a');
  const width = num(m, 'width', 520);
  const radius = num(m, 'radius', 16);

  const badgeKey = findProp(m, 'badge') ? 'badge' : findProp(m, 'eyebrow') ? 'eyebrow' : 'title';

  b.push('    <div class="box-scene" style="background:radial-gradient(120% 120% at 50% 0%, #0f172a 0%, #020617 100%);color:#f8fafc;padding:32px;">');
  b.push('      <div class="stage-label" style="color:#94a3b8;">visual verifier &middot; reversed UI surface (1280px desktop stage)</div>');
  b.push(
    `      <div ${nodeAttrs('width', `Container width ${fmt(width)}px`)} style="width:100%;max-width:${fmt(Math.max(320, width))}px;background:${escapeHtml(bgColor)};border:1px solid rgba(148,163,184,0.22);border-radius:${fmt(radius)}px;padding:36px;box-shadow:0 28px 60px rgba(0,0,0,0.55);display:flex;flex-direction:column;gap:18px;">`,
    'width',
  );
  b.push(
    `        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">`,
  );
  b.push(
    `          <span ${nodeAttrs(badgeKey, `Badge: ${badge}`)} style="display:inline-flex;align-items:center;padding:5px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;background:rgba(56,189,248,0.14);color:${escapeHtml(primaryColor)};border:1px solid ${escapeHtml(primaryColor)}44;">${escapeHtml(badge)}</span>`,
    badgeKey,
  );
  b.push(
    `          <span ${nodeAttrs('radius', `Corner radius ${fmt(radius)}px`)} style="font-size:11px;color:#64748b;font-family:monospace;">r=${fmt(radius)}px &middot; w=${fmt(width)}px</span>`,
    'radius',
  );
  b.push('        </div>');
  b.push(
    `        <h1 ${nodeAttrs('title', `Title: ${title}`)} style="margin:0;font-size:32px;line-height:1.15;font-weight:800;letter-spacing:-0.02em;color:#f8fafc;">${escapeHtml(title)}</h1>`,
    'title',
  );
  if (price) {
    b.push(
      `        <div ${nodeAttrs('price', `Price / Metric: ${price}`)} style="font-size:38px;font-weight:800;color:${escapeHtml(primaryColor)};letter-spacing:-0.03em;">${escapeHtml(price)}</div>`,
      'price',
    );
  }
  b.push(
    `        <p ${nodeAttrs('subtitle', `Subtitle: ${subtitle}`)} style="margin:0;font-size:15px;line-height:1.6;color:#94a3b8;">${escapeHtml(subtitle)}</p>`,
    'subtitle',
  );
  b.push(
    `        <div style="display:flex;align-items:center;gap:12px;margin-top:8px;">`,
  );
  b.push(
    `          <button ${nodeAttrs('ctaLabel', `CTA: ${ctaLabel}`)} style="padding:12px 24px;border-radius:${Math.max(6, Math.round(radius * 0.65))}px;background:${escapeHtml(primaryColor)};color:#041225;font-weight:700;font-size:14px;border:none;cursor:pointer;box-shadow:0 10px 24px ${escapeHtml(primaryColor)}40;">${escapeHtml(ctaLabel)}</button>`,
    'ctaLabel',
  );
  b.push(
    `          <span ${nodeAttrs('primaryColor', `Accent color ${primaryColor}`)} style="font-size:11.5px;color:#94a3b8;font-family:monospace;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">Accent: ${escapeHtml(primaryColor)}</span>`,
    'primaryColor',
  );
  b.push('        </div>');
  b.push('      </div>');
  b.push('      <div class="caption" style="color:#94a3b8;">Click any element (badge, heading, description, button, or container) to highlight its semantic node &amp; code lines.</div>');
  b.push('    </div>');
}

function pushHeroScene(b: CodeBuilder, m: IntentModel): void {
  const eyebrowVal = str(m, 'eyebrow', str(m, 'badge', 'Innovate Without Limits'));
  const titleVal = str(m, 'title', m.label || 'Innovate Without Limits');
  const subtitleVal = str(
    m,
    'subtitle',
    'Transform ideas into code with semantic translation and visual verification.',
  );
  const ctaLabelVal = str(m, 'ctaLabel', 'Explore Now');
  const ctaHrefVal = str(m, 'ctaHref', '#');
  const gridHeight = num(m, 'grid.height', 600);
  const accentHeight = num(m, 'accent.height', 500);
  const paddingTop = num(m, 'padding.top', 112);
  const eyebrowKey = findProp(m, 'eyebrow') ? 'eyebrow' : findProp(m, 'badge') ? 'badge' : 'title';

  b.push(
    `    <div class="scene" style="background:linear-gradient(to bottom,#000,#020617 35%,#1e293b 80%,#0f172a 100%);color:#fff;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:${fmt(paddingTop)}px 28px 64px;position:relative;overflow:hidden;" ${nodeAttrs('padding.top', `Top padding ${fmt(paddingTop)}px`)}>`,
    'padding.top',
  );
  b.push('      <div class="stage-label" style="color:#94a3b8;z-index:20;">visual verifier &middot; interactive hero render (1280px desktop stage)</div>');
  b.push(
    `      <div ${nodeAttrs('grid.height', `Grid background height ${fmt(gridHeight)}px`)} style="position:absolute;inset:0;height:${fmt(gridHeight)}px;opacity:0.55;background-image:linear-gradient(to right,#334155 1px,transparent 1px),linear-gradient(to bottom,#334155 1px,transparent 1px);background-size:6rem 5rem;pointer-events:auto;"></div>`,
    'grid.height',
  );
  b.push(
    `      <div ${nodeAttrs('accent.height', `Radial accent height ${fmt(accentHeight)}px`)} style="position:absolute;left:50%;top:calc(100% - 140px);width:1100px;height:${fmt(accentHeight)}px;transform:translateX(-50%);border-radius:100%;border:1px solid rgba(180,140,222,0.4);background:radial-gradient(closest-side,#2e1065 30%,#000000 90%);pointer-events:auto;"></div>`,
    'accent.height',
  );
  b.push(
    `      <a href="${escapeHtml(ctaHrefVal)}" ${nodeAttrs(eyebrowKey, `Eyebrow: ${eyebrowVal}`)} style="position:relative;z-index:20;display:inline-flex;align-items:center;gap:8px;margin-bottom:18px;padding:8px 20px;border-radius:999px;border:2px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#d1d5db;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;text-decoration:none;">${escapeHtml(eyebrowVal)} &rarr;</a>`,
    eyebrowKey,
  );
  b.push(
    `      <h1 ${nodeAttrs('title', `Title: ${titleVal}`)} style="position:relative;z-index:20;margin:0 0 18px;font-size:68px;font-weight:800;line-height:1.04;letter-spacing:-0.03em;max-width:960px;background:linear-gradient(135deg,#fff 45%,rgba(255,255,255,0.5));-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${escapeHtml(titleVal)}</h1>`,
    'title',
  );
  b.push(
    `      <p ${nodeAttrs('subtitle', `Subtitle: ${subtitleVal}`)} style="position:relative;z-index:20;margin:0 0 36px;font-size:20px;line-height:1.6;color:#94a3b8;max-width:680px;">${escapeHtml(subtitleVal)}</p>`,
    'subtitle',
  );
  b.push(
    `      <div style="position:relative;z-index:20;display:flex;justify-content:center;" ${nodeAttrs('ctaLabel', `CTA: ${ctaLabelVal}`)}>`,
    'ctaLabel',
  );
  b.push(
    `        <a href="${escapeHtml(ctaHrefVal)}" style="display:inline-flex;align-items:center;justify-content:center;border-radius:12px;background:#ffffff;color:#000000;font-weight:700;font-size:17px;padding:14px 32px;text-decoration:none;box-shadow:0 18px 38px rgba(0,0,0,0.45);">${escapeHtml(ctaLabelVal)}</a>`,
    'ctaLabel',
  );
  b.push('      </div>');
  b.push('      <div class="caption" style="color:#94a3b8;z-index:20;">Click any element (eyebrow, title, subtitle, CTA, or background) to highlight its semantic node &amp; code lines.</div>');
  b.push('    </div>');
}

function pushWorkflowScene(b: CodeBuilder, m: IntentModel): void {
  const graph = ensureWorkflow(m, `${slug(m.label)}.sh`);
  const { order } = topoOrder(graph);
  const typeColor: Record<string, string> = {
    trigger: '#38bdf8',
    validator: '#f59e0b',
    transform: '#a78bfa',
    action: '#34d399',
  };

  b.push(
    '    <div class="box-scene" style="background:radial-gradient(120% 120% at 50% 0%, #0f172a 0%, #020617 100%);color:#f8fafc;padding:36px;flex-direction:column;gap:14px;overflow:auto;">',
  );
  b.push(
    `      <div class="stage-label" style="color:#94a3b8;">visual verifier &middot; workflow pipeline (${escapeHtml(m.label)})</div>`,
  );
  b.push(
    '      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;max-width:680px;z-index:10;">',
  );

  order.forEach((node, idx) => {
    const color = typeColor[node.type] ?? '#38bdf8';
    const safety = node.command ? classifyCommand(node.command).level : null;
    const safetyDot =
      safety === 'destructive' ? '#f87171' : safety === 'caution' ? '#f59e0b' : safety === 'safe' ? '#34d399' : null;
    const sub = node.command ?? node.detail ?? '';

    b.push(
      `        <div ${nodeAttrs(node.id, `${NODE_TYPE_LABEL[node.type]}: ${node.label}`)} style="width:100%;background:#16223a;border:1.5px solid ${color}66;border-left:6px solid ${color};border-radius:12px;padding:14px 18px;display:flex;flex-direction:column;gap:6px;box-shadow:0 12px 28px rgba(0,0,0,0.4);">`,
      node.id,
    );
    b.push('          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">', node.id);
    b.push(
      `            <span style="font-size:10.5px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:${color};">${escapeHtml(NODE_TYPE_LABEL[node.type])}${node.destination ? ` &rarr; ${escapeHtml(node.destination)}` : ''}</span>`,
      node.id,
    );
    if (safetyDot) {
      b.push(
        `            <span style="display:inline-flex;align-items:center;gap:5px;font-size:10.5px;color:${safetyDot};font-weight:700;text-transform:uppercase;"><i style="width:8px;height:8px;border-radius:50%;background:${safetyDot};display:inline-block;"></i>${escapeHtml(safety!)}</span>`,
        node.id,
      );
    }
    b.push('          </div>', node.id);
    b.push(
      `          <div style="font-size:16px;font-weight:700;color:#f8fafc;">${escapeHtml(node.label)}</div>`,
      node.id,
    );
    if (sub) {
      b.push(
        `          <code style="font-family:ui-monospace,monospace;font-size:12.5px;color:#93a4bd;background:rgba(10,17,32,0.65);padding:6px 10px;border-radius:7px;border:1px solid #26364f;">${escapeHtml(sub)}</code>`,
        node.id,
      );
    }
    b.push('        </div>', node.id);

    if (idx < order.length - 1) {
      b.push('        <div style="color:#38bdf8;font-size:18px;line-height:1;">&darr;</div>');
    }
  });

  b.push('      </div>');
  b.push(
    '      <div class="caption" style="color:#94a3b8;">Click any workflow step card to highlight its semantic node, DAG step &amp; source code lines.</div>',
  );
  b.push('    </div>');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/* ---------------------------------- targets ---------------------------------- */

function generateHtml(m: IntentModel): GeneratedCode {
  const b = new CodeBuilder();
  const fileName = `${slug(m.label)}.html`;
  const { triggerId, validatorId, transformId, actionId } = workflowStageIds(m, fileName);
  b.push('<!doctype html>', triggerId);
  b.push('<html lang="en">', triggerId);
  b.push('<head>', triggerId);
  b.push('  <meta charset="utf-8" />', triggerId);
  b.push('  <meta name="viewport" content="width=device-width, initial-scale=1" />', triggerId);
  b.push(`  <title>${escapeHtml(m.label)} &middot; generated</title>`, transformId);
  b.push('  <style>', validatorId);
  for (const line of SCENE_CSS.split('\n')) b.push(`  ${line}`, validatorId);
  b.push('  </style>', validatorId);
  b.push('</head>', triggerId);
  b.push('<body>', actionId);
  if (m.kind === 'workflow/pipeline') pushWorkflowScene(b, m);
  else if (m.kind === 'ui/hero') pushHeroScene(b, m);
  else if (m.kind === 'ui/button') pushButtonScene(b, m);
  else if (m.kind === 'furniture/table' || m.kind === 'furniture/chair') pushTableScene(b, m);
  else if (m.kind === 'ui/card' || m.kind === 'ui/dashboard' || m.kind === 'ui/form') pushUiSurfaceScene(b, m);
  else pushBoxScene(b, m);
  b.push('</body>', actionId);
  b.push('</html>', actionId);
  return b.build(fileName, 'html');
}

function generateNextjs(m: IntentModel): GeneratedCode {
  const b = new CodeBuilder();
  const iface = `${m.label.replace(/[^a-zA-Z0-9]/g, '') || 'Component'}Spec`;
  const compName = m.label.replace(/[^a-zA-Z0-9]/g, '') || 'ReversedComponent';
  const fileName = `${compName}.tsx`;
  const { triggerId, validatorId, transformId, actionId } = workflowStageIds(m, fileName);

  b.push(`'use client';`, triggerId);
  b.push('');
  b.push(`// Generated from the semantic model "${m.kind}".`, triggerId);
  b.push(`// Each property keeps its nodeId so the visual verifier & workflow DAG highlight its source.`, triggerId);
  b.push('');
  b.push(`export interface ${iface} {`, transformId);
  for (const p of m.props) {
    const tsType = typeof p.value === 'number' ? 'number' : typeof p.value === 'boolean' ? 'boolean' : 'string';
    const opts = p.options ? ` // one of: ${p.options.join(' | ')}` : '';
    b.push(`  /** ${p.label}${p.unit ? ` (${p.unit})` : ''} — nodeId: ${p.nodeId} */`, [p.nodeId, transformId]);
    b.push(`  ${camel(p.key)}: ${tsType};${opts}`, [p.nodeId, transformId]);
  }
  b.push('}', transformId);
  b.push('');
  b.push(`export const default${iface}: ${iface} = {`, transformId);
  for (const p of m.props) {
    const literal = typeof p.value === 'number' ? fmt(p.value) : `'${String(p.value).replace(/'/g, "\\'")}'`;
    b.push(`  ${camel(p.key)}: ${literal},`, [p.nodeId, transformId]);
  }
  b.push('};', transformId);
  b.push('');
  b.push(`export function validate${compName}(spec: ${iface}): string[] {`, validatorId);
  b.push('  const warnings: string[] = [];', validatorId);
  for (const w of m.warnings) {
    b.push(`  // ${w.severity.toUpperCase()}: ${w.message.replace(/`/g, "'")}`, [w.propKey, validatorId]);
    b.push(`  warnings.push('${w.message.replace(/'/g, "\\'")}');`, [w.propKey, validatorId]);
  }
  b.push('  return warnings;', validatorId);
  b.push('}', validatorId);
  b.push('');
  b.push(`export default function ${compName}(spec: Partial<${iface}> = {}) {`, actionId);
  b.push(`  const s = { ...default${iface}, ...spec };`, actionId);
  b.push('  return (', actionId);
  b.push(
    `    <section data-intent="${escapeHtml(m.kind)}" data-node-id="${m.props[0]?.nodeId ?? 'root'}" aria-label="${escapeHtml(m.label)}" className="p-8 rounded-2xl border border-slate-800 bg-slate-950 text-slate-100 shadow-2xl">`,
    [m.props[0]?.nodeId, actionId],
  );
  for (const p of m.props) {
    if (p.key === 'badge' || p.key === 'eyebrow') {
      b.push(
        `      <span data-node-id="${p.nodeId}" className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-sky-500/20 text-sky-400">{s.${camel(p.key)}}</span>`,
        [p.nodeId, actionId],
      );
    } else if (p.key === 'title') {
      b.push(`      <h2 data-node-id="${p.nodeId}" className="mt-3 text-3xl font-extrabold tracking-tight">{s.${camel(p.key)}}</h2>`, [
        p.nodeId,
        actionId,
      ]);
    } else if (p.key === 'price') {
      b.push(`      <div data-node-id="${p.nodeId}" className="mt-2 text-4xl font-black text-sky-400">{s.${camel(p.key)}}</div>`, [
        p.nodeId,
        actionId,
      ]);
    } else if (p.key === 'subtitle') {
      b.push(`      <p data-node-id="${p.nodeId}" className="mt-2 text-slate-400 leading-relaxed">{s.${camel(p.key)}}</p>`, [
        p.nodeId,
        actionId,
      ]);
    } else if (p.key === 'ctaLabel' || p.key === 'label') {
      b.push(
        `      <button type="button" data-node-id="${p.nodeId}" className="mt-4 px-6 py-3 rounded-xl bg-sky-400 text-slate-950 font-bold">{s.${camel(p.key)}}</button>`,
        [p.nodeId, actionId],
      );
    } else {
      b.push(`      <div data-node-id="${p.nodeId}" className="my-2">{s.${camel(p.key)}}${p.unit ?? ''}</div>`, [
        p.nodeId,
        actionId,
      ]);
    }
  }
  b.push('    </section>', actionId);
  b.push('  );', actionId);
  b.push('}', actionId);
  return b.build(fileName, 'typescript');
}

function generatePython(m: IntentModel): GeneratedCode {
  const b = new CodeBuilder();
  const cls = m.label.replace(/\s+/g, '');
  const fileName = `${slug(m.label)}.py`;
  const { triggerId, validatorId, transformId, actionId } = workflowStageIds(m, fileName);

  b.push('"""Generated from the semantic model — run locally: python ' + slug(m.label) + '.py"""', triggerId);
  b.push('from dataclasses import dataclass, field', triggerId);
  b.push('from typing import List', triggerId);
  b.push('');
  b.push('');
  b.push('@dataclass', transformId);
  b.push(`class ${cls}:`, transformId);
  for (const p of m.props) {
    const pyType = typeof p.value === 'number' ? 'float' : typeof p.value === 'boolean' ? 'bool' : 'str';
    const literal = typeof p.value === 'number' ? fmt(p.value) : `'${String(p.value).replace(/'/g, "\\'")}'`;
    b.push(
      `    ${snake(p.key)}: ${pyType} = ${literal}  # ${p.label}${p.unit ? ` (${p.unit})` : ''} [nodeId=${p.nodeId}]`,
      [p.nodeId, transformId],
    );
  }
  b.push('');
  b.push('    def validate(self) -> List[str]:', validatorId);
  b.push('        warnings: List[str] = []', validatorId);
  for (const w of m.warnings) {
    b.push(`        # ${w.severity.toUpperCase()}: ${w.message.replace(/'/g, '')}`, [w.propKey, validatorId]);
    b.push(`        warnings.append('${w.message.replace(/'/g, '')}')`, [w.propKey, validatorId]);
  }
  b.push('        return warnings', validatorId);
  b.push('');
  b.push('    def draw(self):', actionId);
  b.push('        """Wireframe render — matplotlib, no external assets."""', actionId);
  b.push('        import matplotlib.pyplot as plt', actionId);
  b.push('        from mpl_toolkits.mplot3d.art3d import Poly3DCollection', actionId);
  b.push('        fig = plt.figure()', actionId);
  b.push('        ax = fig.add_subplot(111, projection="3d")', actionId);
  if (m.kind === 'furniture/table' || m.kind === 'furniture/chair') {
    b.push('        w, l, h, t = self.top_width, self.top_length, self.legs_height, self.top_thickness', [
      'top.width',
      actionId,
    ]);
    b.push('        top = [[0, 0, h], [w, 0, h], [w, l, h], [0, l, h]]', ['top.width', actionId]);
    b.push('        ax.add_collection3d(Poly3DCollection([top], alpha=0.6, facecolor="#d7b98c"))', actionId);
    b.push('        for x, y in [(0, 0), (w, 0), (w, l), (0, l)]:', actionId);
    b.push('            ax.plot([x, x], [y, y], [0, h], color="#8a5f33", linewidth=3)', ['legs.height', actionId]);
    b.push('        ax.set_xlim(0, max(w, 1)); ax.set_ylim(0, max(l, 1)); ax.set_zlim(0, max(h, 1) * 1.2)', actionId);
  } else {
    b.push('        ax.bar3d(0, 0, 0, self.width, self.depth, self.height, alpha=0.6)', actionId);
  }
  b.push('        plt.show()', actionId);
  b.push('');
  b.push('');
  b.push(`item = ${cls}()`, actionId);
  b.push('for message in item.validate():', validatorId);
  b.push('    print("!", message)', validatorId);
  b.push('item.draw()', actionId);
  return b.build(fileName, 'python');
}

function generateTypescript(m: IntentModel): GeneratedCode {
  const b = new CodeBuilder();
  const iface = `${m.label.replace(/\s+/g, '')}Spec`;
  const fileName = `${slug(m.label)}.ts`;
  const { triggerId, validatorId, transformId, actionId } = workflowStageIds(m, fileName);

  b.push(`// Semantic contract for "${m.kind}" — this is the layer humans and AI both read.`, triggerId);
  b.push('');
  b.push(`export interface ${iface} {`, transformId);
  for (const p of m.props) {
    const tsType = typeof p.value === 'number' ? 'number' : typeof p.value === 'boolean' ? 'boolean' : 'string';
    b.push(`  ${camel(p.key)}: ${tsType}; // ${p.label}${p.unit ? ` (${p.unit})` : ''} -> ${p.nodeId}`, [
      p.nodeId,
      transformId,
    ]);
  }
  b.push('}', transformId);
  b.push('');
  b.push(`export const defaults: ${iface} = {`, actionId);
  for (const p of m.props) {
    const literal = typeof p.value === 'number' ? fmt(p.value) : `'${String(p.value).replace(/'/g, "\\'")}'`;
    b.push(`  ${camel(p.key)}: ${literal},`, [p.nodeId, actionId]);
  }
  b.push('};', actionId);
  b.push('');
  b.push(
    `export const constraints = ${JSON.stringify(
      m.warnings.map((w) => ({ id: w.id, severity: w.severity, prop: w.propKey, message: w.message })),
      null,
      2,
    )} as const;`,
    validatorId,
  );
  return b.build(fileName, 'typescript');
}

function generateJson(m: IntentModel): GeneratedCode {
  const b = new CodeBuilder();
  const fileName = `${slug(m.label)}.intent.json`;
  const { triggerId, validatorId, transformId, actionId } = workflowStageIds(m, fileName);
  const json = JSON.stringify(m, null, 2);
  json.split('\n').forEach((line) => {
    const keyMatch = line.match(/"key": "([^"]+)"/);
    const isWarn = /"warnings"|"severity"/.test(line);
    const isWf = /"workflow"|"nodes"|"edges"/.test(line);
    b.push(line, [keyMatch?.[1], isWarn ? validatorId : isWf ? actionId : transformId, triggerId]);
  });
  return b.build(fileName, 'json');
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
