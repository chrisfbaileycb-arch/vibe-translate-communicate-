import { useEffect, useMemo, useState } from 'react';
import type { WorkflowGraph, WorkflowNode, WorkflowNodeType } from '../lib/types.ts';
import { classifyCommand, worstLevel, type SafetyLevel } from '../lib/safety.ts';
import { layoutGraph, NODE_TYPE_LABEL, topoOrder } from '../lib/workflow.ts';

interface CanvasProps {
  graph: WorkflowGraph;
  selection: string | null;
  onSelect: (key: string | null) => void;
  onUpdateNode?: (nodeId: string, patch: Partial<WorkflowNode>) => void;
  onAddNode?: (type: WorkflowNodeType) => void;
  onSwitchToPreview?: () => void;
}

const TYPE_GLYPH: Record<WorkflowNodeType, string> = {
  trigger: '◉',
  validator: '◆',
  transform: '✦',
  action: '▶',
};

const SAFETY_LABEL: Record<SafetyLevel, string> = {
  safe: 'read-only',
  caution: 'writes / network',
  destructive: 'destructive',
};

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Workflow Mind Map / DAG canvas. Plain SVG (no graph library) with a layered
 * layout. Node ids are the same ids used by the semantic layer and the code
 * line map, so selecting here highlights everywhere else and vice versa.
 */
