/**
 * Vault crypto smoke test (Node 22 has WebCrypto + btoa/atob).
 * Run: npm test
 */
import {
  bumpUsage,
  decryptSecret,
  encryptSecret,
  estimateTokens,
  hasVault,
  loadUsage,
  maskKey,
  parseVaultFile,
  serializeVault,
} from './vault.ts';

const runtime = globalThis as {
  process?: { exitCode?: number };
  localStorage?: unknown;
};

let passed = 0;
function ok(condition: boolean, name: string, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`ok   ${name}`);
  } else {
    console.error(`FAIL ${name} ${detail}`);
    if (runtime.process) runtime.process.exitCode = 1;
  }
}

// Minimal localStorage shim so the usage meter can be exercised outside a browser.
const store = new Map<string, string>();
runtime.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
};

const secret = {
  apiKey: 'sk-test-1234567890abcdef',
  endpoint: 'https://api.example.com/v1',
  model: 'gpt-4o-mini',
};

const blob = await encryptSecret('correct horse battery staple', secret);
ok(blob.ciphertext.length > 40 && blob.salt.length > 10 && blob.iv.length > 10, 'encrypts to a salted+iv ciphertext');
ok(!JSON.stringify(blob).includes(secret.apiKey), 'ciphertext does not contain the key');

const opened = await decryptSecret('correct horse battery staple', blob);
ok(opened.apiKey === secret.apiKey && opened.endpoint === secret.endpoint, 'round-trips through the passphrase');

let wrongPassFailed = false;
try {
  await decryptSecret('wrong passphrase entirely', blob);
} catch (error) {
  wrongPassFailed = /Wrong passphrase/.test((error as Error).message);
}
ok(wrongPassFailed, 'wrong passphrase is rejected with a clear error');

const file = serializeVault(blob);
ok(!file.includes(secret.apiKey), 'exported vault file never contains the key');
const reimported = parseVaultFile(file);
ok(reimported.ciphertext === blob.ciphertext, 'exported file re-imports to the same vault');

const tampered = { ...blob, ciphertext: blob.ciphertext.slice(0, -4) + 'AAAA' };
let tamperFailed = false;
try {
  await decryptSecret('correct horse battery staple', tampered);
} catch {
  tamperFailed = true;
}
ok(tamperFailed, 'tampered ciphertext is rejected (AES-GCM authentication)');

ok(maskKey(secret.apiKey) !== secret.apiKey && maskKey(secret.apiKey).endsWith('cdef'), 'masks the key for display');
ok(estimateTokens(4000) === 1000, 'token estimate is roughly chars/4');

ok(hasVault() === false, 'starts with no vault');
const usage = bumpUsage(120, 80);
ok(usage.requests === 1 && loadUsage().promptChars === 120, 'usage meter counts requests and characters');

console.log(`\n${passed} checks passed${runtime.process?.exitCode ? ' — WITH FAILURES' : ''}`);
