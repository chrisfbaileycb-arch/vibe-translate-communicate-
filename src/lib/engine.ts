import type { EngineConfig, IntentModel } from './types.ts';
import { cloneModel, newId } from './types.ts';
import { lint } from './lint.ts';
import { parseUtterance, type ParseResult } from './parse.ts';

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
  translate(text: string, current: IntentModel | null, selection: string | null): Promise<ParseResult>;
}

export class LocalRuleEngine implements TranslatorEngine {
  id = 'local';
  label = 'Local rules (offline)';
  describe = 'Deterministic parser + domain constraints. No network, instant, predictable.';

  async translate(text: string, current: IntentModel | null, selection: string | null): Promise<ParseResult> {
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
  constructor(private config: EngineConfig) {}

  async translate(text: string, current: IntentModel | null, selection: string | null): Promise<ParseResult> {
    const endpoint = (this.config.endpoint ?? '').trim().replace(/\/$/, '');
    if (!endpoint || !this.config.apiKey) {
      throw new Error('The AI engine needs a key — unlock the key vault in the sidebar first. Your key, your bill.');
    }

    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({
        model: this.config.model || 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              utterance: text,
              selection,
              existingModel: current ? { kind: current.kind, label: current.label, props: current.props } : null,
            }),
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`AI endpoint returned ${response.status}`);
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim()) as RemotePayload;

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
