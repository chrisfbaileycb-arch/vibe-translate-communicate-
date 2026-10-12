/**
 * Bring-your-own-key vault.
 *
 * The API key is encrypted at rest with a passphrase-derived key (PBKDF2-SHA256
 * -> AES-GCM-256) using the browser's WebCrypto. The passphrase is never stored,
 * so the vault is unreadable without it — including to anyone with the device,
 * the localStorage dump, or an exported vault file.
 *
 * The plaintext key exists in memory only while unlocked, and is sent only to
 * the endpoint the owner configures. There is no server side of this app, so
 * the key cannot leak through us: the bill — and the credential — stay with the
 * person who brought the key.
 */

import type { ProviderPreset } from './types.ts';

export interface VaultSecret {
  apiKey: string;
  endpoint: string;
  model: string;
}

export interface VaultBlob {
  v: 1;
  kdf: { name: 'PBKDF2'; iterations: number; hash: 'SHA-256' };
  cipher: 'AES-GCM';
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface UsageStats {
  requests: number;
  promptChars: number;
  outputChars: number;
  since: string;
}

const VAULT_KEY = 'ct.vault.v1';
const SESSION_VAULT_KEY = 'ct.session_vault.v1';
const USAGE_KEY = 'ct.usage.v1';
const PBKDF2_ITERATIONS = 600_000;

export type { ProviderPreset };

export const HF_PRESET_ID = 'huggingface';

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    defaultModel: 'qwen/qwen-2.5-coder-32b-instruct',
    models: ['qwen/qwen-2.5-coder-32b-instruct', 'deepseek/deepseek-chat'],
    hint: 'One key for hundreds of models. Set a credit cap on the key at openrouter.ai.',
    tokenPrefix: 'sk-or-',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    hint: 'Google AI Studio key via the OpenAI-compatible endpoint.',
    tokenPrefix: 'AIza',
  },
  {
    id: HF_PRESET_ID,
    label: 'Hugging Face (Free Serverless Router)',
    endpoint: 'https://router.huggingface.co/v1',
    defaultModel: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    models: ['Qwen/Qwen2.5-Coder-32B-Instruct', 'meta-llama/Llama-3.1-8B-Instruct'],
    hint: 'Free-tier Hugging Face token with Read permission.',
    tokenUrl: 'https://huggingface.co/settings/tokens',
    tokenPrefix: 'hf_',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    hint: 'OpenAI API key.',
  },
  {
    id: 'custom',
    label: 'Local / Custom Proxy',
    endpoint: 'http://localhost:11434/v1',
    defaultModel: 'llama3',
    hint: 'Any OpenAI-compatible /chat/completions endpoint (Ollama, LiteLLM, vLLM, your proxy).',
  },
];

/** The preset whose endpoint is currently typed in, if any — presets prefill, they never lock. */
export function presetForEndpoint(endpoint: string): ProviderPreset | undefined {
  const clean = endpoint.trim().replace(/\/+$/, '');
  return PROVIDER_PRESETS.find((p) => p.endpoint === clean);
}

/** Non-blocking: a hint when a key does not look like the selected provider's keys. */
export function keyPrefixWarning(apiKey: string, endpoint: string): string | null {
  const preset = presetForEndpoint(endpoint);
  const key = apiKey.trim();
  if (!key || !preset?.tokenPrefix || key.startsWith(preset.tokenPrefix)) return null;
  return `${preset.label} keys usually start with "${preset.tokenPrefix}" — using it anyway.`;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function b64encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function b64decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', toArrayBuffer(encoder.encode(passphrase)), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSecret(passphrase: string, secret: VaultSecret): Promise<VaultBlob> {
  if (!passphrase) throw new Error('A passphrase is required to encrypt the key.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(encoder.encode(JSON.stringify(secret))),
  );
  return {
    v: 1,
    kdf: { name: 'PBKDF2', iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    cipher: 'AES-GCM',
    salt: b64encode(salt),
    iv: b64encode(iv),
    ciphertext: b64encode(new Uint8Array(ciphertext)),
  };
}

export async function decryptSecret(passphrase: string, blob: VaultBlob): Promise<VaultSecret> {
  try {
    const key = await deriveKey(passphrase, b64decode(blob.salt), blob.kdf?.iterations ?? PBKDF2_ITERATIONS);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(b64decode(blob.iv)) },
      key,
      toArrayBuffer(b64decode(blob.ciphertext)),
    );
    return JSON.parse(decoder.decode(plaintext)) as VaultSecret;
  } catch {
    throw new Error('Wrong passphrase — or the vault file is corrupted.');
  }
}

