import { useRef, useState } from 'react';
import type { UsageStats, VaultBlob, VaultSecret } from '../lib/vault.ts';
import {
  clearSessionSecret,
  clearVault,
  decryptSecret,
  detectPresetForKey,
  keyPrefixWarning,
  encryptSecret,
  estimateTokens,
  loadVault,
  loadUsage,
  maskKey,
  parseVaultFile,
  presetForEndpoint,
  PROVIDER_PRESETS,
  purgeAllKeys,
  resetUsage,
  saveSessionSecret,
  saveVault,
  serializeVault,
} from '../lib/vault.ts';
import type { ProviderPreset } from '../lib/types.ts';

interface VaultPanelProps {
  secret: VaultSecret | null;
  isSessionOnly: boolean;
  onUnlock: (secret: VaultSecret, sessionOnly?: boolean) => void;
  onLock: () => void;
  onForget: () => void;
  onUsageChange: (usage: UsageStats) => void;
}

/** 1-click onramp for providers with a free token page (Hugging Face). */
function TokenOnramp({ preset }: { preset: ProviderPreset }) {
  if (!preset.tokenUrl) return null;
  const tip =
    "Select 'Read' permissions when creating your token. Your token stays client-side in session memory or encrypted local storage.";
  return (
    <div className="onramp">
      <a className="onramp-link" href={preset.tokenUrl} target="_blank" rel="noopener noreferrer">
        Get Free Hugging Face Token (No Card Required) ↗
      </a>
      <span className="onramp-tip" tabIndex={0} title={tip} aria-label={tip}>
        i
      </span>
      <p className="onramp-note">{tip}</p>
    </div>
  );
}

