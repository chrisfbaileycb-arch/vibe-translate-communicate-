import { useRef, useState, useEffect } from 'react';
import type { UsageStats, VaultBlob, VaultSecret } from '../lib/vault.ts';
import {
  clearKeyFromServerSession,
  clearSessionSecret,
  clearVault,
  decryptSecret,
  detectPresetForKey,
  keyPrefixWarning,
  encryptSecret,
  estimateTokens,
  fetchServerVaultStatus,
  getServerSessionId,
  loadVault,
  loadUsage,
  maskKey,
  parseVaultFile,
  presetForEndpoint,
  PROVIDER_PRESETS,
  purgeAllKeys,
  resetUsage,
  saveKeyToServerSession,
  saveVault,
  serializeVault,
} from '../lib/vault.ts';
import type { ProviderPreset } from '../lib/types.ts';

interface VaultPanelProps {
  secret: VaultSecret | null;
  isSessionOnly: boolean;
  serverMaskedKey?: string | null;
  onUnlock: (secret: VaultSecret, sessionOnly?: boolean, sessionId?: string) => void;
  onLock: () => void;
  onForget: () => void;
  onUsageChange: (usage: UsageStats) => void;
}

/** 1-click onramp for providers with a free token page (Hugging Face). */
function TokenOnramp({ preset }: { preset: ProviderPreset }) {
  if (!preset.tokenUrl) return null;
  const tip =
    "Select 'Read' permissions when creating your token. Your token is transferred to backend memory only and never saved to browser storage.";
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
  serverMaskedKey,
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
  const [showPassword, setShowPassword] = useState(false);
  const [endpoint, setEndpoint] = useState(PROVIDER_PRESETS[0].endpoint);
  const [model, setModel] = useState(PROVIDER_PRESETS[0].defaultModel);
  const [serverMasked, setServerMasked] = useState<string | null>(serverMaskedKey ?? null);

  // Vault passphrase states
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showRotate, setShowRotate] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  void revision;
  const stored: VaultBlob | null = loadVault();
  const usage = loadUsage();

  useEffect(() => {
    if (serverMaskedKey) {
      setServerMasked(serverMaskedKey);
    } else {
      // Check server status in case page was reloaded with active backend session
      const sid = getServerSessionId();
      if (sid) {
        fetchServerVaultStatus(sid).then((status) => {
          if (status.hasSessionKey && status.maskedKey) {
            setServerMasked(status.maskedKey);
          }
        });
      }
    }
  }, [serverMaskedKey]);

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
        <span>API Key (Backend Memory Input)</span>
        <div className="vault-key-input-wrapper">
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="sk-or-…, sk-…, AIza…, hf_… — your personal API key"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => handleKeyChange(e.target.value)}
          />
          <button
            type="button"
            className="vault-eye-btn"
            onClick={() => setShowPassword((v) => !v)}
            title={showPassword ? 'Hide key' : 'Show key'}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>
      {keyWarning ? <p className="hint key-warning">{keyWarning}</p> : null}
      <div className="vault-grid-2">
        <label className="vault-input-label">
          <span>Base Endpoint URL</span>
          <input
            type="text"
            placeholder="https://openrouter.ai/api/v1"
            spellCheck={false}
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
          />
        </label>
        <label className="vault-input-label">
          <span>Model Identifier</span>
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

  // 1. Session-only (Backend In-Memory / Zero Browser Storage)
  const setSessionKey = () =>
    wrap(async () => {
      const cleanKey = apiKey.trim();
      if (!cleanKey) throw new Error('Please paste your API key.');
      if (!endpoint.trim()) throw new Error('Enter the base endpoint URL.');
      const res = await saveKeyToServerSession({
        apiKey: cleanKey,
        endpoint: endpoint.trim(),
        model: model.trim(),
      });
      setApiKey('');
      setServerMasked(res.maskedKey);
      onUnlock(
        {
          apiKey: '', // Plaintext key is NOT held in client memory
          endpoint: endpoint.trim(),
          model: model.trim(),
        },
        true,
        res.sessionId,
      );
      onUsageChange(loadUsage());
      flash('API key sent to backend server RAM! Not stored in browser (immune to scraping).');
    });

  // Delete key from backend immediately
  const deleteBackendKey = () =>
    wrap(async () => {
      await clearKeyFromServerSession();
      setServerMasked(null);
      setApiKey('');
      onForget();
      flash('API key deleted from backend RAM. Zero keys active.');
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

  /** One click, no confirmation step: drop the key from inputs, React state, backend session and the vault. */
  const destroyKey = () => {
    setApiKey('');
    setPass('');
    setConfirm('');
    setShowReplace(false);
    setShowRotate(false);
    setServerMasked(null);
    purgeAllKeys();
    clearSessionSecret();
    clearVault();
    onForget();
    setRevision((r) => r + 1);
    flash('Key deleted — completely removed from backend memory and browser storage.');
  };

  const isBackendActive = isSessionOnly || Boolean(serverMasked);

  return (
    <div className="vault" data-revision={revision}>
      <header className="vault-head">
        <span
          className={`vault-state ${
            secret || serverMasked
              ? isBackendActive
                ? 'vault-session'
                : 'vault-open'
              : stored
              ? 'vault-locked'
              : ''
          }`}
        >
          {secret || serverMasked
            ? isBackendActive
              ? 'backend ram active'
              : 'vault unlocked'
            : stored
            ? 'locked'
            : 'no key'}
        </span>
        <span className="vault-title">Bring-Your-Own API Key</span>
        {secret || stored || apiKey || serverMasked ? (
          <button type="button" className="destroy-btn" onClick={destroyKey}>
            Delete / Purge Key
          </button>
        ) : null}
      </header>

      {secret || serverMasked ? (
        <div className="vault-body">
          <div className="vault-security-banner active">
            <span className="vault-shield-icon">🛡️</span>
            <div>
              <strong>Scrape-Proof Backend Memory Active</strong>
              <p>
                Your API key is safely held in backend server RAM. It is <strong>never stored in the browser</strong>{' '}
                (no localStorage, sessionStorage, or cookies), so it cannot be scraped.
              </p>
            </div>
          </div>

          <div className="vault-row">
            <span className="vault-label">Storage</span>
            <span className="vault-chip">
              {isBackendActive ? 'Backend Server RAM (Not in Browser)' : 'Encrypted Vault'}
            </span>
          </div>
          <div className="vault-row">
            <span className="vault-label">API Key</span>
            <code className="vault-key">
              {serverMasked || (secret?.apiKey ? maskKey(secret.apiKey) : '•••••••• (Backend Secured)')}
            </code>
          </div>
          <div className="vault-row">
            <span className="vault-label">Endpoint</span>
            <code className="vault-key">{secret?.endpoint || endpoint || 'Backend Default'}</code>
          </div>
          <div className="vault-row">
            <span className="vault-label">Model</span>
            <code className="vault-key">{secret?.model || model || 'Backend Default'}</code>
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
            {isBackendActive ? (
              <button type="button" className="ghost danger" onClick={deleteBackendKey}>
                🗑️ Delete Key from Backend
              </button>
            ) : null}
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
              Backend In-Memory (Zero Browser Storage)
            </button>
            <button
              type="button"
              className={`vault-tab-btn ${tab === 'vault' ? 'active' : ''}`}
              onClick={() => setTab('vault')}
            >
              Encrypted Vault {stored ? '(Locked)' : '(Device Storage)'}
            </button>
          </div>

          {tab === 'session' ? (
            <div className="vault-form">
              <div className="vault-security-banner">
                <span className="vault-shield-icon">🛡️</span>
                <div>
                  <strong>Scrape-Proof Backend Memory Input</strong>
                  <p>
                    Enter an API key to execute translation workflows. Your key is sent directly to the backend
                    server's RAM and is <strong>never stored in the browser</strong> (no localStorage, sessionStorage, or
                    cookies). When you finish, click <strong>Delete Key from Backend</strong> to erase it completely.
                  </p>
                </div>
              </div>

              {connectionFields}

              <div className="vault-actions">
                <button type="button" className="primary" disabled={busy} onClick={setSessionKey}>
                  🔒 Set Backend Key for Workflows
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
