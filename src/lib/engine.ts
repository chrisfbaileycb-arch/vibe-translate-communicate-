import type { EngineConfig, IntentModel, TargetId, WorkflowEdge, WorkflowNode } from './types.ts';
import { cloneModel, newId } from './types.ts';
import { lint } from './lint.ts';
import { parseCorrection, parseUtterance, type ParseResult } from './parse.ts';
import {
  appendWorkflowStep,
  buildWorkflowModel,
  isWorkflowTarget,
  looksLikeWorkflow,
  normalizeGraph,
  workflowModel,
} from './workflow.ts';

/**
 * The translator engines.
 *  - local: deterministic, offline, instant. Great for the correction loop.
 *  - remote: any OpenAI-compatible endpoint. The response is still passed
 *    through the local constraint linter, so AI output cannot skip the sanity layer.
 */

export interface TranslatorEngine {
  id: string;
  label: string;
  describe: string;
  /** `target` picks the output family: UI schema (IntentModel props) or a workflow DAG. */
  translate(text: string, current: IntentModel | null, selection: string | null, target?: TargetId): Promise<ParseResult>;
}

function workflowResult(model: IntentModel, message: string, selection: string | null = null): ParseResult {
  model.warnings = lint(model);
  return { model, selection, message, changedKeys: model.props.map((p) => p.key) };
}

export class LocalRuleEngine implements TranslatorEngine {
  id = 'local';
  label = 'Local rules (offline)';
  describe = 'Deterministic parser + domain constraints. No network, instant, predictable.';

  async translate(text: string, current: IntentModel | null, selection: string | null, target?: TargetId): Promise<ParseResult> {
    if (current?.workflow) {
      const appended = appendWorkflowStep(cloneModel(current), text.trim());
      if (appended) {
        const added = appended.workflow!.nodes[appended.workflow!.nodes.length - 1];
        appended.updatedAt = Date.now();
        return workflowResult(appended, `Added ${added.type} step "${added.label}".`, added.id);
      }
      const correction = parseCorrection(text.trim(), current, selection);
      if (correction) return correction;
    }
    if (isWorkflowTarget(target) || looksLikeWorkflow(text)) {
      const model = buildWorkflowModel(text.trim());
      return workflowResult(model, `Interpreted as a ${model.workflow!.nodes.length}-node workflow.`);
    }
    return parseUtterance(text, current, selection);
  }
}

const SYSTEM_PROMPT = `You are the semantic layer of a voice-to-code translator.
Convert the user's utterance into an IntentModel JSON object. Never return code.
Schema:
{
  "kind": "furniture/table | furniture/chair | ui/button | ui/card | ui/form | generic/object",
  "label": "short human name",
  "props": [{ "key": "dot.separated", "label": "Human label", "value": number|string|boolean, "unit": "in|px|...", "confidence": 0..1, "source": "phrase from the user", "options": ["..."] }]
}
Rules:
- Canonical units: furniture dimensions in inches, UI dimensions in px.
- Keep the user's exact numbers. Do not "fix" implausible values — return them and describe the risk in "notes".
- If the message is a correction to an existing model (given below), return the FULL updated model and change only the targeted node.
- Also return {"notes": ["..."]} listing ambiguity or ergonomic risks you noticed.
Return ONLY JSON.`;

const WORKFLOW_PROMPT = `You are the semantic layer of a voice-to-workflow compiler.
Convert the user's utterance into a workflow DAG. Never return prose.
Schema:
{
  "label": "short pipeline name",
  "nodes": [{ "id": "step.1", "type": "trigger | validator | transform | action", "label": "human step name",
              "command": "single POSIX sh command (omit for triggers)", "detail": "cron expression, event name, etc.",
              "destination": "terminal | db | webhook | file" }],
  "edges": [{ "from": "step.1", "to": "step.2" }],
  "notes": ["risks or ambiguity"]
}
Rules:
- Start with exactly one trigger (mic, event, cron). Put a validator before any destructive step.
- Prefer portable POSIX commands. Never invent credentials; use $ENV_VARS.
- If an existing workflow is given, return the FULL updated graph and change only what the user asked.
Return ONLY JSON.`;

/** Pulls the first JSON object out of a reply that may be wrapped in prose or fences. */
export function extractJson(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('AI endpoint did not return JSON.');
  return JSON.parse(raw.slice(start, end + 1));
}

export function isOpenRouterEndpoint(endpoint: string): boolean {
  return /(^|\/\/)(?:[\w-]+\.)?openrouter\.ai\b/.test(endpoint);
}

/** Standard OpenAI-style auth, plus OpenRouter's app attribution headers when routing through it. */
export function chatHeaders(endpoint: string, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
  if (isOpenRouterEndpoint(endpoint)) {
    headers['HTTP-Referer'] = 'https://linguacode.app';
    headers['X-Title'] = 'LinguaCode';
  }
  return headers;
}

