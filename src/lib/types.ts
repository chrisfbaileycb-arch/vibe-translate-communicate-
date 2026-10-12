export type TargetId = 'html' | 'nextjs' | 'python' | 'typescript' | 'json' | 'shell' | 'workflow';

/* ---------------------------------- workflow graph ---------------------------------- */

/** Trigger (mic/event) -> Validator (safety/flags) -> Transform/LLM (semantic conversion) -> Action (terminal/db/webhook). */
export type WorkflowNodeType = 'trigger' | 'validator' | 'transform' | 'action';

export type WorkflowDestination = 'terminal' | 'db' | 'webhook' | 'file';

export interface WorkflowNode {
  /** Doubles as the IntentProp key / nodeId, so canvas, semantic layer and code share one selection. */
  id: string;
  type: WorkflowNodeType;
  label: string;
  /** POSIX command this step compiles to (absent for pure triggers). */
  command?: string;
  detail?: string;
  destination?: WorkflowDestination;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

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
  /** Present when the intent is a backend/CLI workflow rather than a visual component. */
  workflow?: WorkflowGraph;
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

export interface ProviderPreset {
  id: string;
  label: string;
  endpoint: string;
  defaultModel: string;
  hint: string;
  /** Alternative models offered in a dropdown next to the default. */
  models?: string[];
  /** Where to mint a key, shown as a deep link. */
  tokenUrl?: string;
  /** Keys from this provider start with this prefix (e.g. "hf_"); used for detection and validation. */
  tokenPrefix?: string;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function cloneModel(model: IntentModel): IntentModel {
  return {
    ...model,
    props: model.props.map((p) => ({ ...p })),
    warnings: model.warnings.map((w) => ({ ...w })),
    workflow: model.workflow
      ? { nodes: model.workflow.nodes.map((n) => ({ ...n })), edges: model.workflow.edges.map((e) => ({ ...e })) }
      : undefined,
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
