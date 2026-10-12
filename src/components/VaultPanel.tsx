import { useRef, useState } from 'react';
import type { UsageStats, VaultBlob, VaultSecret } from '../lib/vault.ts';
import {
  clearVault,
  decryptSecret,
  encryptSecret,
  estimateTokens,
  loadVault,
  loadUsage,
  maskKey,
  parseVaultFile,
  resetUsage,
  saveVault,
  serializeVault,
} from '../lib/vault.ts';

interface VaultPanelProps {
  secret: VaultSecret | null;
  onUnlock: (secret: VaultSecret) => void;
  onLock: () => void;
  onForget: () => void;
  onUsageChange: (usage: UsageStats) => void;
}

/**
 * The "front door" for a bring-your-own key: it is encrypted before it is stored,
 * decrypted only in memory, and only ever sent to the endpoint its owner names.
 * Selling the product never means carrying somebody's token spend.
 */
export default function VaultPanel({ secret, onUnlock, onLock, onForget, onUsageChange }: VaultPanelProps) {
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-4o-mini');
  const [showRotate, setShowRotate] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  void revision; // re-reads localStorage after mutations
  const stored: VaultBlob | null = loadVault();
  const usage = loadUsage();

  const flash = (message: string): void => {
    setNotice(message);
    setError(null);
  };

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

  const createVault = () =>
    wrap(async () => {
      if (pass.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
      if (pass !== confirm) throw new Error('The passphrases do not match.');
      if (!apiKey.trim()) throw new Error('Paste the API key you want to protect.');
      const blob = await encryptSecret(pass, { apiKey: apiKey.trim(), endpoint: endpoint.trim(), model: model.trim() });
      saveVault(blob);
      const next = { apiKey: apiKey.trim(), endpoint: endpoint.trim(), model: model.trim() };
      setPass('');
      setConfirm('');
      setApiKey('');
      onUnlock(next);
      onUsageChange(loadUsage());
      flash('Key encrypted and stored. It is only readable with your passphrase.');
    });

  const unlock = () =>
    wrap(async () => {
      if (!stored) throw new Error('No vault on this device yet.');
      const next = await decryptSecret(pass, stored);
      setPass('');
      onUnlock(next);
      onUsageChange(loadUsage());
      flash('Vault unlocked — the key lives in memory until you lock it.');
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
      flash('Passphrase changed. The old one no longer opens this vault.');
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
      onUnlock(next);
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
    flash('Encrypted vault exported. Without your passphrase it is unreadable.');
  };

  const importFile = (file: File) =>
    wrap(async () => {
      const blob = parseVaultFile(await file.text());
      saveVault(blob);
      onForget();
      flash('Vault imported. Unlock it with the passphrase it was created with.');
    });

  const forget = () => {
    clearVault();
    onForget();
    flash('Vault deleted from this device.');
  };

  return (
    <div className="vault" data-revision={revision}>
      <header className="vault-head">
        <span className={`vault-state ${secret ? 'vault-open' : ''}`}>{secret ? 'unlocked' : stored ? 'locked' : 'no vault'}</span>
        <span className="vault-title">Key vault · bring your own key</span>
      </header>

      {secret ? (
        <div className="vault-body">
          <div className="vault-row">
            <span className="vault-label">API key</span>
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
              Lock now
            </button>
            <button type="button" className="ghost" onClick={exportFile}>
              Export encrypted file
            </button>
            <button type="button" className="ghost" onClick={() => setShowRotate((v) => !v)}>
              Change passphrase
            </button>
            <button type="button" className="ghost" onClick={() => setShowReplace((v) => !v)}>
              Replace key
            </button>
            <button type="button" className="ghost danger" onClick={forget}>
              Forget vault
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                resetUsage();
                onUsageChange(loadUsage());
              }}
            >
              Reset counter
            </button>
          </div>

          {showReplace ? (
            <div className="vault-form">
              <input type="password" placeholder="passphrase to re-encrypt" value={pass} onChange={(e) => setPass(e.target.value)} />
              <input type="password" placeholder="new API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <input type="text" placeholder="endpoint (https://…/v1)" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
              <input type="text" placeholder="model" value={model} onChange={(e) => setModel(e.target.value)} />
              <button type="button" className="primary" disabled={busy} onClick={replaceKey}>
                Replace &amp; re-encrypt
              </button>
            </div>
          ) : null}

          {showRotate ? (
            <div className="vault-form">
              <input type="password" placeholder="new passphrase" value={pass} onChange={(e) => setPass(e.target.value)} />
              <input type="password" placeholder="repeat new passphrase" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <button type="button" className="primary" disabled={busy} onClick={rotatePassphrase}>
                Re-encrypt vault
              </button>
            </div>
          ) : null}
        </div>
      ) : stored ? (
        <div className="vault-body">
          <p className="hint">
            This device holds an encrypted vault. The passphrase never leaves your head — there is no reset link, because
            nothing here can read it without you.
          </p>
          <div className="vault-form">
            <input
              type="password"
              placeholder="passphrase"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void unlock()}
            />
            <button type="button" className="primary" disabled={busy} onClick={unlock}>
              Unlock
            </button>
            <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
              Import vault file
            </button>
            <button type="button" className="ghost danger" onClick={forget}>
              Forget vault
            </button>
          </div>
        </div>
      ) : (
        <div className="vault-body">
          <p className="hint">
            Store an API key encrypted in this browser. It is decrypted only in memory, sent only to the endpoint you name
            here, and never touches the app's own infrastructure — so the usage runs on <b>your</b> account, not the
            product's.
          </p>
          <div className="vault-form">
            <input type="password" placeholder="choose a passphrase (min 8 chars)" value={pass} onChange={(e) => setPass(e.target.value)} />
            <input type="password" placeholder="repeat passphrase" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <input type="password" placeholder="API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <input type="text" placeholder="endpoint (https://…/v1)" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
            <input type="text" placeholder="model" value={model} onChange={(e) => setModel(e.target.value)} />
            <button type="button" className="primary" disabled={busy} onClick={createVault}>
              Encrypt &amp; store
            </button>
            <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
              Import vault file
            </button>
          </div>
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
      <p className="hint">
        Encrypted at rest with PBKDF2-SHA256 (600k iterations) → AES-GCM-256. Keep the passphrase; if it is lost, the key
        is unrecoverable from this vault (re-import from your provider instead).
      </p>
    </div>
  );
}