/* ---------------------------------- storage ---------------------------------- */

export function loadVault(): VaultBlob | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    return raw ? (JSON.parse(raw) as VaultBlob) : null;
  } catch {
    return null;
  }
}

export function saveVault(blob: VaultBlob): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(blob));
}

export function clearVault(): void {
  localStorage.removeItem(VAULT_KEY);
}

export function hasVault(): boolean {
  return loadVault() !== null;
}

export function saveSessionSecret(secret: VaultSecret): void {
  try {
    sessionStorage.setItem(SESSION_VAULT_KEY, JSON.stringify(secret));
  } catch {
    /* ignore session storage restrictions */
  }
}

export function loadSessionSecret(): VaultSecret | null {
  try {
    const raw = sessionStorage.getItem(SESSION_VAULT_KEY);
    return raw ? (JSON.parse(raw) as VaultSecret) : null;
  } catch {
    return null;
  }
}

export function clearSessionSecret(): void {
  try {
    sessionStorage.removeItem(SESSION_VAULT_KEY);
  } catch {
    /* ignore */
  }
}

export function purgeAllKeys(): void {
  clearSessionSecret();
  clearVault();
}

/** Portable encrypted vault file — safe to hand to someone; useless without the passphrase. */
export function serializeVault(blob: VaultBlob): string {
  return JSON.stringify(
    {
      kind: 'code-translator/vault',
      v: 1,
      note: 'Encrypted with a passphrase you chose. Import it in Code Translator; without the passphrase it cannot be read.',
      createdAt: new Date().toISOString(),
      blob,
    },
    null,
    2,
  );
}

export function parseVaultFile(text: string): VaultBlob {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const record = parsed as { blob?: Partial<VaultBlob> } | null;
  const blob = (record?.blob ?? (parsed as Partial<VaultBlob>)) as VaultBlob;
  if (!blob?.ciphertext || !blob?.salt || !blob?.iv || !blob?.kdf) {
    throw new Error('That file is not a Code Translator vault.');
  }
  return blob;
}

/* ---------------------------------- usage meter ---------------------------------- */

export function loadUsage(): UsageStats {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (raw) return JSON.parse(raw) as UsageStats;
  } catch {
    /* ignore */
  }
  return { requests: 0, promptChars: 0, outputChars: 0, since: new Date().toISOString() };
}

export function bumpUsage(promptChars: number, outputChars: number): UsageStats {
  const usage = loadUsage();
  usage.requests += 1;
  usage.promptChars += promptChars;
  usage.outputChars += outputChars;
  localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  return usage;
}

export function resetUsage(): void {
  localStorage.setItem(USAGE_KEY, JSON.stringify({ requests: 0, promptChars: 0, outputChars: 0, since: new Date().toISOString() }));
}

/** Rough bill-shock guard: ~4 characters per token for English prose + JSON. */
export function estimateTokens(chars: number): number {
  return Math.round(chars / 4);
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 3)}${'•'.repeat(Math.min(12, key.length - 7))}${key.slice(-4)}`;
}

/** Picks the preset a pasted key belongs to, by its prefix (e.g. hf_ -> Hugging Face). */
export function detectPresetForKey(apiKey: string): ProviderPreset | undefined {
  const key = apiKey.trim();
  return PROVIDER_PRESETS.find((p) => p.tokenPrefix && key.startsWith(p.tokenPrefix));
}