/** Hugging Face's router is OpenAI-compatible, but not every routed provider honours response_format. */
export function isHuggingFaceEndpoint(endpoint: string): boolean {
  return /(^|\/\/)(router|api-inference)\.huggingface\.co\b/.test(endpoint);
}

interface RemotePayload {
  kind?: string;
  label?: string;
  props?: Partial<{ key: string; label: string; value: string | number | boolean; unit: string; confidence: number; source: string; options: string[] }>[];
  notes?: string[];
}

export class RemoteLLMEngine implements TranslatorEngine {
  id = 'remote';
  label = 'AI endpoint';
  describe = 'Any OpenAI-compatible /chat/completions endpoint. Configured in the sidebar, stored in this browser only.';
  private config: EngineConfig;
  constructor(config: EngineConfig) {
    this.config = config;
  }

  async translate(text: string, current: IntentModel | null, selection: string | null, target?: TargetId): Promise<ParseResult> {
    const endpoint = (this.config.endpoint ?? '').trim().replace(/\/$/, '');
    if (!endpoint || !this.config.apiKey) {
      throw new Error('The AI engine needs a key — unlock the key vault in the sidebar first. Your key, your bill.');
    }

    const wantsWorkflow = isWorkflowTarget(target) || Boolean(current?.workflow);
    const huggingFace = isHuggingFaceEndpoint(endpoint);
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: chatHeaders(endpoint, this.config.apiKey),
      body: JSON.stringify({
        model: this.config.model || (huggingFace ? 'Qwen/Qwen2.5-Coder-32B-Instruct' : 'gpt-4o-mini'),
        temperature: 0,
        ...(huggingFace ? { max_tokens: 2048 } : { response_format: { type: 'json_object' } }),
        messages: [
          { role: 'system', content: wantsWorkflow ? WORKFLOW_PROMPT : SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              utterance: text,
              selection,
              existingModel: current
                ? { kind: current.kind, label: current.label, props: current.props, workflow: current.workflow }
                : null,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body = (await response.json()) as { error?: string | { message?: string } };
        detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? '');
      } catch {
        /* non-JSON error body */
      }
      const hint =
        response.status === 401 && huggingFace ? ' — check the token is an hf_ token with Read (or Inference) permission.' : '';
      throw new Error(`AI endpoint returned ${response.status}${detail ? `: ${detail}` : ''}${hint}`);
    }
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? '{}';

    if (wantsWorkflow) {
      const payload = extractJson(raw) as { label?: string; nodes?: Partial<WorkflowNode>[]; edges?: Partial<WorkflowEdge>[]; notes?: string[] };
      const graph = normalizeGraph(payload);
      if (graph.nodes.length === 0) throw new Error('AI endpoint returned an empty workflow.');
      const model = workflowModel(payload.label ?? current?.label ?? 'AI Pipeline', graph, text);
      if (current?.workflow) model.id = current.id;
      const result = workflowResult(model, `AI engine produced a ${graph.nodes.length}-node workflow. Safety re-checked locally.`);
      for (const note of payload.notes ?? []) {
        model.warnings.push({ id: `ai.note.${newId()}`, severity: 'info', message: note });
      }
      return result;
    }

    const parsed = extractJson(raw) as RemotePayload;

    const base = current ? cloneModel(current) : blankModel(parsed.label ?? 'Object');
    if (parsed.kind) base.kind = parsed.kind;
    if (parsed.label) base.label = parsed.label;
    for (const incoming of parsed.props ?? []) {
      if (!incoming.key) continue;
      const existing = base.props.find((p) => p.key === incoming.key);
      if (existing) {
        existing.value = incoming.value ?? existing.value;
        existing.confidence = incoming.confidence ?? 0.7;
        existing.source = incoming.source;
      } else {
        base.props.push({
          key: incoming.key,
          nodeId: incoming.key,
          label: incoming.label ?? incoming.key,
          value: incoming.value ?? 0,
          unit: incoming.unit,
          confidence: incoming.confidence ?? 0.7,
          source: incoming.source,
          options: incoming.options,
        });
      }
    }
    base.updatedAt = Date.now();
    base.sourceText = text;
    base.warnings = lint(base);
    for (const note of parsed.notes ?? []) {
      base.warnings.push({ id: `ai.note.${newId()}`, severity: 'info', message: note });
    }

    return {
      model: base,
      selection: null,
      message: `AI engine produced ${base.props.length} properties. Constraints re-checked locally.`,
      changedKeys: base.props.map((p) => p.key),
    };
  }
}

function blankModel(label: string): IntentModel {
  return { id: newId(), kind: 'generic/object', label, props: [], warnings: [], updatedAt: Date.now() };
}

export function createEngine(config: EngineConfig): TranslatorEngine {
  return config.id === 'remote' ? new RemoteLLMEngine(config) : new LocalRuleEngine();
}