export default function VaultPanel({
  secret,
  isSessionOnly,
  onUnlock,
  onLock,
  onForget,
  onUsageChange,
}: VaultPanelProps) {
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'session' | 'vault'>('session');

  // Direct inputs — presets only prefill these, they never lock them.
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState(PROVIDER_PRESETS[0].endpoint);
  const [model, setModel] = useState(PROVIDER_PRESETS[0].defaultModel);

  // Vault passphrase states
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showRotate, setShowRotate] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  void revision;
  const stored: VaultBlob | null = loadVault();
  const usage = loadUsage();

  const flash = (message: string): void => {
    setNotice(message);
    setError(null);
  };

  /** Derived from what is typed, so a chip lights up for a matching URL and nothing is ever locked. */
  const activePreset = presetForEndpoint(endpoint);
  const keyWarning = keyPrefixWarning(apiKey, endpoint);

  const applyPreset = (preset: ProviderPreset) => {
    setEndpoint(preset.endpoint);
    setModel(preset.defaultModel);
  };

  /** Pasting a recognisable key (sk-or-, AIza, hf_) prefills its provider — unless a custom URL is already typed. */
  const handleKeyChange = (value: string) => {
    setApiKey(value);
    const detected = detectPresetForKey(value);
    if (detected && detected.id !== activePreset?.id && (activePreset || !endpoint.trim())) {
      applyPreset(detected);
      flash(`Looks like a ${detected.label} key — URL and model prefilled. Edit them freely.`);
    }
  };

  const modelListId = activePreset?.models ? `models-${activePreset.id}` : undefined;

  const connectionFields = (
    <>
      <div className="preset-chips" role="group" aria-label="Quick presets (optional)">
        {PROVIDER_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`preset-chip ${activePreset?.id === p.id ? 'on' : ''}`}
            aria-pressed={activePreset?.id === p.id}
            title={p.hint}
            onClick={() => applyPreset(p)}
          >
            {p.label.replace(/ \(.*\)$/, '')}
          </button>
        ))}
      </div>
      {activePreset?.tokenUrl ? <TokenOnramp preset={activePreset} /> : null}
      <label className="vault-input-label">
        API Key
        <input
          type="password"
          placeholder="sk-or-…, sk-…, AIza…, hf_… — any OpenAI-compatible key"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          onChange={(e) => handleKeyChange(e.target.value)}
        />
      </label>
      {keyWarning ? <p className="hint key-warning">{keyWarning}</p> : null}
      <div className="vault-grid-2">
        <label className="vault-input-label">
          Base Endpoint URL
          <input
            type="text"
            placeholder="https://openrouter.ai/api/v1"
            spellCheck={false}
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
          />
        </label>
        <label className="vault-input-label">
          Model Identifier
          <input
            type="text"
            placeholder="qwen/qwen-2.5-coder-32b-instruct"
            spellCheck={false}
            list={modelListId}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          {activePreset?.models ? (
            <datalist id={modelListId}>
              {activePreset.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          ) : null}
        </label>
      </div>
    </>
  );

  const wrap = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setRevision((r) => r + 1);
    }
  };

  // 1. Session-only (In-memory / SessionStorage)
  const setSessionKey = () =>
    wrap(async () => {
      const cleanKey = apiKey.trim();
      if (!cleanKey) throw new Error('Please paste your API key.');
      if (!endpoint.trim()) throw new Error('Enter the base endpoint URL.');
      const newSecret: VaultSecret = {
        apiKey: cleanKey,
        endpoint: endpoint.trim(),
        model: model.trim(),
      };
      saveSessionSecret(newSecret);
      setApiKey('');
      onUnlock(newSecret, true);
      onUsageChange(loadUsage());
      flash('Session key activated! Stored strictly in memory/session for this work session.');
    });

  // 2. Encrypted Vault (PBKDF2 + AES-GCM)
  const createVault = () =>
    wrap(async () => {
      if (pass.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
      if (pass !== confirm) throw new Error('The passphrases do not match.');
      if (!apiKey.trim()) throw new Error('Paste the API key you want to protect.');
      const newSecret = { apiKey: apiKey.trim(), endpoint: endpoint.trim(), model: model.trim() };
      const blob = await encryptSecret(pass, newSecret);
      saveVault(blob);
      setPass('');
      setConfirm('');
      setApiKey('');
      onUnlock(newSecret, false);
      onUsageChange(loadUsage());
      flash('Key encrypted and stored with AES-GCM. Unlocked for current session.');
    });

  const unlock = () =>
    wrap(async () => {
      if (!stored) throw new Error('No vault on this device yet.');
      const next = await decryptSecret(pass, stored);
      setPass('');
      onUnlock(next, false);
      onUsageChange(loadUsage());
      flash('Vault unlocked — the key lives in memory until locked or cleared.');
    });

  const rotatePassphrase = () =>
    wrap(async () => {
      if (!stored || !secret) throw new Error('Unlock the vault first.');
      if (pass.length < 8) throw new Error('Use a new passphrase of at least 8 characters.');
      if (pass !== confirm) throw new Error('The new passphrases do not match.');
      saveVault(await encryptSecret(pass, secret));
      setPass('');
      setConfirm('');
      setShowRotate(false);
      flash('Passphrase changed successfully.');
    });

  const replaceKey = () =>
    wrap(async () => {
      if (!stored || !secret) throw new Error('Unlock the vault first.');
      if (pass.length < 8) throw new Error('Enter the passphrase to re-encrypt the vault.');
      if (!apiKey.trim()) throw new Error('Paste the replacement API key.');
      const next = { apiKey: apiKey.trim(), endpoint: endpoint.trim(), model: model.trim() };
      saveVault(await encryptSecret(pass, next));
      setPass('');
      setApiKey('');
      setShowReplace(false);
      onUnlock(next, false);
      onUsageChange(loadUsage());
      flash('Key replaced and re-encrypted.');
    });

  const exportFile = () => {
    if (!stored) return;
    const url = URL.createObjectURL(new Blob([serializeVault(stored)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'code-translator-key.vault.json';
    a.click();
    URL.revokeObjectURL(url);
    flash('Encrypted vault exported.');
  };

  const importFile = (file: File) =>
    wrap(async () => {
      const blob = parseVaultFile(await file.text());
      saveVault(blob);
      onForget();
      setTab('vault');
      flash('Vault imported. Enter your passphrase to unlock.');
    });

  /** One click, no confirmation step: drop the key from inputs, React state, sessionStorage and the vault. */
  const destroyKey = () => {
    setApiKey('');
    setPass('');
    setConfirm('');
    setShowReplace(false);
    setShowRotate(false);
    purgeAllKeys();
    clearSessionSecret();
    clearVault();
    onForget();
    setRevision((r) => r + 1);
    flash('Key destroyed — removed from inputs, app memory, session storage and the encrypted vault.');
  };

  return (
    <div className="vault" data-revision={revision}>
      <header className="vault-head">
        <span
          className={`vault-state ${
            secret ? (isSessionOnly ? 'vault-session' : 'vault-open') : stored ? 'vault-locked' : ''
          }`}
        >
          {secret ? (isSessionOnly ? 'session active' : 'vault unlocked') : stored ? 'locked' : 'no key'}
        </span>
        <span className="vault-title">Bring-Your-Own API Key</span>
        {secret || stored || apiKey ? (
          <button type="button" className="destroy-btn" onClick={destroyKey}>
            Clear / Destroy Key
          </button>
        ) : null}
      </header>

      {secret ? (
        <div className="vault-body">
          <div className="vault-row">
            <span className="vault-label">Key Status</span>
            <span className="vault-chip">{isSessionOnly ? 'Session-Only (In-Memory)' : 'Encrypted Vault'}</span>
          </div>
          <div className="vault-row">
            <span className="vault-label">API Key</span>
            <code className="vault-key">{maskKey(secret.apiKey)}</code>
          </div>
          <div className="vault-row">
            <span className="vault-label">Endpoint</span>
            <code className="vault-key">{secret.endpoint || '—'}</code>
          </div>
          <div className="vault-row">
            <span className="vault-label">Model</span>
            <code className="vault-key">{secret.model || '—'}</code>
          </div>

          <div className="vault-meter">
            <div>
              <b>{usage.requests}</b> request{usage.requests === 1 ? '' : 's'} on your key
            </div>
            <div>
              ≈ <b>{estimateTokens(usage.promptChars + usage.outputChars).toLocaleString()}</b> tokens since{' '}
              {new Date(usage.since).toLocaleDateString()}
            </div>
          </div>

          <div className="vault-actions">
            <button type="button" className="ghost" onClick={onLock}>
              Lock session
            </button>
            {!isSessionOnly && stored ? (
              <>
                <button type="button" className="ghost" onClick={exportFile}>
                  Export vault file
                </button>
                <button type="button" className="ghost" onClick={() => setShowRotate((v) => !v)}>
                  Change passphrase
                </button>
                <button type="button" className="ghost" onClick={() => setShowReplace((v) => !v)}>
                  Replace key
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="ghost"
              onClick={() => {
                resetUsage();
                onUsageChange(loadUsage());
              }}
            >
              Reset meter
            </button>
          </div>

          {showReplace ? (
            <div className="vault-form">
              {connectionFields}
              <input
                type="password"
                placeholder="passphrase to re-encrypt"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
              <button type="button" className="primary" disabled={busy} onClick={replaceKey}>
                Replace &amp; re-encrypt
              </button>
            </div>
          ) : null}

          {showRotate ? (
            <div className="vault-form">
              <input
                type="password"
                placeholder="new passphrase"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
              <input
                type="password"
                placeholder="repeat new passphrase"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <button type="button" className="primary" disabled={busy} onClick={rotatePassphrase}>
                Re-encrypt vault
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="vault-body">
          <div className="vault-tab-bar">
            <button
              type="button"
              className={`vault-tab-btn ${tab === 'session' ? 'active' : ''}`}
              onClick={() => setTab('session')}
            >
              Session Key (Ephemeral)
            </button>
            <button
              type="button"
              className={`vault-tab-btn ${tab === 'vault' ? 'active' : ''}`}
              onClick={() => setTab('vault')}
            >
              Encrypted Vault {stored ? '(Locked)' : '(Persistent)'}
            </button>
          </div>

          {tab === 'session' ? (
            <div className="vault-form">
              <p className="hint">
                Enter an API key for your active beta testing workflows. It stays strictly in frontend memory, is never
                saved permanently to disk, and can be destroyed at any moment with one click. Presets below only prefill —
                every field stays editable.
              </p>
              {connectionFields}

              <div className="vault-actions">
                <button type="button" className="primary" disabled={busy} onClick={setSessionKey}>
                  Set Key for this Session
                </button>
                <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
                  Import vault file
                </button>
              </div>
            </div>
          ) : stored ? (
            <div className="vault-form">
              <p className="hint">
                This browser holds an encrypted vault protected with PBKDF2-SHA256 (600,000 iterations) + AES-GCM-256. Enter
                your passphrase to unlock.
              </p>
              <input
                type="password"
                placeholder="Enter passphrase"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void unlock()}
              />
              <div className="vault-actions">
                <button type="button" className="primary" disabled={busy} onClick={unlock}>
                  Unlock Vault
                </button>
                <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
                  Import vault file
                </button>
              </div>
            </div>
          ) : (
            <div className="vault-form">
              <p className="hint">
                Store your API key encrypted at rest on this device. Decrypted only in memory with your passphrase.
              </p>
              {connectionFields}
              <input
                type="password"
                placeholder="Choose passphrase (min 8 characters)"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
              <input
                type="password"
                placeholder="Repeat passphrase"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <div className="vault-actions">
                <button type="button" className="primary" disabled={busy} onClick={createVault}>
                  Encrypt &amp; Store
                </button>
                <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
                  Import vault file
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = '';
        }}
      />

      {notice ? <p className="vault-notice">{notice}</p> : null}
      {error ? <p className="error-line">{error}</p> : null}
    </div>
  );
}
