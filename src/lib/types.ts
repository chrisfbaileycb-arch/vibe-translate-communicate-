export type TargetId = 'html' | 'nextjs' | 'python' | 'typescript' | 'json';

export interface IntentProp {
  key: string;
  label: string;
  value: string | number | boolean;
  unit?: string;
  nodeId: string;
  source?: string;
  confidence: number;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export type WarningSeverity = 'info' | 'warn' | 'error';

export interface ConstraintWarning {
  id: string;
  severity: WarningSeverity;
  message: string;
  propKey?: string;
  suggestion?: string;
}

/** The semantic layer: what the human meant, before it becomes syntax. */
export interface IntentModel {
  id: string;
  kind: string;
  label: string;
  props: IntentProp[];
  warnings: ConstraintWarning[];
  sourceText?: string;
  updatedAt: number;
}

export interface CodeRange {
  start: number;
  end: number;
}

export interface GeneratedCode {
  filename: string;
  language: string;
  code: string;
  /** nodeId -> 1-based inclusive line ranges in `code` */
  lineMap: Record<string, CodeRange[]>;
}

export interface EngineConfig {
  id: 'local' | 'remote';
  endpoint?: string;
  apiKey?: string;
  model?: string;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function cloneModel(model: IntentModel): IntentModel {
  return {
    ...model,
    props: model.props.map((p) => ({ ...p })),
    warnings: model.warnings.map((w) => ({ ...w })),
  };
}

export function findProp(model: IntentModel, key: string): IntentProp | undefined {
  return model.props.find((p) => p.key === key);
}

export function propNumber(model: IntentModel, key: string, fallback = 0): number {
  const p = findProp(model, key);
  const v = p ? Number(p.value) : NaN;
  return Number.isFinite(v) ? v : fallback;
}
