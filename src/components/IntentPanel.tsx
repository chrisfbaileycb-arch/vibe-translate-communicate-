import { useState } from 'react';
import type { IntentModel, IntentProp } from '../lib/types.ts';
import { exportModelAsJson } from '../lib/generate.ts';

interface IntentPanelProps {
  model: IntentModel | null;
  selection: string | null;
  onSelect: (key: string | null) => void;
  onChange: (key: string, value: string | number | boolean) => void;
}

function confidenceClass(value: number): string {
  if (value >= 0.85) return 'conf-high';
  if (value >= 0.6) return 'conf-mid';
  return 'conf-low';
}

function PropEditor({
  prop,
  selected,
  onSelect,
  onChange,
}: {
  prop: IntentProp;
  selected: boolean;
  onSelect: (key: string) => void;
  onChange: (key: string, value: string | number | boolean) => void;
}) {
  return (
    <div
      className={`prop ${selected ? 'prop-selected' : ''}`}
      onClick={() => onSelect(prop.key)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect(prop.key);
      }}
      role="button"
      tabIndex={0}
    >
      <div className="prop-head">
        <span className={`conf ${confidenceClass(prop.confidence)}`} title={`confidence ${Math.round(prop.confidence * 100)}%`} />
        <span className="prop-label">{prop.label}</span>
        <span className="prop-key">{prop.key}</span>
      </div>
      <div className="prop-edit">
        {prop.options ? (
          <select
            value={String(prop.value)}
            onChange={(e) => onChange(prop.key, e.target.value)}
            onClick={(e) => e.stopPropagation()}
          >
            {[...new Set([String(prop.value), ...prop.options])].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : typeof prop.value === 'number' ? (
          <input
            type="number"
            value={Number.isFinite(prop.value) ? prop.value : 0}
            step={prop.step ?? 1}
            min={prop.min}
            max={prop.max}
            onChange={(e) => onChange(prop.key, e.target.value === '' ? 0 : Number(e.target.value))}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <input
            type="text"
            value={String(prop.value)}
            onChange={(e) => onChange(prop.key, e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {prop.unit ? <span className="prop-unit">{prop.unit}</span> : null}
        {prop.source ? <span className="prop-source" title={`heard: ${prop.source}`}>“{prop.source}”</span> : null}
      </div>
    </div>
  );
}

export default function IntentPanel({ model, selection, onSelect, onChange }: IntentPanelProps) {
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);

  if (!model) {
    return (
      <section className="panel intent-panel">
        <header className="panel-head">
          <h2>1 · Semantic layer</h2>
        </header>
        <p className="empty">
          Nothing interpreted yet. Say something like <em>“a wooden table, 48 inch top, 2 inch legs”</em> — or paste code
          in reverse mode.
        </p>
      </section>
    );
  }

  const handleDownload = () => {
    const { filename } = exportModelAsJson(model);
    setDownloadNotice(`Downloaded ${filename}`);
    setTimeout(() => setDownloadNotice(null), 3000);
  };

  return (
    <section className="panel intent-panel">
      <header className="panel-head">
        <h2>1 · Semantic layer</h2>
        <span className="chip">{model.kind}</span>
        <div className="panel-actions">
          <button
            type="button"
            className="ghost"
            onClick={handleDownload}
            title="Download this semantic model as a JSON file"
          >
            Download JSON
          </button>
        </div>
      </header>

      {downloadNotice ? <div className="vault-notice">{downloadNotice}</div> : null}

      <div className="intent-meta">
        <strong>{model.label}</strong>
        <span>{model.props.length} properties</span>
      </div>

      <div className="prop-list">
        {model.props.map((prop) => (
          <PropEditor
            key={prop.key}
            prop={prop}
            selected={selection === prop.key || selection === prop.nodeId}
            onSelect={onSelect}
            onChange={onChange}
          />
        ))}
      </div>

      {model.workflow &&
      model.workflow.nodes.length > 0 &&
      !model.workflow.nodes.every((n) => model.props.some((p) => p.nodeId === n.id)) ? (
        <div className="warn-list">
          <h3>Connected workflow DAG stages</h3>
          <div className="intent-wf-list">
            {model.workflow.nodes.map((node) => {
              const active = selection === node.id;
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`intent-wf-chip ${active ? 'active' : ''}`}
                  onClick={() => onSelect(active ? null : node.id)}
                  title={`Select workflow stage ${node.id} to highlight its bound code lines`}
                >
                  <span className="intent-wf-type">{node.type}</span>
                  <strong className="intent-wf-label">{node.label}</strong>
                  <code className="intent-wf-id">{node.id}</code>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {model.warnings.length > 0 ? (
        <div className="warn-list">
          <h3>Domain constraints</h3>
          {model.warnings.map((warning, idx) => (
            <button
              key={`${warning.id}_${idx}`}
              type="button"
              className={`warn warn-${warning.severity} ${warning.propKey && warning.propKey === selection ? 'warn-active' : ''}`}
              onClick={() => warning.propKey && onSelect(warning.propKey)}
            >
              <span className="warn-tag">{warning.severity}</span>
              <span>
                {warning.message}
                {warning.suggestion ? <em className="warn-fix"> → {warning.suggestion}</em> : null}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="warn-list">
          <h3>Domain constraints</h3>
          <p className="ok">All checks pass — nothing implausible detected.</p>
        </div>
      )}
    </section>
  );
}
