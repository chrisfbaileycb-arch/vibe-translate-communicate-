import { decryptSecret, encryptSecret, keyPrefixWarning, maskKey, PROVIDER_PRESETS, type VaultBlob, type VaultSecret } from '../../src/lib/vault.ts';
import type { ShellTranslation } from '../../src/lib/shell.ts';
import { loadSettings, SECRET_KEY, SETTINGS_KEY, VAULT_KEY, type Reply, type Settings } from './shared.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const providerSelect = $<HTMLSelectElement>('provider');
const apiKey = $<HTMLInputElement>('api-key');
const endpoint = $<HTMLInputElement>('endpoint');
const model = $<HTMLInputElement>('model');
const modelList = $<HTMLDataListElement>('model-list');
const pass = $<HTMLInputElement>('pass');
const keyState = $<HTMLSpanElement>('key-state');
const keyStatus = $<HTMLParagraphElement>('key-status');
const autoCopy = $<HTMLInputElement>('auto-copy');

let settings: Settings;

function flash(message: string, isError = false) {
  keyStatus.textContent = message;
  keyStatus.className = `hint ${isError ? 'err' : 'ok'}`;
}

async function saveSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

function applyPreset(id: string) {
  const preset = PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[0];
  providerSelect.value = preset.id;
  endpoint.value = preset.endpoint;
  model.value = preset.defaultModel;
  modelList.innerHTML = (preset.models ?? []).map((m) => `<option value="${m}"></option>`).join('');
  $<HTMLDivElement>('onramp').hidden = !preset.tokenUrl;
}

async function refreshKeyState() {
  const [session, local] = await Promise.all([chrome.storage.session.get(SECRET_KEY), chrome.storage.local.get(VAULT_KEY)]);
  const secret = session[SECRET_KEY] as VaultSecret | undefined;
  const vault = local[VAULT_KEY] as VaultBlob | undefined;
  keyState.textContent = secret
    ? `${maskKey(secret.apiKey)} → ${secret.endpoint} (${secret.model})`
    : vault
      ? 'encrypted key saved — locked'
      : 'no key — local rules only';
  keyState.className = `keystate ${secret ? 'ok' : ''}`;
  $<HTMLButtonElement>('unlock').hidden = !vault || Boolean(secret);
}

/** Reads the form, validates the key against its preset, and asks for host access to custom endpoints. */
async function formSecret(): Promise<VaultSecret> {
  const secret = { apiKey: apiKey.value.trim(), endpoint: endpoint.value.trim().replace(/\/$/, ''), model: model.value.trim() };
  if (!secret.apiKey) throw new Error('Paste your API key first.');
  let origin: string;
  try {
    origin = new URL(secret.endpoint).origin;
  } catch {
    throw new Error('The endpoint must be a full URL, e.g. https://router.huggingface.co/v1');
  }
  if (!(await chrome.permissions.request({ origins: [`${origin}/*`] }))) {
    throw new Error(`The extension needs permission to call ${origin}.`);
  }
  return secret;
}

async function guarded(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    flash((error as Error).message, true);
  }
  await refreshKeyState();
}

async function init() {
  settings = await loadSettings();
  providerSelect.innerHTML = PROVIDER_PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  applyPreset(settings.provider);
  if (settings.endpoint) endpoint.value = settings.endpoint;
  if (settings.model) model.value = settings.model;
  autoCopy.checked = settings.autoCopy;
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name=engine]')) input.checked = input.value === settings.engine;
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name=speech]')) input.checked = input.value === settings.speech;

  const commands = await chrome.commands.getAll();
  $<HTMLParagraphElement>('shortcut-list').innerHTML = commands
    .filter((c) => c.name?.startsWith('toggle-voice'))
    .map((c) => (c.shortcut ? `<kbd>${c.shortcut}</kbd>` : '<em>not set</em>'))
    .join(' or ');
  await refreshKeyState();
}

