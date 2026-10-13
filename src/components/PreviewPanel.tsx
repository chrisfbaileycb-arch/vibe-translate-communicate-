import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowGraph, WorkflowNode, WorkflowNodeType } from '../lib/types.ts';
import { ensureWorkflow } from '../lib/workflow.ts';
import WorkflowCanvas, { SafetyInspector } from './WorkflowCanvas.tsx';

interface PreviewPanelProps {
  doc: string;
  selection: string | null;
  onSelect: (key: string | null) => void;
  /** When set, the panel renders the specific workflow graph in the canvas view. */
  workflow?: WorkflowGraph | null;
  /** Show the shell Safety & Flag Inspector under the canvas. */
  showSafety?: boolean;
  /** Live callback when a workflow stage label/command is edited inside the DAG */
  onUpdateWorkflowNode?: (nodeId: string, patch: Partial<WorkflowNode>) => void;
  /** Live callback to append a new workflow stage */
  onAddWorkflowNode?: (type: WorkflowNodeType) => void;
  /** Hint when target or model switches to workflow/pipeline */
  autoSwitchToWorkflow?: boolean;
}

type DevicePreset = 'desktop' | 'mobile';

const DESKTOP_WIDTH = 1280;
const DESKTOP_HEIGHT = 800;
const MOBILE_WIDTH = 375;
const MOBILE_HEIGHT = 667;

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

