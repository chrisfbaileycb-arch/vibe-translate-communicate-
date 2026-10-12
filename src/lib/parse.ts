import type { IntentModel, IntentProp } from './types.ts';
import { cloneModel, findProp, newId } from './types.ts';
import { lint } from './lint.ts';

/**
 * Layer 2 (input side): speech/text -> semantic IntentModel.
 * Also handles targeted corrections ("make the legs 28 inches") so an edit
 * mutates ONE node instead of re-translating the whole object.
 */

export interface ParseResult {
  model: IntentModel;
  selection: string | null;
  message: string;
  changedKeys: string[];
}

const UNIT_INCHES: Record<string, number> = {
  in: 1, inch: 1, inches: 1, '"': 1,
  ft: 12, foot: 12, feet: 12,
  cm: 0.393700787, mm: 0.0393700787,
  m: 39.3700787, meter: 39.3700787, meters: 39.3700787, metre: 39.3700787, metres: 39.3700787,
};

function toInches(value: number, unit?: string): number {
  const factor = UNIT_INCHES[(unit ?? 'in').toLowerCase()];
  return factor ? value * factor : value;
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const KIND_PATTERNS: { kind: string; label: string; re: RegExp }[] = [
  { kind: 'furniture/table', label: 'Table', re: /\b(table|desk|worktop|workbench|countertop|coffee table)\b/i },
  { kind: 'furniture/chair', label: 'Chair', re: /\b(chair|stool|seat|bench)\b/i },
  { kind: 'ui/button', label: 'Button', re: /\b(button|call to action|cta|chip|pill button)\b/i },
  { kind: 'ui/card', label: 'Card', re: /\b(card|tile|panel)\b/i },
  { kind: 'ui/form', label: 'Form', re: /\b(form|login|sign up|signup|input field|text field)\b/i },
];

const SHAPE_WORDS: Record<string, string> = {
  round: 'round', circular: 'round', circle: 'round', oval: 'oval', elliptical: 'oval',
  oblong: 'oval', rectangular: 'rectangular', rectangle: 'rectangular', square: 'square',
  'square-shaped': 'square', 'l-shaped': 'L-shaped',
};

const COLOR_WORDS = [
  'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'black', 'white',
  'grey', 'gray', 'beige', 'navy', 'teal', 'olive', 'maroon', 'cyan', 'magenta',
];

const MATERIAL_WORDS = ['wood', 'oak', 'walnut', 'pine', 'metal', 'steel', 'aluminium', 'aluminum', 'glass', 'plastic', 'marble', 'plywood', 'acrylic'];

/* ---------------------------------- number extraction ---------------------------------- */

interface NumberHit {
  value: number;
  unit?: string;
  /** candidate words ordered by proximity to the number: nearest first */
  words: string[];
  context: string;
  raw: string;
}

function cleanWord(word: string): string {
  return word.replace(/[^a-z"]/gi, '');
}

function extractNumbers(text: string): NumberHit[] {
  const hits: NumberHit[] = [];
  const re = /(\d+(?:\.\d+)?)\s*(feet|foot|ft|inches|inch|ins|cm|mm|meters|metres|meter|metre|m|in)?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const value = Number(match[1]);
    const unit = match[2];
    const unitWord = (unit ?? '').toLowerCase();
    const before = text.slice(Math.max(0, match.index - 26), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 26);
    const isCandidate = (word: string): boolean =>
      word.length > 1 && !/\d/.test(word) && word !== unitWord && !UNIT_INCHES[word];

    const beforeWords = before.toLowerCase().split(/\s+/).map(cleanWord).filter(isCandidate).slice(-2);
    const afterWords = after.toLowerCase().split(/\s+/).map(cleanWord).filter(isCandidate).slice(0, 2);
    const words = [afterWords[0], beforeWords[0], afterWords[1], beforeWords[1]].filter(Boolean) as string[];

    hits.push({
      value,
      unit,
      words,
      context: [...beforeWords, ...afterWords].join(' '),
      raw: match[0],
    });
  }
  return hits;
}

function extractCount(text: string, noun: RegExp): number | null {
  const re = new RegExp(`(${Object.keys(WORD_NUMBERS).join('|')}|\\d+)\\s+${noun.source}`, 'i');
  const m = text.match(re);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  return WORD_NUMBERS[raw] ?? Number(raw);
}

/* ---------------------------------- property resolution ---------------------------------- */

/** Ordered on purpose: "top thickness" must hit thickness before it hits "top". */
const PROP_HINTS: { re: RegExp; keys: string[] }[] = [
  { re: /(thick|depth of the top)/i, keys: ['top.thickness', 'thickness'] },
  { re: /(leg|height|high|tall|elevat|off the ground)/i, keys: ['legs.height', 'height'] },
  { re: /(diamet|across|width|wide|top|span)/i, keys: ['top.width', 'width'] },
  { re: /(length|long)/i, keys: ['top.length', 'length'] },
  { re: /(radius|corner)/i, keys: ['radius'] },
  { re: /(font|text size)/i, keys: ['fontSize'] },
  { re: /(count|how many|number of)/i, keys: ['legs.count', 'count'] },
];

function keyFromHint(model: IntentModel, phrase: string): string | null {
  for (const hint of PROP_HINTS) {
    if (!hint.re.test(phrase)) continue;
    for (const key of hint.keys) {
      if (findProp(model, key)) return key;
    }
  }
  return null;
}

function resolvePropKey(model: IntentModel, phrase: string): string | null {
  const hinted = keyFromHint(model, phrase);
  if (hinted) return hinted;

  const tokens = phrase.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  let best: { key: string; score: number } | null = null;
  for (const p of model.props) {
    const hay = `${p.key} ${p.label}`.toLowerCase();
    let score = 0;
    for (const t of tokens) if (hay.includes(t)) score += t.length > 4 ? 2 : 1;
    if (score === 0) continue;
    const bonus = p.key.endsWith('.height') ? 0.5 : p.key.endsWith('.width') ? 0.25 : 0;
    const total = score + bonus;
    if (!best || total > best.score) best = { key: p.key, score: total };
  }
  return best ? best.key : null;
}

/** For a bare number: trust the nearest word first ("48 inch *top*, 2 inch *legs*"). */
function resolveForHit(model: IntentModel, hit: NumberHit): string | null {
  for (const word of hit.words) {
    const key = keyFromHint(model, word);
    if (key) return key;
  }
  return resolvePropKey(model, hit.context);
}

function prop(
  key: string,
  label: string,
  value: string | number | boolean,
  unit: string | undefined,
  confidence: number,
  source?: string,
  extra: Partial<IntentProp> = {},
): IntentProp {
  return { key, label, value, unit, nodeId: key, confidence, source, ...extra };
}

function modelStub(props: IntentProp[]): IntentModel {
  return { id: 'stub', kind: 'stub', label: 'stub', props, warnings: [], updatedAt: 0 };
}

function applyHits(props: IntentProp[], hits: NumberHit[], unitScale = 1): void {
  for (const hit of hits) {
    const key = resolveForHit(modelStub(props), hit);
    const target = key ? props.find((p) => p.key === key) : null;
    if (!target) continue;
    const value = hit.unit && UNIT_INCHES[hit.unit.toLowerCase()] ? toInches(hit.value, hit.unit) : hit.value * unitScale;
    target.value = Math.round(value * 100) / 100;
    target.confidence = 0.85;
    target.source = hit.raw.trim();
  }
}

/* ---------------------------------- model builders ---------------------------------- */

function buildTableModel(hits: NumberHit[], text: string): IntentModel {
  const shapeWord = Object.keys(SHAPE_WORDS).find((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));
  const shape = shapeWord ? SHAPE_WORDS[shapeWord] : 'rectangular';
  const roundish = shape === 'round' || shape === 'oval';
  const legs = extractCount(text, /legs?/i) ?? 4;

  const props: IntentProp[] = [
    prop('top.shape', 'Top shape', shape, undefined, shapeWord ? 0.9 : 0.55, shapeWord, {
      options: ['round', 'rectangular', 'square', 'oval'],
    }),
    prop('top.width', 'Top width', 48, 'in', 0.5, undefined, { min: 6, max: 120, step: 1 }),
    prop('top.length', 'Top length', roundish ? 48 : 60, 'in', 0.5, undefined, { min: 6, max: 120, step: 1 }),
    prop('top.thickness', 'Top thickness', 1.5, 'in', 0.5, undefined, { min: 0.25, max: 8, step: 0.25 }),
    prop('legs.count', 'Leg count', legs, undefined, 0.7, undefined, { min: 1, max: 12, step: 1 }),
    prop('legs.height', 'Leg height', 30, 'in', 0.5, undefined, { min: 1, max: 60, step: 0.5 }),
    prop('legs.thickness', 'Leg thickness', 2, 'in', 0.5, undefined, { min: 0.5, max: 12, step: 0.25 }),
    prop('material', 'Material', 'wood', undefined, 0.6, undefined, {
      options: ['wood', 'oak', 'walnut', 'pine', 'metal', 'steel', 'glass', 'plastic', 'marble', 'plywood'],
    }),
  ];

  applyHits(props, hits);

  const material = MATERIAL_WORDS.find((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));
  if (material) {
    const m = props.find((p) => p.key === 'material')!;
    m.value = material;
    m.confidence = 0.9;
    m.source = material;
  }

  return {
    id: newId(),
    kind: 'furniture/table',
    label: 'Table',
    props,
    warnings: [],
    sourceText: text,
    updatedAt: Date.now(),
  };
}

function buildButtonModel(hits: NumberHit[], text: string): IntentModel {
  const label = (text.match(/(?:that says|labelled|labeled|reading|called)\s+"([^"]{1,24})"/i) ?? [])[1] ?? 'Button';
  const color = COLOR_WORDS.find((w) => new RegExp(`\\b${w}\\b`, 'i').test(text)) ?? 'blue';
  const props: IntentProp[] = [
    prop('width', 'Width', 160, 'px', 0.5, undefined, { min: 24, max: 600, step: 4 }),
    prop('height', 'Height', 48, 'px', 0.5, undefined, { min: 16, max: 300, step: 2 }),
    prop('radius', 'Corner radius', 8, 'px', 0.5, undefined, { min: 0, max: 200, step: 1 }),
    prop('label', 'Label', label, undefined, 0.8),
    prop('color', 'Fill colour', color, undefined, 0.7, undefined, {
      options: [...COLOR_WORDS, '#2563eb', '#111827', '#16a34a'],
    }),
  ];
  applyHits(props, hits, 1);
  return {
    id: newId(),
    kind: 'ui/button',
    label: 'Button',
    props,
    warnings: [],
    sourceText: text,
    updatedAt: Date.now(),
  };
}

function buildGenericModel(hits: NumberHit[], text: string): IntentModel {
  const props: IntentProp[] = [
    prop('width', 'Width', 240, 'px', 0.4, undefined, { min: 1, max: 2000, step: 1 }),
    prop('height', 'Height', 160, 'px', 0.4, undefined, { min: 1, max: 2000, step: 1 }),
    prop('depth', 'Depth', 40, 'px', 0.4, undefined, { min: 0, max: 2000, step: 1 }),
    prop('count', 'Count', extractCount(text, /(?:items?|pieces?|blocks?|elements?)/i) ?? 1, undefined, 0.5, undefined, {
      min: 1, max: 24, step: 1,
    }),
  ];
  applyHits(props, hits, 1);
  return {
    id: newId(),
    kind: 'generic/object',
    label: 'Object',
    props,
    warnings: [],
    sourceText: text,
    updatedAt: Date.now(),
  };
}

export function buildModelFromText(text: string): IntentModel {
  const hits = extractNumbers(text);
  const kind = KIND_PATTERNS.find((k) => k.re.test(text));
  let model: IntentModel;
  if (kind?.kind === 'furniture/table' || kind?.kind === 'furniture/chair') model = buildTableModel(hits, text);
  else if (kind?.kind === 'ui/button') model = buildButtonModel(hits, text);
  else model = buildGenericModel(hits, text);
  model.warnings = lint(model);
  return model;
}

/* ---------------------------------- corrections ---------------------------------- */

const SELECT_RE = /^(?:select|pick|choose|highlight|focus(?: on)?|point at|show me)\s+(?:the\s+|my\s+)?(.+?)[.!]?$/i;
const SET_PREP_RE = /^(?:please\s+)?(?:(?:make|set|change|update|adjust|fix|correct)\s+)?(?:the\s+|my\s+)?(.+?)\s+(?:to|at|=|be)\s+(\d+(?:\.\d+)?)\s*([a-z"']*)[.!]?$/i;
const SET_BARE_RE = /^(?:please\s+)?(?:make|set|change|update|adjust|fix|correct)\s+(?:the\s+|my\s+)?(.+?)\s+(\d+(?:\.\d+)?)\s*([a-z"']*)[.!]?$/i;
const SET_PHRASE_RE = /^(?:the\s+|my\s+)?(.+?)\s+(\d+(?:\.\d+)?)\s*([a-z"']*)[.!]?$/i;
const DIRECTION_RE = /^(?:please\s+)?(?:make|change|adjust|turn)\s+(?:it\s+|the\s+|my\s+)?(.+?)\s+(taller|higher|shorter|lower|wider|narrower|bigger|larger|smaller|thicker|thinner)[.!]?$/i;
const BARE_DIRECTION_RE = /^(?:please\s+)?(?:make|change|adjust)\s+(?:it\s+)?(taller|higher|shorter|lower|wider|narrower|bigger|larger|smaller|thicker|thinner)[.!]?$/i;

const GROW = new Set(['taller', 'higher', 'wider', 'bigger', 'larger', 'thicker']);

function applyDelta(p: IntentProp, direction: string): void {
  const current = Number(p.value);
  if (!Number.isFinite(current)) return;
  const factor = GROW.has(direction) ? 1.25 : 0.8;
  p.value = Math.round(current * factor * 100) / 100;
  p.confidence = 0.95;
  p.source = `voice: "make it ${direction}"`;
}

function commitSet(
  next: IntentModel,
  target: IntentProp,
  value: number,
  changedKeys: string[],
  spoken: string,
  note: string,
): ParseResult {
  target.value = value;
  target.confidence = 0.98;
  target.source = `voice: "${spoken}"`;
  changedKeys.push(target.key);
  next.warnings = lint(next);
  return {
    model: next,
    selection: target.key,
    message: `${target.label} → ${value}${target.unit ?? ''}. ${note}`,
    changedKeys,
  };
}

/** Returns null when the utterance is a fresh description rather than a correction. */
export function parseCorrection(text: string, model: IntentModel, selection: string | null): ParseResult | null {
  const clean = text.trim();
  if (!clean) return null;
  const next = cloneModel(model);
  const changedKeys: string[] = [];

  const select = clean.match(SELECT_RE);
  if (select) {
    const key = resolvePropKey(next, select[1]);
    if (key) {
      return {
        model: next,
        selection: key,
        message: `Selected "${findProp(next, key)?.label}". Say a correction to change just that node.`,
        changedKeys: [],
      };
    }
  }

  const setPrep = clean.match(SET_PREP_RE);
  const setBare = clean.match(SET_BARE_RE);
  const setPhrase = clean.match(SET_PHRASE_RE);
  const set = setPrep ?? setBare ?? setPhrase;
  if (set) {
    // A bare "29 inches" may target the selection; a named property never needs it.
    const key = resolvePropKey(next, set[1]) ?? (setPrep || setBare ? selection : null);
    const target = key ? findProp(next, key) : undefined;
    if (target) {
      const unit = set[3]?.toLowerCase();
      const inInches = target.unit === 'in';
      const value = inInches && UNIT_INCHES[unit] ? Math.round(toInches(Number(set[2]), unit) * 100) / 100 : Number(set[2]);
      return commitSet(next, target, value, changedKeys, clean, 'Only that node changed.');
    }
  }

  const dir = clean.match(DIRECTION_RE) ?? clean.match(BARE_DIRECTION_RE);
  if (dir) {
    const phrase = dir.length > 2 ? dir[1] : '';
    const direction = dir.length > 2 ? dir[2] : dir[1];
    const key = (phrase && resolvePropKey(next, phrase)) ?? selection ?? 'legs.height';
    const target = findProp(next, key);
    if (target) {
      applyDelta(target, direction);
      changedKeys.push(target.key);
      next.warnings = lint(next);
      return {
        model: next,
        selection: target.key,
        message: `${target.label} is now ${String(target.value)}${target.unit ?? ''} (${direction}).`,
        changedKeys,
      };
    }
  }

  // Short numeric follow-up while something is selected: "28 inches", "48".
  if (selection) {
    const quick = clean.match(/^(\d+(?:\.\d+)?)\s*([a-z"']*)$/i);
    const mentionsObject = /\b(table|desk|chair|stool|button|card|form|panel|tile)\b/i.test(clean);
    const target = quick && !mentionsObject ? findProp(next, selection) : undefined;
    if (target && quick) {
      const unit = quick[2]?.toLowerCase();
      const inInches = target.unit === 'in';
      const value = inInches && UNIT_INCHES[unit] ? Math.round(toInches(Number(quick[1]), unit) * 100) / 100 : Number(quick[1]);
      return commitSet(next, target, value, changedKeys, clean, 'Follow-up on the current selection.');
    }
  }

  // It looked like a correction but nothing resolved: keep the model, say so.
  if (/^(?:please\s+)?(?:make|change|adjust|set|undo|revert)\b/i.test(clean)) {
    return {
      model: next,
      selection,
      message: `Heard a correction ("${clean}") but could not map it to a property. Try "select the legs", then "make it taller".`,
      changedKeys: [],
    };
  }

  return null;
}

export function parseUtterance(text: string, current: IntentModel | null, selection: string | null): ParseResult {
  const clean = text.trim();
  if (!clean) {
    return { model: current ?? buildModelFromText(''), selection, message: 'Nothing to interpret.', changedKeys: [] };
  }

  if (current) {
    const correction = parseCorrection(clean, current, selection);
    if (correction) return correction;
  }

  const model = buildModelFromText(clean);
  return {
    model,
    selection: null,
    message: `Interpreted as ${model.label.toLowerCase()} (${model.props.length} properties). ${model.warnings.length} constraint note(s).`,
    changedKeys: model.props.map((p) => p.key),
  };
}
