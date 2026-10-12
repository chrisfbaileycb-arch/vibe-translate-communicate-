import { useMemo } from 'react';
import type { WorkflowGraph, WorkflowNodeType } from '../lib/types.ts';
import { classifyCommand, worstLevel, type SafetyLevel } from '../lib/safety.ts';
import { layoutGraph, NODE_TYPE_LABEL, topoOrder } from '../lib/workflow.ts';

interface CanvasProps {
  graph: WorkflowGraph;
  selection: string | null;
  onSelect: (key: string | null) => void;
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
export default function WorkflowCanvas({ graph, selection, onSelect }: CanvasProps) {
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const byId = useMemo(() => new Map(layout.nodes.map((p) => [p.node.id, p])), [layout]);
  const { nodeWidth: w, nodeHeight: h } = layout;

  return (
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
          const hot = selection === edge.from || selection === edge.to;
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
          const selected = selection === node.id;
          const safety = node.command ? classifyCommand(node.command).level : null;
          const sub = node.command ?? node.detail ?? '';
          return (
            <g
              key={node.id}
              transform={`translate(${x},${y})`}
              className={`wf-node wf-${node.type} ${selected ? 'wf-selected' : ''}`}
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
