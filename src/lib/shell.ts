import type { EngineConfig } from './types.ts';
import { classifyCommand, type CommandSafety } from './safety.ts';
import { buildWorkflowGraph } from './workflow.ts';
import { chatHeaders, extractJson, isHuggingFaceEndpoint } from './engine.ts';

/**
 * Intent -> ONE executable POSIX command line, plus a one-line safety note.
 * Shared by the studio and the Terminal Voice Companion extension.
 * Whatever produced the command (rules or an LLM), safety is always re-checked locally.
 */

export interface ShellTranslation {
  command: string;
  safety: CommandSafety;
  note: string;
  engine: 'local' | 'remote';
}

const SHELL_PROMPT = `You translate a spoken request into exactly one POSIX sh command line.
Return ONLY JSON: {"command": "<single line>"}.
Rules:
- No prose, no explanation, no markdown, no comments.
- If several steps are needed, chain them with && on one line.
- Never include secrets; use $ENV_VARS.
- If the request is not a shell task, return {"command": ""}.`;

/** Collapses whatever came back into a single line with no trailing newline, so pasting never auto-runs it. */
export function sanitizeCommand(raw: string): string {
  return raw
    .replace(/^```[\w-]*\s*|```\s*$/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\$\s+/, ''))
    .filter((line) => line && !line.startsWith('#'))
    .join(' && ')
    .trim();
}

/** "⛔ DESTRUCTIVE (-rf): rm deletes or destroys data" — one line, plain text. */
export function safetyNote(safety: CommandSafety): string {
  const reasons = safety.reasons.filter((r) => r !== 'read-only').map((r) => r.replace(/`/g, ''));
  if (safety.level === 'safe') return '✓ Read-only — safe to run.';
  if (safety.level === 'caution') return `⚠ Writes files or uses the network: ${reasons.join('; ')}.`;
  const risky = safety.flags.filter((f) => /^(?:-[a-z]*[rf][a-z]*|--force|--hard|-delete|--delete|--no-preserve-root)$/i.test(f));
  return `⛔ DESTRUCTIVE${risky.length ? ` (${risky.join(' ')})` : ''}: ${reasons.join('; ')}. Review before pressing Enter.`;
}

function finish(command: string, engine: ShellTranslation['engine']): ShellTranslation {
  const safety = classifyCommand(command);
  return { command, safety, note: safetyNote(safety), engine };
}

/** Deterministic, offline: reuses the workflow parser and keeps only real commands. */
export function translateShellLocal(text: string): ShellTranslation | null {
  const commands = buildWorkflowGraph(text.trim())
    .nodes.map((n) => n.command)
    .filter((c): c is string => Boolean(c) && !c!.startsWith('echo "TODO'));
  if (commands.length === 0) return null;
  return finish(commands.join(' && '), 'local');
}

export async function translateShell(
  text: string,
  config: EngineConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ShellTranslation> {
  const clean = text.trim();
  if (!clean) throw new Error('Nothing heard.');

  if (config.id === 'remote' && config.apiKey && config.endpoint) {
    const endpoint = config.endpoint.trim().replace(/\/$/, '');
    const huggingFace = isHuggingFaceEndpoint(endpoint);
    const response = await fetchImpl(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: chatHeaders(endpoint, config.apiKey),
      body: JSON.stringify({
        model: config.model || (huggingFace ? 'Qwen/Qwen2.5-Coder-32B-Instruct' : 'gpt-4o-mini'),
        temperature: 0,
        max_tokens: 300,
        ...(huggingFace ? {} : { response_format: { type: 'json_object' } }),
        messages: [
          { role: 'system', content: SHELL_PROMPT },
          { role: 'user', content: clean },
        ],
      }),
    });
    if (!response.ok) throw new Error(`AI endpoint returned ${response.status}`);
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const payload = extractJson(data.choices?.[0]?.message?.content ?? '{}') as { command?: string };
    const command = sanitizeCommand(String(payload.command ?? ''));
    if (!command) throw new Error('That does not sound like a shell task.');
    return finish(command, 'remote');
  }

  const local = translateShellLocal(clean);
  if (!local) throw new Error('No local rule matches that yet. Rephrase it, or add your own AI key for open-ended requests.');
  return local;
}
