import type { ConstraintWarning, IntentModel } from './types.ts';
import { propNumber } from './types.ts';
import { classifyCommand } from './safety.ts';
import { topoOrder, WORKFLOW_KIND } from './workflow.ts';

/**
 * Layer 1: the Domain Sanity Linter.
 * Natural language carries common sense; code does not. These rules encode the
 * common sense so a syntactically valid result can still be flagged as nonsense.
 */

function push(
  out: ConstraintWarning[],
  id: string,
  severity: ConstraintWarning['severity'],
  message: string,
  propKey?: string,
  suggestion?: string,
): void {
  out.push({ id, severity, message, propKey, suggestion });
}

function lintTable(m: IntentModel, out: ConstraintWarning[]): void {
  const height = propNumber(m, 'legs.height');
  const width = propNumber(m, 'top.width');
  const length = propNumber(m, 'top.length');
  const thickness = propNumber(m, 'top.thickness');
  const count = propNumber(m, 'legs.count');

  if (height > 0 && height < 24) {
    push(
      out,
      'table.leg-height-low',
      'error',
      `Leg height ${height}" is below the ergonomic floor (24"). A ${height}" table reads as a floor platform, not furniture — exactly the "2-inch legs" failure mode.`,
      'legs.height',
      'Try 28"–30" for a desk/dining height.',
    );
  } else if (height >= 24 && height < 28) {
    push(
      out,
      'table.leg-height-under',
      'warn',
      `Leg height ${height}" is under standard desk/dining height (28"–30"). It will feel low for seated work.`,
      'legs.height',
      'Set 29" for a comfortable desk.',
    );
  } else if (height > 42) {
    push(
      out,
      'table.leg-height-high',
      'warn',
      `Leg height ${height}" is above bar height (40"–42"). Most people cannot sit at it with a normal chair.`,
      'legs.height',
      'Bar height is 40"–42", counter 34"–36".',
    );
  }

  if (width > 0 && length > 0 && width > length * 3) {
    push(
      out,
      'table.aspect',
      'warn',
      `Top is ${width}" x ${length}" — an extreme aspect ratio (${(width / length).toFixed(1)}:1). It will look like a plank and tip sideways.`,
      'top.length',
    );
  }

  if (width >= 72) {
    push(
      out,
      'table.span',
      'warn',
      `A ${width}" top span on ${count} legs will sag without an apron or a center support.`,
      'top.width',
    );
  }

  if (thickness > 0 && thickness < 0.75) {
    push(out, 'table.top-thin', 'warn', `Top thickness ${thickness}" is sheet-material thin; it will flex.`, 'top.thickness');
  }
  if (thickness >= height && height > 0) {
    push(
      out,
      'table.top-vs-legs',
      'error',
      `Top thickness (${thickness}") is greater than or equal to the leg height (${height}"). That is not a table.`,
      'top.thickness',
    );
  }

  if (count > 0 && count < 3) {
    push(out, 'table.legs-count', 'error', `A ${count}-leg table cannot stand. Minimum stable base is 3 points of contact.`, 'legs.count');
  } else if (count > 6) {
    push(out, 'table.legs-many', 'info', `${count} legs is unusual — consider a trestle or pedestal base.`, 'legs.count');
  }

  if (height > 0 && width > 0 && width / height > 4.5) {
    push(out, 'table.tip', 'warn', `Width-to-height ratio ${(width / height).toFixed(1)}:1 — this is tippy. Widen the leg stance or add weight low.`, 'legs.height');
  }
}

