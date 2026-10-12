import type { ShellTranslation } from '../../src/lib/shell.ts';

/** Message contract between overlay (content script), background worker and the offscreen clipboard page. */
export type OverlayRequest =
  | { type: 'lc.translate'; text: string }
  | { type: 'lc.transcribe'; audio: string; mime: string }
  | { type: 'lc.copy'; text: string }
  | { type: 'lc.status' };

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

export interface OverlayStatus {
  speech: SpeechMode;
  engine: 'local' | 'remote';
  autoCopy: boolean;
  shortcut: string;
}

export type TranslateReply = Reply<ShellTranslation>;

export type SpeechMode = 'webspeech' | 'whisper';

/** Non-secret settings, persisted in chrome.storage.local. */
export interface Settings {
  engine: 'local' | 'remote';
  speech: SpeechMode;
  provider: string;
  endpoint: string;
  model: string;
  autoCopy: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  engine: 'local',
  speech: 'webspeech',
  provider: 'huggingface',
  endpoint: 'https://router.huggingface.co/v1',
  model: 'Qwen/Qwen2.5-Coder-32B-Instruct',
  autoCopy: true,
};

export const SETTINGS_KEY = 'lc.settings';
/** Encrypted VaultBlob (PBKDF2 + AES-GCM, same format as the studio). */
export const VAULT_KEY = 'lc.vault';
/** Decrypted key — chrome.storage.session only: memory-backed, cleared on browser restart, never visible to pages. */
export const SECRET_KEY = 'lc.secret';

export const WHISPER_URL = 'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo';

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<Settings> | undefined) };
}