export default function PreviewPanel({
  doc,
  selection,
  onSelect,
  workflow,
  showSafety,
  onUpdateWorkflowNode,
  onAddWorkflowNode,
  autoSwitchToWorkflow,
}: PreviewPanelProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fullscreenFrameRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<'preview' | 'workflow'>('preview');
  const [device, setDevice] = useState<DevicePreset>('desktop');
  const [containerWidth, setContainerWidth] = useState<number>(540);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  useEffect(() => {
    if (autoSwitchToWorkflow) {
      setView('workflow');
    }
  }, [autoSwitchToWorkflow]);

  // Fallback workflow graph if none provided yet
  const effectiveWorkflow = useMemo(() => {
    if (workflow) return workflow;
    return ensureWorkflow({
      id: 'init',
      kind: 'system/pipeline',
      label: 'LinguaCode Translation Pipeline',
      props: [],
      warnings: [],
      updatedAt: Date.now(),
    });
  }, [workflow]);

  const srcDoc = useMemo(() => {
    const injected = doc.includes('</body>') ? doc.replace('</body>', `${BINDING_SCRIPT}\n</body>`) : `${doc}\n${BINDING_SCRIPT}`;
    return injected;
  }, [doc]);

  // Create Blob URL for optional new tab opening
  const blobUrl = useMemo(() => {
    try {
      const blob = new Blob([srcDoc], { type: 'text/html;charset=utf-8' });
      return URL.createObjectURL(blob);
    } catch {
      return '';
    }
  }, [srcDoc]);

  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  // Measure container width accurately with ResizeObserver
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) {
        setContainerWidth(rect.width);
      }
    };

    measure();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) {
          setContainerWidth(w);
        }
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [view, device]);

  // Listen for selection messages from iframe
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string; nodeId?: string | null } | null;
      if (data?.source !== 'ct-preview') return;
      if (data.type === 'select') onSelect(data.nodeId ?? null);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSelect]);

  // Sync selection highlight to frame(s)
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ source: 'ct-app', type: 'highlight', nodeId: selection }, '*');
    fullscreenFrameRef.current?.contentWindow?.postMessage({ source: 'ct-app', type: 'highlight', nodeId: selection }, '*');
  }, [selection, srcDoc, revision, view, device, fullscreenOpen]);

  // Close fullscreen modal on Escape key
  useEffect(() => {
    if (!fullscreenOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFullscreenOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreenOpen]);

  // Dynamic Scale-to-Fit Calculations
  const desktopScale = useMemo(() => {
    const safeWidth = containerWidth > 0 ? containerWidth : 540;
    return Math.min(1, safeWidth / DESKTOP_WIDTH);
  }, [containerWidth]);

  const desktopWrapperHeight = useMemo(() => {
    return Math.round(DESKTOP_HEIGHT * desktopScale);
  }, [desktopScale]);

  const mobileScale = useMemo(() => {
    const safeWidth = containerWidth > 0 ? containerWidth : 540;
    // Outer phone frame is 375 + 16 border = 391px
    const frameWidth = MOBILE_WIDTH + 16;
    return safeWidth < frameWidth ? (safeWidth - 16) / frameWidth : 1;
  }, [containerWidth]);

  return (
    <section className="panel preview-panel">
      <header className="panel-head">
        <h2>4 · {view === 'workflow' ? 'Workflow Mind Map / DAG' : 'Visual verifier'}</h2>

        {/* Segmented view toggle button */}
        <div className="view-toggle" role="tablist" aria-label="Preview mode">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'preview'}
            className={view === 'preview' ? 'on' : ''}
            onClick={() => setView('preview')}
          >
            Component Preview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'workflow'}
            className={view === 'workflow' ? 'on' : ''}
            onClick={() => setView('workflow')}
          >
            Workflow Mind Map / DAG
          </button>
        </div>

        {/* Quick Device Presets in Pane 4 Header (when in Component Preview) */}
        {view === 'preview' ? (
          <div className="device-toggle" role="group" aria-label="Device viewport mode">
            <button
              type="button"
              className={`device-btn ${device === 'desktop' ? 'on' : ''}`}
              onClick={() => setDevice('desktop')}
              title="Desktop View: Renders at 1280px resolution and scales down to fit Pane 4"
            >
              🖥️ Desktop (1280px)
            </button>
            <button
              type="button"
              className={`device-btn ${device === 'mobile' ? 'on' : ''}`}
              onClick={() => setDevice('mobile')}
              title="Mobile View: Renders at 375px mobile resolution at 100% scale"
            >
              📱 Mobile (375px)
            </button>
            <button
              type="button"
              className="device-btn fullscreen-btn"
              onClick={() => setFullscreenOpen(true)}
              title="Fullscreen / Pop-out: Full-scale interactive preview modal"
            >
              ⛶ Fullscreen
            </button>
          </div>
        ) : null}

        {view === 'preview' ? (
          <div className="panel-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => setRevision((r) => r + 1)}
              title="Refresh component render"
            >
              Re-render
            </button>
          </div>
        ) : null}
      </header>

      {view === 'workflow' ? (
        <>
          <WorkflowCanvas
            graph={effectiveWorkflow}
            selection={selection}
            onSelect={onSelect}
            onUpdateNode={onUpdateWorkflowNode}
            onAddNode={onAddWorkflowNode}
            onSwitchToPreview={() => setView('preview')}
          />
          {showSafety ? <SafetyInspector graph={effectiveWorkflow} selection={selection} onSelect={onSelect} /> : null}
          <p className="preview-foot">
            Click a node in the DAG to light up its code lines &amp; edit its stage — or click <b>▶ Run / Verify Workflow</b> to trace the pipeline.
          </p>
        </>
      ) : (
        <>
          {/* Viewport Wrapper measuring container width */}
          <div ref={wrapperRef} className="preview-viewport-wrapper">
            {device === 'desktop' ? (
              <div
                className="preview-scale-stage"
                style={{
                  width: '100%',
                  height: `${desktopWrapperHeight}px`,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div
                  className="preview-iframe-scale-box"
                  style={{
                    width: `${DESKTOP_WIDTH}px`,
                    height: `${DESKTOP_HEIGHT}px`,
                    transform: `scale(${desktopScale})`,
                    transformOrigin: 'top left',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                  }}
                >
                  <iframe
                    key={`desktop-${revision}`}
                    ref={frameRef}
                    className="preview-desktop-iframe"
                    title="Desktop Preview (1280px scaled)"
                    sandbox="allow-scripts"
                    srcDoc={srcDoc}
                  />
                </div>
              </div>
            ) : (
              <div className="preview-mobile-wrapper">
                <div
                  className="mobile-phone-frame"
                  style={{
                    width: `${MOBILE_WIDTH}px`,
                    height: `${MOBILE_HEIGHT}px`,
                    transform: mobileScale < 1 ? `scale(${mobileScale})` : undefined,
                    transformOrigin: 'top center',
                  }}
                >
                  <div className="mobile-notch" />
                  <iframe
                    key={`mobile-${revision}`}
                    ref={frameRef}
                    className="mobile-iframe"
                    title="Mobile Preview (375px)"
                    sandbox="allow-scripts"
                    srcDoc={srcDoc}
                  />
                </div>
              </div>
            )}
          </div>

          <p className="preview-foot">
            {device === 'desktop' ? (
              <>
                🖥️ <b>Desktop Viewport:</b> Internal 1280px resolution scaled to fit ({Math.round(desktopScale * 100)}% scale). Full desktop margins &amp; columns preserved. Click any part to select its code.
              </>
            ) : (
              <>
                📱 <b>Mobile Viewport:</b> Rendered at 375px × 667px device frame. Click any part to select its code.
              </>
            )}
          </p>
        </>
      )}

      {/* Fullscreen Interactive Modal */}
      {fullscreenOpen && (
        <div className="preview-fullscreen-modal" role="dialog" aria-modal="true" aria-label="Fullscreen Preview">
          <div className="preview-fullscreen-bar">
            <div className="preview-fullscreen-title">
              <span className="brand-mark-small">&lt;LC&gt;</span>
              <span>Full-Scale Interactive Preview (100% Unscaled Viewport)</span>
            </div>

            <div className="preview-fullscreen-actions">
              {blobUrl ? (
                <a
                  href={blobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ghost"
                  title="Open live HTML in a separate browser tab"
                  style={{ textDecoration: 'none' }}
                >
                  ↗ Open in New Tab
                </a>
              ) : null}
              <button
                type="button"
                className="ghost"
                onClick={() => setRevision((r) => r + 1)}
                title="Reload preview"
              >
                Re-render
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => setFullscreenOpen(false)}
                title="Close fullscreen view (Esc)"
              >
                ✕ Close Fullscreen
              </button>
            </div>
          </div>

          <div className="preview-fullscreen-body">
            <iframe
              key={`fullscreen-${revision}`}
              ref={fullscreenFrameRef}
              className="preview-fullscreen-iframe"
              title="Full-scale interactive render"
              sandbox="allow-scripts"
              srcDoc={srcDoc}
            />
          </div>
        </div>
      )}
    </section>
  );
}