function contrastRatio(hexA: string, hexB: string): number {
  const lum = (hex: string): number => {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const [r, g, b] = [0, 2, 4].map((i) => {
      const v = parseInt(full.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(hexA), lum(hexB)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

function lintButton(m: IntentModel, out: ConstraintWarning[]): void {
  const w = propNumber(m, 'width');
  const h = propNumber(m, 'height');
  const radius = propNumber(m, 'radius');

  if (w > 0 && h > 0 && (w < 44 || h < 44)) {
    push(
      out,
      'button.tap-target',
      'warn',
      `Tap target ${Math.round(w)}x${Math.round(h)}px is under the 44x44px minimum (WCAG 2.5.8 / Apple HIG). On a phone people will miss it.`,
      'height',
      'Set at least 44px in both directions.',
    );
  }
  if (radius > 0 && w > 0 && h > 0 && radius > Math.min(w, h) / 2 + 0.5) {
    push(out, 'button.radius-clamp', 'info', `Radius ${radius}px exceeds half the short side — it renders as a pill.`, 'radius');
  }
  const color = String(m.props.find((p) => p.key === 'color')?.value ?? '');
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
    const ratio = contrastRatio(color, '#ffffff');
    if (ratio < 4.5) {
      push(
        out,
        'button.contrast',
        'warn',
        `Text contrast of ${color} on white is ${ratio.toFixed(2)}:1 — below the 4.5:1 minimum for normal text.`,
        'color',
        'Darken the fill or use a darker label colour.',
      );
    }
  }
}

function lintGeneric(m: IntentModel, out: ConstraintWarning[]): void {
  const w = propNumber(m, 'width');
  const h = propNumber(m, 'height');
  if (w > 0 && h > 0 && (w / h > 8 || h / w > 8)) {
    push(out, 'generic.aspect', 'warn', `Extreme aspect ratio ${w}x${h}. If that is intentional, ignore this.`);
  }
}

function lintWorkflow(m: IntentModel, out: ConstraintWarning[]): void {
  const graph = m.workflow;
  if (!graph) return;
  if (!graph.nodes.some((n) => n.type === 'trigger')) {
    push(out, 'workflow.no-trigger', 'warn', 'This workflow has no trigger — nothing says when it runs.', undefined, 'Start with "when …" or "every night …"');
  }
  const { order, cyclic } = topoOrder(graph);
  if (cyclic) push(out, 'workflow.cycle', 'error', 'The graph has a cycle, so it is not a DAG and would never finish.');

  let validated = false;
  for (const node of order) {
    if (node.type === 'validator') validated = true;
    if (!node.command) continue;
    const safety = classifyCommand(node.command);
    if (safety.level === 'destructive') {
      push(
        out,
        `workflow.${node.id}.destructive`,
        'error',
        `"${node.label}" is destructive: ${safety.reasons.filter((r) => r !== 'read-only').join('; ')}.`,
        node.id,
        validated ? 'Generated script asks for confirmation (LC_CONFIRM=yes) first' : 'Add a validator step before it, e.g. "then check the backup exists"',
      );
    } else if (safety.level === 'caution') {
      push(out, `workflow.${node.id}.caution`, 'warn', `"${node.label}" writes files or calls the network: ${safety.reasons.join('; ')}.`, node.id);
    }
    if (node.command.startsWith('echo "TODO')) {
      push(out, `workflow.${node.id}.unmapped`, 'info', `Could not map "${node.label}" to a command — edit it in the semantic layer.`, node.id);
    }
  }
}

const KIND_LINTERS: Record<string, (m: IntentModel, out: ConstraintWarning[]) => void> = {
  'furniture/table': lintTable,
  'furniture/chair': lintTable,
  'ui/button': lintButton,
  [WORKFLOW_KIND]: lintWorkflow,
};

export function lint(model: IntentModel): ConstraintWarning[] {
  const out: ConstraintWarning[] = [];

  for (const p of model.props) {
    if (typeof p.value === 'number' && (!Number.isFinite(p.value) || p.value <= 0)) {
      push(out, `generic.${p.key}.nonpositive`, 'error', `${p.label} must be a positive number (got ${p.value}).`, p.key);
    }
    if (p.options && p.options.length > 0 && !p.options.includes(String(p.value))) {
      push(out, `generic.${p.key}.enum`, 'info', `${p.label} "${p.value}" is outside the known set (${p.options.join(', ')}).`, p.key);
    }
  }

  const linter = KIND_LINTERS[model.kind] ?? lintGeneric;
  linter(model, out);
  return out;
}
