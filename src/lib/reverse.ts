import type { IntentModel, IntentProp } from './types.ts';
import { newId } from './types.ts';
import { lint } from './lint.ts';
import { generatePreviewDoc } from './generate.ts';
import { buildModelFromText } from './parse.ts';

/**
 * Reverse direction: code in -> semantic model + visual out.
 * v0.1 uses heuristic extraction (regex + line tracking). It is honest about
 * confidence and keeps the line map so the visual can point back at the source.
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
  if (/\b(table|desk|leg|top_width|chair)\b/i.test(code)) return { kind: 'furniture/table', label: 'Table' };
  if (/\b(button|btn|cta)\b/i.test(code)) return { kind: 'ui/button', label: 'Button' };
  return { kind: 'generic/object', label: 'Object' };
}

function basePropsFor(kind: string): IntentProp[] {
  const seed = kind === 'furniture/table' ? 'a table' : kind === 'ui/button' ? 'a button' : 'an object';
  return buildModelFromText(seed).props;
}

export function reverseFromCode(code: string): ReverseResult {
  const trimmed = code.trim();
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
