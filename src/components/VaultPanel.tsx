import { useState, useEffect } from 'react';
import type { UsageStats, VaultSecret } from '../lib/vault.ts';
import {
  clearSessionSecret,
  fetchServerVaultStatus,
  loadSessionSecret,
  maskKey,
  purgeAllKeys,
  saveSessionSecret,
} from '../lib/vault.ts';

export type ModelPresetId = 'gpt-4o-mini' | 'qwen/qwen-2.5-coder-32b-instruct' | 'deepseek/deepseek-chat' | 'custom';

interface VaultPanelProps {
  secret: VaultSecret | null;
  isSessionOnly?: boolean;
  serverMaskedKey?: string | null;
  hasServerBackendKey?: boolean;
  onUnlock: (secret: VaultSecret, sessionOnly?: boolean, sessionId?: string) => void;
  onLock: () => void;
  onForget: () => void;
  onUsageChange?: (usage: UsageStats) => void;
}

export default function VaultPanel({
  secret,
  hasServerBackendKey: propHasServerKey,
  onUnlock,
  onForget,
}: VaultPanelProps) {
  const [apiKey, setApiKey] = useState<string>(() => secret?.apiKey || loadSessionSecret()?.apiKey || '');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedModelPreset, setSelectedModelPreset] = useState<ModelPresetId>(() => {
    const existingModel = secret?.model || loadSessionSecret()?.model;
    if (existingModel === 'qwen/qwen-2.5-coder-32b-instruct') return 'qwen/qwen-2.5-coder-32b-instruct';
    if (existingModel === 'deepseek/deepseek-chat') return 'deepseek/deepseek-chat';
    if (existingModel === 'gpt-4o-mini') return 'gpt-4o-mini';
    if (existingModel) return 'custom';
    return 'gpt-4o-mini';
  });
  const [customModel, setCustomModel] = useState<string>(() => {
    const existingModel = secret?.model || loadSessionSecret()?.model;
    if (existingModel && !['gpt-4o-mini', 'qwen/qwen-2.5-coder-32b-instruct', 'deepseek/deepseek-chat'].includes(existingModel)) {
      return existingModel;
    }
    return '';
  });
  const [endpoint, setEndpoint] = useState<string>(
    () => secret?.endpoint || loadSessionSecret()?.endpoint || 'https://openrouter.ai/api/v1',
  );
  const [serverKeyDetected, setServerKeyDetected] = useState<boolean>(Boolean(propHasServerKey));
  const [notice, setNotice] = useState<string | null>(null);

  // Check backend server environment status on mount
  useEffect(() => {
    let mounted = true;
    fetchServerVaultStatus().then((status) => {
      if (!mounted) return;
      if (status.hasServerDefaultKey) {
        setServerKeyDetected(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Sync state if secret changes externally
  useEffect(() => {
    if (secret?.apiKey && secret.apiKey !== apiKey) {
      setApiKey(secret.apiKey);
    }
    if (secret?.endpoint && secret.endpoint !== endpoint) {
      setEndpoint(secret.endpoint);
    }
    if (secret?.model) {
      if (['gpt-4o-mini', 'qwen/qwen-2.5-coder-32b-instruct', 'deepseek/deepseek-chat'].includes(secret.model)) {
        setSelectedModelPreset(secret.model as ModelPresetId);
      } else {
        setSelectedModelPreset('custom');
        setCustomModel(secret.model);
      }
    }
  }, [secret]);

  const getEffectiveModel = (preset = selectedModelPreset, custom = customModel): string => {
    if (preset === 'custom') {
      return custom.trim() || 'gpt-4o-mini';
    }
    return preset;
  };

  const getEffectiveEndpoint = (ep = endpoint): string => {
    return ep.trim() || 'https://openrouter.ai/api/v1';
  };

  const applyChanges = (nextKey: string, nextPreset: ModelPresetId, nextCustomModel: string, nextEndpoint: string) => {
    const cleanKey = nextKey.trim();
    const effectiveModel = getEffectiveModel(nextPreset, nextCustomModel);
    const cleanEndpoint = getEffectiveEndpoint(nextEndpoint);

    const secretPayload: VaultSecret = {
      apiKey: cleanKey,
      endpoint: cleanEndpoint,
      model: effectiveModel,
    };

    // Stored strictly in frontend session memory
    saveSessionSecret(secretPayload);

    if (cleanKey || serverKeyDetected) {
      onUnlock(secretPayload, true);
    }
  };

  const handleKeyChange = (val: string) => {
    setApiKey(val);
    setNotice(null);
    applyChanges(val, selectedModelPreset, customModel, endpoint);
  };

  const handleModelPresetChange = (preset: ModelPresetId) => {
    setSelectedModelPreset(preset);
    setNotice(null);
    applyChanges(apiKey, preset, customModel, endpoint);
  };

  const handleCustomModelChange = (val: string) => {
    setCustomModel(val);
    setNotice(null);
    applyChanges(apiKey, 'custom', val, endpoint);
  };

  const handleEndpointChange = (val: string) => {
    setEndpoint(val);
    setNotice(null);
    applyChanges(apiKey, selectedModelPreset, customModel, val);
  };

  const handleClearKey = () => {
    setApiKey('');
    setCustomModel('');
    setSelectedModelPreset('gpt-4o-mini');
    setEndpoint('https://openrouter.ai/api/v1');
    clearSessionSecret();
    purgeAllKeys();
    onForget();
    setNotice('API key wiped instantly from session state.');
  };

  const isKeyActive = Boolean(apiKey.trim() || secret?.apiKey);
  const isBackendKeyActive = serverKeyDetected && !isKeyActive;

  return (
    <section className="panel vault">
      <header className="vault-head">
        <span
          className={`vault-state ${isKeyActive ? 'vault-open' : isBackendKeyActive ? 'vault-session' : ''}`}
        >
          {isKeyActive ? 'session key active' : isBackendKeyActive ? 'backend key active' : 'no key'}
        </span>
        <h2 className="vault-title">AI Translator Key &amp; Model</h2>

        <div className="panel-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {serverKeyDetected && (
            <span className="backend-key-badge" title="Active on server via process.env.API_KEY or GEMINI_API_KEY">
              Using Backend Configured Key
            </span>
          )}
          <button
            type="button"
            className="clear-key-btn"
            onClick={handleClearKey}
            title="Wipe API key instantly from frontend session"
          >
            Clear Key
          </button>
        </div>
      </header>

      <div className="vault-body">
        {/* Universal Single Key Field + Model Selector */}
        <div className="vault-key-model-grid">
          <label className="vault-input-label">
            <span>Universal API Key (Frontend Session Only)</span>
            <div className="vault-key-input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder={
                  serverKeyDetected
                    ? 'Optional: Override Backend Key (sk-..., sk-or-..., AIza...)'
                    : 'Paste API Key (sk-..., sk-or-..., AIza...)'
                }
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

          <label className="vault-input-label">
            <span>Model Selector</span>
            <select
              value={selectedModelPreset}
              onChange={(e) => handleModelPresetChange(e.target.value as ModelPresetId)}
            >
              <option value="gpt-4o-mini">gpt-4o-mini (Fast, low-cost)</option>
              <option value="qwen/qwen-2.5-coder-32b-instruct">qwen/qwen-2.5-coder-32b-instruct (Fast, coding)</option>
              <option value="deepseek/deepseek-chat">deepseek/deepseek-chat</option>
              <option value="custom">custom (Type any model ID)</option>
            </select>
          </label>
        </div>

        {/* Custom Model ID field when 'custom' is picked */}
        {selectedModelPreset === 'custom' && (
          <label className="vault-input-label">
            <span>Custom Model Identifier</span>
            <input
              type="text"
              placeholder="e.g. meta-llama/llama-3.3-70b-instruct"
              spellCheck={false}
              value={customModel}
              onChange={(e) => handleCustomModelChange(e.target.value)}
            />
          </label>
        )}

        {/* Optional Collapsible Endpoint URL */}
        <details className="vault-endpoint-details">
          <summary>
            Endpoint Base URL: <code>{endpoint || 'https://openrouter.ai/api/v1'}</code>
          </summary>
          <div className="vault-endpoint-content">
            <label className="vault-input-label">
              <span>Base URL (defaults to https://openrouter.ai/api/v1)</span>
              <input
                type="text"
                placeholder="https://openrouter.ai/api/v1"
                spellCheck={false}
                value={endpoint}
                onChange={(e) => handleEndpointChange(e.target.value)}
              />
            </label>
          </div>
        </details>

        {/* Active Key and Model indicator */}
        {isKeyActive && (
          <div className="vault-row">
            <span className="vault-label">Active Key</span>
            <code className="vault-key">{maskKey(apiKey || secret?.apiKey || '')}</code>
            <span className="vault-label" style={{ marginLeft: 'auto', minWidth: 'auto' }}>
              Model: <b>{getEffectiveModel()}</b>
            </span>
          </div>
        )}

        {notice && <p className="vault-notice">{notice}</p>}
      </div>
    </section>
  );
}