export default function WorkflowCanvas({
  graph,
  selection,
  onSelect,
  onUpdateNode,
  onAddNode,
  onSwitchToPreview,
}: CanvasProps) {
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const { order } = useMemo(() => topoOrder(graph), [graph]);
  const byId = useMemo(() => new Map(layout.nodes.map((p) => [p.node.id, p])), [layout]);
  const { nodeWidth: w, nodeHeight: h } = layout;

  const [runningIdx, setRunningIdx] = useState<number | null>(null);
  const [completedIds, setCompletedIds] = useState<string[]>([]);

  // If selection is a semantic prop (e.g. "title", "price") rather than a workflow node ID,
  // map it to the transform/parse node so the DAG still shows which stage owns it.
  const activeNodeId = useMemo(() => {
    if (!selection) return order[0]?.id ?? null;
    if (order.some((n) => n.id === selection)) return selection;
    const transformNode = order.find((n) => n.type === 'transform') ?? order[1] ?? order[0];
    return transformNode?.id ?? null;
  }, [selection, order]);

  const activeNode = useMemo(
    () => order.find((n) => n.id === activeNodeId) ?? order[0] ?? null,
    [order, activeNodeId],
  );

  // Step-by-step workflow simulator
  useEffect(() => {
    if (runningIdx === null) return;
    if (runningIdx >= order.length) {
      const doneTimer = window.setTimeout(() => {
        setRunningIdx(null);
      }, 900);
      return () => window.clearTimeout(doneTimer);
    }
    const current = order[runningIdx];
    if (current) {
      onSelect(current.id);
      setCompletedIds((prev) => (prev.includes(current.id) ? prev : [...prev, current.id]));
    }
    const timer = window.setTimeout(() => {
      setRunningIdx((idx) => (idx !== null ? idx + 1 : null));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [runningIdx, order, onSelect]);

  const handleRunSimulation = () => {
    if (order.length === 0) return;
    setCompletedIds([]);
    setRunningIdx(0);
  };

  return (
    <div className="wf-canvas-container">
      <div className="wf-toolbar">
        <div className="wf-toolbar-left">
          <span className="wf-stage-count">{order.length} DAG stages connected</span>
          {selection && !order.some((n) => n.id === selection) ? (
            <span className="wf-prop-link-badge">
              Linked prop: <code>{selection}</code>
            </span>
          ) : null}
        </div>
        <div className="wf-toolbar-actions">
          <button
            type="button"
            className="wf-action-btn wf-run-btn"
            onClick={handleRunSimulation}
            disabled={runningIdx !== null}
            title="Step through each workflow node and highlight its bound source lines"
          >
            {runningIdx !== null ? '⚡ Running DAG…' : '▶ Run / Verify Workflow'}
          </button>
          {onAddNode ? (
            <button
              type="button"
              className="wf-action-btn"
              onClick={() => onAddNode('action')}
              title="Add a new step to this workflow pipeline"
            >
              + Add Step
            </button>
          ) : null}
          {onSwitchToPreview ? (
            <button
              type="button"
              className="wf-action-btn"
              onClick={onSwitchToPreview}
              title="Switch to visual component preview"
            >
              🖼️ Picture Preview
            </button>
          ) : null}
        </div>
      </div>

      <div className="wf-canvas" onClick={() => onSelect(null)}>
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="group"
          aria-label="Workflow graph"
        >
          <defs>
            <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="wf-arrow" />
            </marker>
          </defs>

          {graph.edges.map((edge) => {
            const a = byId.get(edge.from);
            const b = byId.get(edge.to);
            if (!a || !b) return null;
            const x1 = a.x + w / 2;
            const y1 = a.y + h;
            const x2 = b.x + w / 2;
            const y2 = b.y;
            const midY = (y1 + y2) / 2;
            const hot = activeNodeId === edge.from || activeNodeId === edge.to;
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                d={`M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2 - 2}`}
                className={`wf-edge ${hot ? 'wf-edge-hot' : ''}`}
                markerEnd="url(#wf-arrow)"
              />
            );
          })}

          {layout.nodes.map(({ node, x, y }) => {
            const selected = selection === node.id || activeNodeId === node.id;
            const isRunning = runningIdx !== null && order[runningIdx]?.id === node.id;
            const isCompleted = completedIds.includes(node.id);
            const safety = node.command ? classifyCommand(node.command).level : null;
            const sub = node.command ?? node.detail ?? '';
            return (
              <g
                key={node.id}
                transform={`translate(${x},${y})`}
                className={`wf-node wf-${node.type} ${selected ? 'wf-selected' : ''} ${isRunning ? 'wf-running' : ''} ${
                  isCompleted ? 'wf-completed' : ''
                }`}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`${NODE_TYPE_LABEL[node.type]}: ${node.label}${sub ? ` — ${sub}` : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(node.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(node.id);
                  }
                }}
              >
                <title>{`${node.id} · ${node.label}${sub ? `\n${sub}` : ''}`}</title>
                <rect className="wf-box" width={w} height={h} rx={10} />
                <rect className="wf-stripe" width={5} height={h} rx={2} />
                <text className="wf-type" x={16} y={17}>
                  {TYPE_GLYPH[node.type]} {NODE_TYPE_LABEL[node.type].toUpperCase()}
                  {node.destination ? ` → ${node.destination}` : ''}
                </text>
                <text className="wf-label" x={16} y={35}>
                  {clip(node.label, 30)}
                </text>
                {sub ? (
                  <text className="wf-sub" x={16} y={50}>
                    {clip(sub, 36)}
                  </text>
                ) : null}
                {safety ? <circle className={`wf-dot wf-dot-${safety}`} cx={w - 13} cy={13} r={5} /> : null}
              </g>
            );
          })}
        </svg>
      </div>

      {activeNode ? (
        <div className="wf-node-inspector">
          <div className="wf-inspector-head">
            <span className={`wf-inspector-badge wf-badge-${activeNode.type}`}>
              {TYPE_GLYPH[activeNode.type]} {NODE_TYPE_LABEL[activeNode.type]}
            </span>
            <code className="wf-inspector-id">{activeNode.id}</code>
          </div>
          <div className="wf-inspector-fields">
            <label className="wf-field">
              <span>Stage Label</span>
              <input
                type="text"
                value={activeNode.label}
                disabled={!onUpdateNode}
                onChange={(e) => onUpdateNode?.(activeNode.id, { label: e.target.value })}
                placeholder="Stage description"
              />
            </label>
            <label className="wf-field">
              <span>{activeNode.type === 'trigger' ? 'Trigger / Detail' : 'Command / Action'}</span>
              <input
                type="text"
                value={activeNode.command ?? activeNode.detail ?? ''}
                disabled={!onUpdateNode}
                onChange={(e) => {
                  const val = e.target.value;
                  if (activeNode.type === 'trigger' && !activeNode.command) {
                    onUpdateNode?.(activeNode.id, { detail: val });
                  } else {
                    onUpdateNode?.(activeNode.id, { command: val, detail: val });
                  }
                }}
                placeholder={activeNode.type === 'trigger' ? 'e.g. webhook: push main' : 'e.g. npm test'}
              />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Safety & Flag Inspector: every shell command, classified green / yellow / red. */
export function SafetyInspector({ graph, selection, onSelect }: CanvasProps) {
  const rows = useMemo(
    () =>
      topoOrder(graph)
        .order.filter((n) => n.command)
        .map((node) => ({ node, safety: classifyCommand(node.command!) })),
    [graph],
  );
  if (rows.length === 0) return null;
  const overall = worstLevel(rows.map((r) => r.safety.level));

  return (
    <div className="safety">
      <div className="safety-head">
        <h3>Safety &amp; flag inspector</h3>
        <span className={`safety-pill safety-${overall}`}>{SAFETY_LABEL[overall]}</span>
      </div>
      <ul>
        {rows.map(({ node, safety }) => (
          <li key={node.id}>
            <button
              type="button"
              className={`safety-row safety-row-${safety.level} ${selection === node.id ? 'safety-row-on' : ''}`}
              onClick={() => onSelect(node.id)}
            >
              <span className={`safety-pill safety-${safety.level}`}>{SAFETY_LABEL[safety.level]}</span>
              <code>{safety.command}</code>
              <span className="safety-meta">
                {safety.flags.map((flag) => (
                  <span key={flag} className="safety-flag">
                    {flag}
                  </span>
                ))}
                <span className="safety-why">{safety.reasons.join(' · ')}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
