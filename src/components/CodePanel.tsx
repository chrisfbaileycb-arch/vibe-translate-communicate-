import { useMemo } from 'react';
import type { CodeRange } from '../lib/types.ts';

interface CodePanelProps {
  code: string;
  language: string;
  filename: string;
  lineMap: Record<string, CodeRange[]>;
  selection: string | null;
  onSelect: (key: string | null) => void;
}

export default function CodePanel({ code, language, filename, lineMap, selection, onSelect }: CodePanelProps) {
  const lines = useMemo(() => code.split('\n'), [code]);

  const nodeByLine = useMemo(() => {
    const map = new Map<number, string>();
    for (const [node, ranges] of Object.entries(lineMap)) {
      for (const range of ranges) {
        for (let n = range.start; n <= range.end; n += 1) if (!map.has(n)) map.set(n, node);
      }
    }
    return map;
  }, [lineMap]);

  const highlighted = useMemo(() => {
    const set = new Set<number>();
    if (!selection) return set;
    for (const range of lineMap[selection] ?? []) {
      for (let n = range.start; n <= range.end; n += 1) set.add(n);
    }
    return set;
  }, [lineMap, selection]);

  const copy = () => navigator.clipboard?.writeText(code);
  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel code-panel">
      <header className="panel-head">
        <h2>3 · Generated code</h2>
        <span className="chip">
          {filename} · {language}
        </span>
        <div className="panel-actions">
          <button type="button" className="ghost" onClick={copy}>
            Copy
          </button>
          <button type="button" className="ghost" onClick={download}>
            Download
          </button>
        </div>
      </header>

      <div className="code-scroll">
        {lines.map((line, i) => {
          const n = i + 1;
          const node = nodeByLine.get(n);
          const isHot = highlighted.has(n);
          return (
            <div
              key={n}
              className={`code-line ${isHot ? 'code-hot' : ''} ${node ? 'code-mapped' : ''}`}
              onClick={() => onSelect(node ?? null)}
              title={node ? `node: ${node}` : undefined}
            >
              <span className="code-num">{n}</span>
              <span className="code-text">{line || ' '}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