providerSelect.addEventListener('change', () => {
  applyPreset(providerSelect.value);
  void saveSettings({ provider: providerSelect.value, endpoint: endpoint.value, model: model.value });
});
endpoint.addEventListener('change', () => void saveSettings({ endpoint: endpoint.value.trim() }));
model.addEventListener('change', () => void saveSettings({ model: model.value.trim() }));
apiKey.addEventListener('input', () => {
  const detected = PROVIDER_PRESETS.find((p) => p.tokenPrefix && apiKey.value.trim().startsWith(p.tokenPrefix));
  if (detected && detected.id !== providerSelect.value) {
    applyPreset(detected.id);
    void saveSettings({ provider: detected.id, endpoint: endpoint.value, model: model.value });
    flash(`Detected a ${detected.label} token — endpoint and model filled in.`);
  }
});
autoCopy.addEventListener('change', () => void saveSettings({ autoCopy: autoCopy.checked }));
for (const name of ['engine', 'speech'] as const) {
  for (const input of document.querySelectorAll<HTMLInputElement>(`input[name=${name}]`)) {
    input.addEventListener('change', () => void saveSettings({ [name]: input.value } as Partial<Settings>));
  }
}

$('use-session').addEventListener('click', () =>
  guarded(async () => {
    const secret = await formSecret();
    await chrome.storage.session.set({ [SECRET_KEY]: secret });
    await saveSettings({ engine: 'remote', endpoint: secret.endpoint, model: secret.model });
    document.querySelector<HTMLInputElement>('input[name=engine][value=remote]')!.checked = true;
    apiKey.value = '';
    flash(['Key active for this browser session. AI engine switched on.', keyPrefixWarning(secret.apiKey, secret.endpoint)].filter(Boolean).join(' '));
  }),
);

$('encrypt').addEventListener('click', () =>
  guarded(async () => {
    const secret = await formSecret();
    if (pass.value.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
    flash('Encrypting…');
    const blob = await encryptSecret(pass.value, secret);
    await chrome.storage.local.set({ [VAULT_KEY]: blob });
    await chrome.storage.session.set({ [SECRET_KEY]: secret });
    await saveSettings({ engine: 'remote', endpoint: secret.endpoint, model: secret.model });
    document.querySelector<HTMLInputElement>('input[name=engine][value=remote]')!.checked = true;
    apiKey.value = '';
    pass.value = '';
    flash('Key encrypted and remembered on this device, and unlocked for this session.');
  }),
);

$('unlock').addEventListener('click', () =>
  guarded(async () => {
    const stored = (await chrome.storage.local.get(VAULT_KEY))[VAULT_KEY] as VaultBlob | undefined;
    if (!stored) throw new Error('No saved key on this device.');
    flash('Decrypting…');
    const secret = await decryptSecret(pass.value, stored);
    await chrome.storage.session.set({ [SECRET_KEY]: secret });
    pass.value = '';
    flash('Unlocked until Chrome restarts.');
  }),
);

$('forget').addEventListener('click', () =>
  guarded(async () => {
    await chrome.storage.session.remove(SECRET_KEY);
    await chrome.storage.local.remove(VAULT_KEY);
    await saveSettings({ engine: 'local' });
    document.querySelector<HTMLInputElement>('input[name=engine][value=local]')!.checked = true;
    flash('Key deleted from session memory and local storage.');
  }),
);

$('edit-shortcuts').addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

// "Try it" — same pipeline as the overlay, also the fallback on pages Chrome won't inject into.
const tryOut = $<HTMLDivElement>('try-out');
const tryCmd = $<HTMLDivElement>('try-cmd');
const tryNote = $<HTMLParagraphElement>('try-note');
const tryStatus = $<HTMLParagraphElement>('try-status');
$<HTMLFormElement>('try-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $<HTMLInputElement>('try-input').value.trim();
  if (!text) return;
  tryStatus.textContent = 'Translating…';
  const reply = await chrome.runtime.sendMessage<Reply<ShellTranslation>>({ type: 'lc.translate', text });
  if (!reply?.ok) {
    tryOut.hidden = true;
    tryStatus.textContent = reply ? reply.error : 'Background not responding.';
    return;
  }
  const { command, note, safety, engine } = reply.data;
  tryCmd.textContent = command;
  tryCmd.className = safety.level;
  tryNote.textContent = note;
  tryNote.className = safety.level;
  tryOut.hidden = false;
  tryStatus.textContent = `via ${engine === 'remote' ? 'your AI endpoint' : 'local rules'}`;
});
$('try-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(tryCmd.textContent ?? '');
  tryStatus.textContent = 'Copied.';
});

void init();
