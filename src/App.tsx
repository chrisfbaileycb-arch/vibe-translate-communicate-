import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { EngineConfig, IntentModel, TargetId } from './lib/types.ts';
import { cloneModel } from './lib/types.ts';
import { lint } from './lib/lint.ts';
import { generate, generatePreviewDoc } from './lib/generate.ts';
import { reverseFromCode, type ReverseResult } from './lib/reverse.ts';
import { createEngine } from './lib/engine.ts';
import { useSpeech } from './lib/useSpeech.ts';
import type { UsageStats, VaultSecret } from './lib/vault.ts';
import {
  bumpUsage,
  clearSessionSecret,
  loadSessionSecret,
  loadUsage,
  purgeAllKeys,
} from './lib/vault.ts';
import {
  auth,
  loginWithGoogle,
  logoutUser,
  onAuthStateChanged,
  saveTranslationWorkflow,
  subscribeToUserTranslations,
  deleteTranslationWorkflow,
  testConnection,
  type SavedTranslationRecord,
} from './lib/firebase.ts';
import MicButton from './components/MicButton.tsx';
import VaultPanel from './components/VaultPanel.tsx';
import IntentPanel from './components/IntentPanel.tsx';
import CodePanel from './components/CodePanel.tsx';
import PreviewPanel from './components/PreviewPanel.tsx';

type Mode = 'speak' | 'reverse';

const TARGETS: { id: TargetId; label: string }[] = [
  { id: 'nextjs', label: 'Next.js / React (TSX)' },
  { id: 'html', label: 'HTML + CSS' },
  { id: 'python', label: 'Python' },
  { id: 'typescript', label: 'TypeScript contract' },
  { id: 'json', label: 'Intent model (JSON)' },
];

const QUICK_PHRASES = [
  'Build a wooden table, 48 inch top, 2 inch legs',
  'Make the legs 29 inches',
  'Select the top width',
  'Make it wider',
  'A blue button that says "Save"',
];

const PLACEHOLDER_DOC = `<!doctype html>
<html><head><meta charset="utf-8"><style>
body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
font-family:ui-sans-serif,system-ui,sans-serif;background:radial-gradient(120% 120% at 20% 0%,#f8fafc,#e2e8f0);color:#64748b}
div{text-align:center;line-height:1.7}b{color:#0f172a;font-size:15px}
</style></head><body><div><b>Scratch render waiting</b><br>Speak or type an intent on the left,<br>or paste code in reverse mode.</div></body></html>`;

function loadEngineConfig(): EngineConfig {
  try {
    const raw = localStorage.getItem('ct.engine');
    if (raw) {
      const parsed = JSON.parse(raw) as EngineConfig & { apiKey?: string };
      return { id: parsed.id === 'remote' ? 'remote' : 'local', endpoint: parsed.endpoint, model: parsed.model };
    }
  } catch {
    /* ignore */
  }
  return { id: 'local' };
}

interface LogItem {
  id: string;
  text: string;
}

