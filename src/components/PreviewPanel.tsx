import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowGraph } from '../lib/types.ts';
import WorkflowCanvas, { SafetyInspector } from './WorkflowCanvas.tsx';

interface PreviewPanelProps {
  doc: string;
  selection: string | null;
  onSelect: (key: string | null) => void;
  /** When set, the panel offers the Workflow Canvas next to the scratch render. */
  workflow?: WorkflowGraph | null;
  /** Show the shell Safety & Flag Inspector under the canvas. */
  showSafety?: boolean;
}

/**
 * Layer 3: the visual verifier.
 * The scratch render lives in a sandboxed iframe and talks to the app through
 * postMessage: click a part -> select its node; select a node -> outline the part.
 */
const BINDING_SCRIPT = `
<script>
(function () {
  function send(nodeId) {
    parent.postMessage({ source: 'ct-preview', type: 'select', nodeId: nodeId }, '*');
  }
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-node-id]') : null;
    if (el) { e.preventDefault(); send(el.getAttribute('data-node-id')); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target && e.target.closest ? e.target.closest('[data-node-id]') : null;
    if (el) { e.preventDefault(); send(el.getAttribute('data-node-id')); }
  });
  window.addEventListener('message', function (e) {
    var data = e.data || {};
    if (data.source !== 'ct-app') return;
    var picked = document.querySelectorAll('.picked');
    for (var i = 0; i < picked.length; i++) picked[i].classList.remove('picked');
    if (data.type === 'highlight' && data.nodeId) {
      var nodes = document.querySelectorAll('[data-node-id="' + data.nodeId + '"]');
      for (var j = 0; j < nodes.length; j++) nodes[j].classList.add('picked');
    }
  });
  parent.postMessage({ source: 'ct-preview', type: 'ready' }, '*');
})();
<\/script>
`;

export default function PreviewPanel({ doc, selection, onSelect, workflow, showSafety }: PreviewPanelProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<'canvas' | 'render'>('canvas');
  const showCanvas = Boolean(workflow) && view === 'canvas';

  const srcDoc = useMemo(() => {
    const injected = doc.includes('</body>') ? doc.replace('</body>', `${BINDING_SCRIPT}\n</body>`) : `${doc}\n${BINDING_SCRIPT}`;
    return injected;
  }, [doc]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string; nodeId?: string | null } | null;
      if (data?.source !== 'ct-preview') return;
      if (data.type === 'select') onSelect(data.nodeId ?? null);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSelect]);

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ source: 'ct-app', type: 'highlight', nodeId: selection }, '*');
  }, [selection, srcDoc, revision, showCanvas]);

  return (
    <section className="panel preview-panel">
      <header className="panel-head">
        <h2>4 · {showCanvas ? 'Workflow canvas' : 'Visual verifier'}</h2>
        {workflow ? (
          <div className="view-toggle" role="tablist" aria-label="Preview mode">
            <button type="button" role="tab" aria-selected={view === 'canvas'} className={view === 'canvas' ? 'on' : ''} onClick={() => setView('canvas')}>
              Canvas
            </button>
            <button type="button" role="tab" aria-selected={view === 'render'} className={view === 'render' ? 'on' : ''} onClick={() => setView('render')}>
              Render
            </button>
          </div>
        ) : (
          <span className="chip url-chip">http://localhost:3000/preview</span>
        )}
        {!showCanvas ? (
          <div className="panel-actions">
            <button type="button" className="ghost" onClick={() => setRevision((r) => r + 1)}>
              Re-render
            </button>
          </div>
        ) : null}
      </header>
      {showCanvas && workflow ? (
        <>
          <WorkflowCanvas graph={workflow} selection={selection} onSelect={onSelect} />
          {showSafety ? <SafetyInspector graph={workflow} selection={selection} onSelect={onSelect} /> : null}
          <p className="preview-foot">Click a node to light up its code lines and semantic property — or click a code line to find its node.</p>
        </>
      ) : (
        <>
          <iframe
            key={revision}
            ref={frameRef}
            className="preview-frame"
            title="Scratch render"
            sandbox="allow-scripts"
            srcDoc={srcDoc}
          />
          <p className="preview-foot">Click any part of the render to select its source node — the matching code lines light up.</p>
        </>
      )}
    </section>
  );
}
