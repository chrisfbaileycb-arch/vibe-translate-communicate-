import { useEffect, useMemo, useRef, useState } from 'react';
import type { CodeRange, IntentModel } from '../lib/types.ts';
import { generate } from '../lib/generate.ts';

interface CodePanelProps {
  code: string;
  language: string;
  filename: string;
  lineMap: Record<string, CodeRange[]>;
  selection: string | null;
  onSelect: (key: string | null) => void;
  model?: IntentModel | null;
}

export default function CodePanel({
  code,
  language,
  filename,
  lineMap,
  selection,
  onSelect,
  model,
}: CodePanelProps) {
  const [copied, setCopied] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);

  const lines = useMemo(() => code.split('\n'), [code]);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // Selecting a node elsewhere (canvas, render, semantic layer) brings its first line into view.
  useEffect(() => {
    const box = scrollRef.current;
    const hot = box?.querySelector<HTMLElement>('.code-hot');
    if (!box || !hot) return;
    const top = hot.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (top < 0 || top > box.clientHeight - hot.offsetHeight) {
      box.scrollTo({ top: box.scrollTop + top - box.clientHeight / 3, behavior: 'smooth' });
    }
  }, [highlighted]);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore clipboard permission errors */
    }
  };

  const saveFileToDisk = (fileContent: string, name: string, mimeType: string) => {
    const blob = new Blob([fileContent], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setDownloadNotice(`Downloaded ${name}`);
    setTimeout(() => setDownloadNotice(null), 3000);
  };

  const downloadCurrent = () => {
    let mime = 'text/plain';
    if (filename.endsWith('.tsx') || filename.endsWith('.ts')) mime = 'text/typescript';
    else if (filename.endsWith('.py')) mime = 'text/x-python';
    else if (filename.endsWith('.html')) mime = 'text/html';
    else if (filename.endsWith('.json')) mime = 'application/json';
    else if (filename.endsWith('.sh')) mime = 'text/x-shellscript';

    saveFileToDisk(code, filename, mime);
  };

  const downloadSpecificFormat = (fmt: 'tsx' | 'py' | 'html') => {
    if (model) {
      if (fmt === 'tsx') {
        const gen = generate(model, 'nextjs');
        saveFileToDisk(gen.code, gen.filename, 'text/typescript');
      } else if (fmt === 'py') {
        const gen = generate(model, 'python');
        saveFileToDisk(gen.code, gen.filename, 'text/x-python');
      } else if (fmt === 'html') {
        const gen = generate(model, 'html');
        saveFileToDisk(gen.code, gen.filename, 'text/html');
      }
    } else {
      // In reverse mode or fallback without an active IntentModel
      const baseName = filename.replace(/\.[^.]+$/, '') || 'code';
      const extMime = {
        tsx: 'text/typescript',
        py: 'text/x-python',
        html: 'text/html',
      }[fmt];
      saveFileToDisk(code, `${baseName}.${fmt}`, extMime);
    }
  };

  return (
    <section className="panel code-panel">
      <header className="panel-head">
        <h2>3 · Generated code</h2>
        <span className="chip">
          {filename} · {language}
        </span>
        <div className="panel-actions">
          <button type="button" className="ghost" onClick={copy} title="Copy code to clipboard">
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button type="button" className="ghost" onClick={downloadCurrent} title={`Download ${filename}`}>
            Download
          </button>

          <div className="download-group" title="Quick download in specific format">
            <button
              type="button"
              className="download-pill"
              onClick={() => downloadSpecificFormat('tsx')}
              title="Download as React / Next.js (.tsx)"
            >
              .tsx
            </button>
            <button
              type="button"
              className="download-pill"
              onClick={() => downloadSpecificFormat('py')}
              title="Download as Python (.py)"
            >
              .py
            </button>
            <button
              type="button"
              className="download-pill"
              onClick={() => downloadSpecificFormat('html')}
              title="Download as HTML (.html)"
            >
              .html
            </button>
          </div>
        </div>
      </header>

      {downloadNotice ? <div className="vault-notice">{downloadNotice}</div> : null}

      <div className="code-scroll" ref={scrollRef}>
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