export default function App() {
  const [mode, setMode] = useState<Mode>('speak');
  const [target, setTarget] = useState<TargetId>('nextjs');
  const [model, setModel] = useState<IntentModel | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [history, setHistory] = useState<IntentModel[]>([]);
  const [log, setLog] = useState<LogItem[]>([]);
  const logCounterRef = useRef(0);
  const [transcript, setTranscript] = useState('');
  const [reverseCode, setReverseCode] = useState('');
  const [reverse, setReverse] = useState<ReverseResult | null>(null);
  const [engineConfig, setEngineConfig] = useState<EngineConfig>(loadEngineConfig);
  const [busy, setBusy] = useState(false);

  // Session vs Vault API key
  const [vaultSecret, setVaultSecret] = useState<VaultSecret | null>(loadSessionSecret);
  const [isSessionOnly, setIsSessionOnly] = useState<boolean>(() => loadSessionSecret() !== null);
  const [usage, setUsage] = useState<UsageStats>(loadUsage);
  const autoLockRef = useRef<number | null>(null);

  // Firebase auth & cloud state
  const [user, setUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [savedWorkflows, setSavedWorkflows] = useState<SavedTranslationRecord[]>([]);
  const [firebaseOnline, setFirebaseOnline] = useState(false);

  const pushLog = useCallback((message: string) => {
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logCounterRef.current += 1;
    const item: LogItem = {
      id: `log_${Date.now()}_${logCounterRef.current}`,
      text: `${stamp} — ${message}`,
    };
    setLog((entries) => [item, ...entries].slice(0, 16));
  }, []);

  // 1. Initial Firestore connection test
  useEffect(() => {
    let mounted = true;
    testConnection()
      .then((ok) => {
        if (!mounted) return;
        setFirebaseOnline(ok);
        if (ok) pushLog('Firebase Firestore connected.');
      })
      .catch(() => {
        if (mounted) setFirebaseOnline(false);
      });
    return () => {
      mounted = false;
    };
  }, [pushLog]);

  // 2. Firebase Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        pushLog(`Signed in as ${currentUser.email || currentUser.displayName}`);
      }
    });
    return () => unsub();
  }, [pushLog]);

  // 3. Real-time subscriber to user saved translation workflows
  useEffect(() => {
    if (!user) {
      setSavedWorkflows([]);
      return;
    }
    const unsub = subscribeToUserTranslations(
      user.uid,
      (list) => setSavedWorkflows(list),
      (err) => pushLog(`Firestore sync notice: ${(err as Error).message}`),
    );
    return () => unsub();
  }, [user, pushLog]);

  const armAutoLock = useCallback(() => {
    if (autoLockRef.current) window.clearTimeout(autoLockRef.current);
    autoLockRef.current = window.setTimeout(() => {
      setVaultSecret((current) => {
        if (current) pushLog('Key vault auto-locked after 15 minutes idle.');
        return null;
      });
      setIsSessionOnly(false);
      clearSessionSecret();
    }, 15 * 60 * 1000);
  }, [pushLog]);

  useEffect(() => {
    return () => {
      if (autoLockRef.current) window.clearTimeout(autoLockRef.current);
    };
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const previous = h[h.length - 1];
      setModel(previous);
      pushLog('Reverted one step.');
      return h.slice(0, -1);
    });
  }, [pushLog]);

  const handleUtterance = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      if (/^(undo|revert|go back|undo that)\b/i.test(clean)) {
        undo();
        return;
      }
      setBusy(true);
      try {
        const isRemote = engineConfig.id === 'remote';
        const engine = createEngine({ ...engineConfig, apiKey: vaultSecret?.apiKey });
        const result = await engine.translate(clean, model, selection);
        setHistory((h) => (model ? [...h, model] : h).slice(-40));
        setModel(result.model);
        setSelection(result.selection);
        pushLog(result.message);
        if (isRemote) {
          setUsage(bumpUsage(clean.length, JSON.stringify(result.model).length));
          armAutoLock();
        }
      } catch (error) {
        pushLog(`Engine error: ${(error as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [engineConfig, model, selection, pushLog, undo, vaultSecret, armAutoLock],
  );

  const speech = useSpeech((text, isFinal) => {
    if (isFinal) {
      setTranscript('');
      void handleUtterance(text);
    }
  });

  const handlePropChange = useCallback(
    (key: string, value: string | number | boolean) => {
      if (!model) return;
      const next = cloneModel(model);
      const prop = next.props.find((p) => p.key === key);
      if (!prop) return;
      prop.value = value;
      prop.confidence = Math.max(prop.confidence, 0.9);
      prop.source = prop.source?.startsWith('voice') ? prop.source : 'manual edit';
      next.updatedAt = Date.now();
      next.warnings = lint(next);
      setHistory((h) => [...h, model].slice(-40));
      setModel(next);
      setSelection(key);
      pushLog(`${prop.label} → ${String(value)}${prop.unit ?? ''} (manual edit)`);
    },
    [model, pushLog],
  );

  // Reverse mode: code -> semantic model + visual, on debounce
  useEffect(() => {
    if (mode !== 'reverse') return;
    const timer = setTimeout(() => {
      if (!reverseCode.trim()) {
        setReverse(null);
        return;
      }
      const result = reverseFromCode(reverseCode);
      setReverse(result);
      setModel(result.model);
      setSelection(null);
      pushLog(result.note);
    }, 450);
    return () => clearTimeout(timer);
  }, [reverseCode, mode, pushLog]);

  const generated = useMemo(() => (model ? generate(model, target) : null), [model, target]);

  const previewDoc = useMemo(() => {
    if (mode === 'reverse' && reverse) {
      return reverse.renderKind === 'html' || !model ? reverse.previewDoc : generatePreviewDoc(model);
    }
    return model ? generatePreviewDoc(model) : PLACEHOLDER_DOC;
  }, [mode, reverse, model]);

  const codeView =
    mode === 'reverse' && reverse
      ? { code: reverseCode, language: 'source', filename: 'pasted-code', lineMap: reverse.lineMap }
      : generated;

  const submitTranscript = () => {
    const text = transcript.trim();
    if (!text) return;
    setTranscript('');
    void handleUtterance(text);
  };

  const saveEngineConfig = (patch: Partial<EngineConfig>) => {
    const next = { ...engineConfig, ...patch };
    setEngineConfig(next);
    try {
      localStorage.setItem('ct.engine', JSON.stringify({ id: next.id, endpoint: next.endpoint, model: next.model }));
    } catch {
      /* ignore */
    }
  };

  // Google Login / Logout handlers
  const handleSignIn = async () => {
    setAuthBusy(true);
    try {
      const u = await loginWithGoogle();
      pushLog(`Logged in with Google: ${u.email}`);
    } catch (err) {
      pushLog(`Login failed: ${(err as Error).message}`);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    setAuthBusy(true);
    try {
      await logoutUser();
      pushLog('Signed out from Firebase.');
    } catch (err) {
      pushLog(`Sign out failed: ${(err as Error).message}`);
    } finally {
      setAuthBusy(false);
    }
  };

  // Save current workflow to Firebase
  const handleSaveToFirebase = async () => {
    if (!user) {
      pushLog('Sign in with Google to save workflows to Firebase.');
      return;
    }
    if (!model) {
      pushLog('No translation model to save. Speak or enter an idea first.');
      return;
    }
    try {
      await saveTranslationWorkflow(user.uid, model, target);
      pushLog(`Saved workflow "${model.label}" to your Firebase account!`);
    } catch (err) {
      pushLog(`Cloud save failed: ${(err as Error).message}`);
    }
  };

  // Load a workflow from Firebase
  const handleLoadWorkflow = (record: SavedTranslationRecord) => {
    try {
      const loadedModel = JSON.parse(record.modelData) as IntentModel;
      setModel(loadedModel);
      if (record.target) setTarget(record.target);
      setSelection(null);
      pushLog(`Loaded "${record.label}" from Firebase (${record.target || 'model'}).`);
    } catch (err) {
      pushLog(`Failed to load workflow: ${(err as Error).message}`);
    }
  };

  // Delete a workflow from Firebase
  const handleDeleteWorkflow = async (record: SavedTranslationRecord) => {
    if (!user) return;
    try {
      await deleteTranslationWorkflow(user.uid, record.id);
      pushLog(`Deleted "${record.label}" from Firebase.`);
    } catch (err) {
      pushLog(`Delete error: ${(err as Error).message}`);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">&lt;/&gt;</span>
          <div>
            <h1>Code Translator</h1>
            <p>speech → semantic model → code → visual proof</p>
          </div>
        </div>

        <div className="mode-toggle" role="tablist">
          <button type="button" className={mode === 'speak' ? 'on' : ''} onClick={() => setMode('speak')}>
            Speak → Code
          </button>
          <button type="button" className={mode === 'reverse' ? 'on' : ''} onClick={() => setMode('reverse')}>
            Code → Visual
          </button>
        </div>

        <label className="target-picker">
          <span>Target</span>
          <select value={target} onChange={(e) => setTarget(e.target.value as TargetId)}>
            {TARGETS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <div className="topbar-actions">
          {user ? (
            <div className="auth-box">
              <span className="user-chip">
                <span className="user-avatar">{user.displayName ? user.displayName[0].toUpperCase() : 'U'}</span>
                <span>{user.email || user.displayName}</span>
              </span>
              <button type="button" className="ghost" onClick={handleSaveToFirebase} disabled={!model}>
                Save to Cloud
              </button>
              <button type="button" className="ghost" onClick={handleSignOut} disabled={authBusy}>
                Sign Out
              </button>
            </div>
          ) : (
            <div className="auth-box">
              <button type="button" className="primary" onClick={handleSignIn} disabled={authBusy}>
                {authBusy ? 'Connecting…' : 'Sign in with Google'}
              </button>
            </div>
          )}

          <span className="backend-tag">{firebaseOnline ? 'Firebase: Active' : 'Firebase'}</span>

          <button type="button" className="ghost" onClick={undo} disabled={history.length === 0}>
            Undo
          </button>
          <span className={`status ${busy ? 'status-busy' : ''}`}>{busy ? 'translating…' : 'idle'}</span>
        </div>
      </header>

      <main className="layout">
        <aside className="col-left">
          <section className="panel input-panel">
            <header className="panel-head">
              <h2>0 · Input</h2>
              <span className="chip">{mode === 'speak' ? 'voice / text' : 'source code'}</span>
            </header>

            {mode === 'speak' ? (
              <>
                <div className="speak-row">
                  <MicButton
                    supported={speech.supported}
                    listening={speech.listening}
                    onStart={speech.start}
                    onStop={speech.stop}
                  />
                  <textarea
                    value={transcript}
                    placeholder='Say or type: "a wooden table, 48 inch top, 2 inch legs"'
                    onChange={(e) => setTranscript(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        submitTranscript();
                      }
                    }}
                  />
                  <button type="button" className="primary" onClick={submitTranscript}>
                    Translate
                  </button>
                </div>
                {speech.listening ? <p className="interim">{speech.interim || '…listening'}</p> : null}
                {speech.error ? <p className="error-line">{speech.error}</p> : null}
                <div className="quick-row">
                  {QUICK_PHRASES.map((phrase) => (
                    <button
                      key={phrase}
                      type="button"
                      className="chip-button"
                      onClick={() => {
                        setTranscript(phrase);
                        void handleUtterance(phrase);
                      }}
                    >
                      {phrase}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <textarea
                className="code-input"
                value={reverseCode}
                placeholder={'Paste HTML, JSX, Python or TypeScript here.\nIt gets rendered and the dimensions inside it become editable nodes.'}
                onChange={(e) => setReverseCode(e.target.value)}
                spellCheck={false}
              />
            )}

            <details className="engine-box">
              <summary>Translator engine</summary>
              <div className="engine-grid">
                <label>
                  <span>Engine</span>
                  <select
                    value={engineConfig.id}
                    onChange={(e) => saveEngineConfig({ id: e.target.value as EngineConfig['id'] })}
                  >
                    <option value="local">Local rules (offline)</option>
                    <option value="remote">AI endpoint (Custom / Gemini / OpenAI)</option>
                  </select>
                </label>
                {engineConfig.id === 'remote' ? (
                  <>
                    <label>
                      <span>Endpoint</span>
                      <input
                        type="text"
                        placeholder="https://..."
                        value={engineConfig.endpoint ?? ''}
                        onChange={(e) => saveEngineConfig({ endpoint: e.target.value })}
                      />
                    </label>
                    <label>
                      <span>Model</span>
                      <input
                        type="text"
                        placeholder="model ID"
                        value={engineConfig.model ?? ''}
                        onChange={(e) => saveEngineConfig({ model: e.target.value })}
                      />
                    </label>
                  </>
                ) : null}
              </div>
              <p className="hint">
                Deterministic rules run locally and offline. AI engine uses the session key or encrypted vault below to
                contact Google Gemini, OpenAI, or your custom endpoint. Output always passes through local semantic linting.
              </p>
            </details>
          </section>

          <VaultPanel
            secret={vaultSecret}
            isSessionOnly={isSessionOnly}
            onUnlock={(next, sessionOnly) => {
              setVaultSecret(next);
              setIsSessionOnly(!!sessionOnly);
              saveEngineConfig({ id: 'remote', endpoint: next.endpoint, model: next.model });
              armAutoLock();
              pushLog(sessionOnly ? 'Session API key activated.' : 'Encrypted vault unlocked.');
            }}
            onLock={() => {
              setVaultSecret(null);
              setIsSessionOnly(false);
              clearSessionSecret();
              saveEngineConfig({ id: 'local' });
              pushLog('Session locked — API key removed from memory.');
            }}
            onForget={() => {
              setVaultSecret(null);
              setIsSessionOnly(false);
              purgeAllKeys();
              saveEngineConfig({ id: 'local' });
              pushLog('API key and vaults purged immediately.');
            }}
            onUsageChange={setUsage}
          />

          {user && savedWorkflows.length > 0 ? (
            <section className="panel cloud-panel">
              <header className="panel-head">
                <h2>Cloud Saved Workflows</h2>
                <span className="chip">{savedWorkflows.length} saved</span>
              </header>
              <div className="workflow-list">
                {savedWorkflows.map((item) => (
                  <div key={item.id} className="workflow-item">
                    <div>
                      <div className="workflow-title">{item.label}</div>
                      <div className="workflow-sub">
                        Target: {item.target || 'generic'} · {new Date(item.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="workflow-btns">
                      <button type="button" className="ghost" onClick={() => handleLoadWorkflow(item)}>
                        Load
                      </button>
                      <button type="button" className="ghost danger" onClick={() => handleDeleteWorkflow(item)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <p className="hint usage-line">
            {usage.requests} request{usage.requests === 1 ? '' : 's'} on key · ≈
            {Math.round((usage.promptChars + usage.outputChars) / 4).toLocaleString()} tokens · your key, your workflows.
          </p>

          <IntentPanel model={model} selection={selection} onSelect={setSelection} onChange={handlePropChange} />

          <section className="panel log-panel">
            <header className="panel-head">
              <h2>Translator log</h2>
            </header>
            <ul>
              {log.length === 0 ? <li className="empty">Interpretations, corrections, and cloud logs appear here.</li> : null}
              {log.map((entry) => (
                <li key={entry.id}>{entry.text}</li>
              ))}
            </ul>
          </section>
        </aside>

        <div className="col-right">
          {codeView ? (
            <CodePanel
              code={codeView.code}
              language={codeView.language}
              filename={codeView.filename}
              lineMap={codeView.lineMap}
              selection={selection}
              onSelect={setSelection}
              model={model}
            />
          ) : (
            <section className="panel">
              <header className="panel-head">
                <h2>3 · Generated code</h2>
              </header>
              <p className="empty">Code appears here once there is an intent model.</p>
            </section>
          )}

          <PreviewPanel doc={previewDoc} selection={selection} onSelect={setSelection} />
        </div>
      </main>
    </div>
  );
}
