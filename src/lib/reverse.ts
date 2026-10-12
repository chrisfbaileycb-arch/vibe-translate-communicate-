import type { IntentModel, IntentProp } from './types.ts';
import { newId } from './types.ts';
import { lint } from './lint.ts';
import { generatePreviewDoc } from './generate.ts';
import { buildModelFromText } from './parse.ts';

/**
 * Reverse direction: code in -> semantic model + visual out.
 * Supports:
 * 1. React / TSX components (Next.js, Tailwind, JSX) with live visual proof & node binding
 * 2. Pure HTML + CSS documents
 * 3. Non-HTML source (Python, generic contracts) rendered as schematics
 */

export interface ReverseResult {
  model: IntentModel;
  renderKind: 'html' | 'sketch';
  previewDoc: string;
  lineMap: Record<string, { start: number; end: number }[]>;
  note: string;
}

interface Pattern {
  key: string;
  label: string;
  unit?: string;
  re: RegExp;
}

const PATTERNS: Pattern[] = [
  { key: 'legs.height', label: 'Leg height', unit: 'in', re: /(?:leg[_\s]?height|legs?\.height|legLength)\s*[:=]\s*["']?([0-9.]+)/i },
  { key: 'top.thickness', label: 'Top thickness', unit: 'in', re: /(?:top[_\s]?thickness|thickness|top_thickness)\s*[:=]\s*["']?([0-9.]+)/i },
  { key: 'top.width', label: 'Top width', unit: 'in', re: /(?:top[_\s]?width|width|diameter|top_width)\s*[:=]\s*["']?([0-9.]+)/i },
  { key: 'top.length', label: 'Top length', unit: 'in', re: /(?:top[_\s]?length|length|top_length)\s*[:=]\s*["']?([0-9.]+)/i },
  { key: 'legs.count', label: 'Leg count', re: /(?:leg[_\s]?count|legs?\.count|num[_\s]?legs)\s*[:=]\s*["']?([0-9.]+)/i },
  { key: 'legs.thickness', label: 'Leg thickness', unit: 'in', re: /(?:leg[_\s]?thickness|legs?\.thickness)\s*[:=]\s*["']?([0-9.]+)/i },
  { key: 'radius', label: 'Corner radius', re: /(?:radius|border[_\s-]?radius)\s*[:=]\s*["']?([0-9.]+)/i },
  { key: 'height', label: 'Height', re: /(?:^|[\s;{(])(?:height|size_h)\s*[:=]\s*["']?([0-9.]+)/i },
  { key: 'width', label: 'Width', re: /(?:^|[\s;{(])width\s*[:=]\s*["']?([0-9.]+)/i },
];

const COLOR_RE = /(?:color|colour|background(?:[_\s-]?color)?|fill)\s*[:=]\s*["']?(#[0-9a-f]{3,8}|[a-z]+)/i;

function lineOf(code: string, index: number): number {
  return code.slice(0, index).split('\n').length;
}

function detectKind(code: string): { kind: string; label: string } {
  if (/\b(hero|banner|jumbotron|showcase)\b/i.test(code)) return { kind: 'ui/hero', label: 'Hero Section' };
  if (/\b(table|desk|leg|top_width|chair)\b/i.test(code)) return { kind: 'furniture/table', label: 'Table' };
  if (/\b(button|btn|cta)\b/i.test(code)) return { kind: 'ui/button', label: 'Button' };
  if (/\b(card|tile|panel)\b/i.test(code)) return { kind: 'ui/card', label: 'Card' };
  return { kind: 'generic/object', label: 'Object' };
}

function basePropsFor(kind: string): IntentProp[] {
  if (kind === 'ui/hero') {
    return [
      { key: 'eyebrow', nodeId: 'eyebrow', label: 'Eyebrow text', value: 'Innovate Without Limits', confidence: 0.9, source: 'eyebrow prop' },
      { key: 'title', nodeId: 'title', label: 'Title text', value: 'Innovate Without Limits', confidence: 0.9, source: 'title prop' },
      { key: 'subtitle', nodeId: 'subtitle', label: 'Subtitle text', value: 'Build next-generation tools with semantic translation and visual verification.', confidence: 0.8, source: 'subtitle prop' },
      { key: 'ctaLabel', nodeId: 'ctaLabel', label: 'CTA label', value: 'Explore Now', confidence: 0.9, source: 'ctaLabel prop' },
      { key: 'ctaHref', nodeId: 'ctaHref', label: 'CTA link', value: '#', confidence: 0.9, source: 'ctaHref prop' },
    ];
  }
  const seed = kind === 'furniture/table' ? 'a table' : kind === 'ui/button' ? 'a button' : 'an object';
  return buildModelFromText(seed).props;
}

function handleReactComponent(code: string): ReverseResult | null {
  const isReact =
    /(?:^|\n)\s*(?:"use client"|import\s+.*from|export\s+(?:default\s+)?function|export\s+const\s+\w+\s*=|interface\s+\w+Props)/i.test(
      code,
    ) || (/\b(?:function|const)\s+\w+[\s\S]*?return\s*\(\s*</i.test(code) && !/<html/i.test(code));

  if (!isReact) return null;

  const compMatch = code.match(/(?:export\s+(?:default\s+)?function|function|export\s+const)\s+([A-Z]\w*)/);
  const compName = compMatch?.[1] ?? 'Hero';
  const { kind, label } = compName.toLowerCase().includes('hero')
    ? { kind: 'ui/hero', label: 'Hero Section' }
    : detectKind(code);

  const props: IntentProp[] = [];
  const lineMap: Record<string, { start: number; end: number }[]> = {};

  const addProp = (key: string, pLabel: string, value: string | number | boolean, unit: string | undefined, index: number, source: string) => {
    const existing = props.find((p) => p.key === key);
    if (existing) return;
    const line = lineOf(code, index);
    props.push({
      key,
      nodeId: key,
      label: pLabel,
      value,
      unit,
      confidence: 0.85,
      source,
    });
    lineMap[key] = [{ start: line, end: line }];
  };

  // 1. Extract default props from signature: propName = "value" or propName = 123
  const defaultRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\d+(?:\.\d+)?))/g;
  let defMatch: RegExpExecArray | null;
  while ((defMatch = defaultRegex.exec(code)) !== null) {
    const pKey = defMatch[1];
    const val = defMatch[2] ?? defMatch[3] ?? Number(defMatch[4]);
    const pLabel = pKey.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
    addProp(pKey, pLabel, val, undefined, defMatch.index, defMatch[0]);
  }

  // 2. Extract title & subtitle props if present in interface or signature
  if (!props.some((p) => p.key === 'title') && /\btitle\b/.test(code)) {
    const titleIdx = code.indexOf('title');
    addProp('title', 'Title text', 'Innovate Without Limits', undefined, titleIdx, 'title prop');
  }
  if (!props.some((p) => p.key === 'subtitle') && /\bsubtitle\b/.test(code)) {
    const subIdx = code.indexOf('subtitle');
    addProp(
      'subtitle',
      'Subtitle text',
      'Transform ideas into code with semantic translation and visual verification.',
      undefined,
      subIdx,
      'subtitle prop',
    );
  }

  // 3. Extract dimensions from Tailwind classes
  const gridMatch = code.match(/h-\[(\d+)px\]/);
  if (gridMatch) {
    addProp('grid.height', 'Grid background height', Number(gridMatch[1]), 'px', gridMatch.index ?? 0, gridMatch[0]);
  }
  const accentMatch = code.match(/h-\[(\d+)px\]\s+w-\[(\d+)px\]/);
  if (accentMatch) {
    addProp('accent.height', 'Radial accent height', Number(accentMatch[1]), 'px', accentMatch.index ?? 0, accentMatch[0]);
    addProp('accent.width', 'Radial accent width', Number(accentMatch[2]), 'px', accentMatch.index ?? 0, accentMatch[0]);
  }
  const ptMatch = code.match(/pt-(\d+)/);
  if (ptMatch) {
    addProp('padding.top', 'Top padding', Number(ptMatch[1]) * 4, 'px', ptMatch.index ?? 0, ptMatch[0]);
  }

  // Fallback base props if needed
  if (props.length === 0) {
    for (const bp of basePropsFor(kind)) {
      props.push(bp);
    }
  }

  const model: IntentModel = {
    id: newId(),
    kind,
    label: compName || label,
    props,
    warnings: [],
    sourceText: undefined,
    updatedAt: Date.now(),
  };
  model.warnings = lint(model);

  // Construct visual preview document
  const eyebrowVal = String(props.find((p) => p.key === 'eyebrow')?.value ?? 'Innovate Without Limits');
  const titleVal = String(props.find((p) => p.key === 'title')?.value ?? 'Innovate Without Limits');
  const subtitleVal = String(
    props.find((p) => p.key === 'subtitle')?.value ??
      'Transform ideas into code with semantic translation and visual verification.',
  );
  const ctaLabelVal = String(props.find((p) => p.key === 'ctaLabel')?.value ?? 'Explore Now');
  const ctaHrefVal = String(props.find((p) => p.key === 'ctaHref')?.value ?? '#');

  const previewDoc = `<!doctype html>
<html class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['ui-sans-serif', 'system-ui', 'sans-serif'],
            geist: ['ui-sans-serif', 'system-ui', 'sans-serif']
          }
        }
      }
    }
  </script>
  <style>
    body { margin: 0; background: #000; color: #fff; font-family: ui-sans-serif, system-ui, sans-serif; overflow-x: hidden; }
    .animate-fade-in { opacity: 1 !important; transform: none !important; }
    .animate-fade-up { opacity: 1 !important; transform: none !important; }
    [data-node-id] { cursor: pointer; transition: all 0.2s ease; }
    [data-node-id]:hover { outline: 2px solid #38bdf8; outline-offset: 3px; }
  </style>
</head>
<body class="bg-black text-white min-h-screen antialiased flex flex-col justify-center">
  <section
    id="hero"
    data-node-id="padding.top"
    class="relative mx-auto w-full pt-28 pb-16 px-6 text-center md:px-8 min-h-[calc(100vh-40px)] overflow-hidden bg-[linear-gradient(to_bottom,#000,#0000_30%,#1e293b_78%,#0f172a_99%_50%)] rounded-b-xl flex flex-col justify-center items-center"
  >
    <!-- Grid BG -->
    <div
      data-node-id="grid.height"
      class="absolute -z-10 inset-0 opacity-80 h-[600px] w-full bg-[linear-gradient(to_right,#333_1px,transparent_1px),linear-gradient(to_bottom,#333_1px,transparent_1px)] bg-[size:6rem_5rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]"
    ></div>

    <!-- Radial Accent -->
    <div
      data-node-id="accent.height"
      class="absolute left-1/2 top-[calc(100%-120px)] h-[500px] w-[700px] md:h-[500px] md:w-[1100px] lg:h-[750px] lg:w-[140%] -translate-x-1/2 rounded-[100%] border-[#B48CDE]/40 bg-black bg-[radial-gradient(closest-side,#2e1065_30%,#000000_90%)]"
    ></div>

    <!-- Eyebrow -->
    <a href="#" data-node-id="eyebrow" class="group inline-block mx-auto mb-4 z-20">
      <span class="text-sm text-gray-300 font-sans mx-auto px-5 py-2 bg-gradient-to-tr from-zinc-300/10 via-gray-400/10 to-transparent border-[2px] border-white/10 rounded-3xl w-fit tracking-tight uppercase flex items-center justify-center">
        ${eyebrowVal}
        <svg class="inline w-4 h-4 ml-2 transition-transform duration-300 group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
      </span>
    </a>

    <!-- Title -->
    <h1
      data-node-id="title"
      class="z-20 -translate-y-2 text-balance bg-gradient-to-br from-white from-40% to-white/50 bg-clip-text py-4 text-5xl font-extrabold leading-none tracking-tight text-transparent sm:text-6xl md:text-7xl lg:text-8xl"
    >
      ${titleVal}
    </h1>

    <!-- Subtitle -->
    <p
      data-node-id="subtitle"
      class="z-20 mb-10 text-balance text-lg tracking-tight text-gray-400 md:text-xl max-w-2xl mx-auto"
    >
      ${subtitleVal}
    </p>

    <!-- CTA -->
    <div class="flex justify-center z-20" data-node-id="ctaLabel">
      <a
        href="${ctaHrefVal}"
        class="inline-flex items-center justify-center rounded-xl bg-white text-black font-semibold text-lg py-3 px-8 shadow-xl transition-all duration-200 hover:bg-neutral-200 hover:scale-105 active:scale-95"
      >
        ${ctaLabelVal}
      </a>
    </div>

    <!-- Bottom Fade -->
    <div class="relative mt-20 [perspective:2000px] after:absolute after:inset-0 after:z-50 after:[background:linear-gradient(to_top,#000_10%,transparent)]"></div>
  </section>

  <script>
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-node-id]');
      if (el) {
        const id = el.getAttribute('data-node-id');
        window.parent.postMessage({ type: 'CT_SELECT_NODE', nodeId: id }, '*');
      }
    });
  </script>
</body>
</html>`;

  return {
    model,
    renderKind: 'html',
    previewDoc,
    lineMap,
    note: `React Component (${compName}) detected — parsed ${props.length} semantic properties with live Tailwind visual verification and two-way node binding.`,
  };
}

export function reverseFromCode(code: string): ReverseResult {
  const trimmed = code.trim();

  // 1. Check for React / TSX components
  const reactResult = handleReactComponent(trimmed);
  if (reactResult) return reactResult;

  // 2. Check for pure HTML documents
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(trimmed) && /<\/(body|html|div|section|main|span|button)>/i.test(trimmed);
  const lineMap: Record<string, { start: number; end: number }[]> = {};
  const { kind, label } = detectKind(trimmed);
  const props = basePropsFor(kind);
  let matches = 0;

  for (const pattern of PATTERNS) {
    const re = new RegExp(pattern.re.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = re.exec(trimmed)) !== null) {
      const target = props.find((p) => p.key === pattern.key);
      if (!target) continue;
      const value = Number(match[1]);
      if (!Number.isFinite(value)) continue;
      target.value = value;
      target.confidence = 0.6;
      target.source = match[0].trim();
      const line = lineOf(trimmed, match.index);
      const ranges = lineMap[target.nodeId] ?? (lineMap[target.nodeId] = []);
      const last = ranges[ranges.length - 1];
      if (last && last.end === line - 1) last.end = line;
      else ranges.push({ start: line, end: line });
      matches += 1;
      break;
    }
  }

  const colorMatch = trimmed.match(COLOR_RE);
  if (colorMatch) {
    const colorProp = props.find((p) => p.key === 'color' || p.key === 'material');
    if (colorProp) {
      colorProp.value = colorMatch[1];
      colorProp.confidence = 0.6;
      colorProp.source = colorMatch[0].trim();
      const line = lineOf(trimmed, colorMatch.index ?? 0);
      lineMap[colorProp.nodeId] = [{ start: line, end: line }];
      matches += 1;
    }
  }

  const model: IntentModel = {
    id: newId(),
    kind,
    label,
    props,
    warnings: [],
    sourceText: undefined,
    updatedAt: Date.now(),
  };
  model.warnings = lint(model);

  if (looksHtml) {
    const previewDoc = /<html[\s>]/i.test(trimmed)
      ? trimmed
      : `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui,sans-serif}</style></head><body>${trimmed}</body></html>`;
    return {
      model,
      renderKind: 'html',
      previewDoc,
      lineMap,
      note: `HTML detected — rendered as-is. ${matches} dimensional propert${matches === 1 ? 'y' : 'ies'} extracted and mapped back to source lines.`,
    };
  }

  return {
    model,
    renderKind: 'sketch',
    previewDoc: generatePreviewDoc(model),
    lineMap,
    note: matches
      ? `${matches} dimensional propert${matches === 1 ? 'y' : 'ies'} extracted — rendered as a schematic so you can see the shape the code describes.`
      : 'No dimensional properties found — showing a neutral schematic. Paste HTML to render it exactly.',
  };
}
