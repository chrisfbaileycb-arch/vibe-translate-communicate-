import { useState } from 'react';

interface CoverLandingProps {
  heroCode: string;
  onLaunch: (initialMode?: 'speak' | 'reverse' | 'picture') => void;
  onLoadHeroIntoReverse: () => void;
}

export default function CoverLanding({ heroCode, onLaunch, onLoadHeroIntoReverse }: CoverLandingProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(heroCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handleDownload = () => {
    const blob = new Blob([heroCode], { type: 'text/typescript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Hero.tsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="cover-landing">
      {/* Hero Section */}
      <section className="cover-hero">
        {/* Background Gradients */}
        <div className="cover-grid-bg" />
        <div className="cover-radial-glow" />

        <div className="cover-hero-content">
          {/* Eyebrow / Motif */}
          <div className="cover-eyebrow-wrapper">
            <span className="cover-eyebrow">
              <span className="cover-eyebrow-dot" />
              vibe-translate-communicate
              <svg className="cover-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </div>

          {/* Title */}
          <h1 className="cover-title">LinguaCode</h1>

          {/* Subtitle */}
          <p className="cover-subtitle">
            Speak an idea, drop a picture, or paste source code — see the semantic model, get production code, and verify
            it visually with two-way binding.
          </p>

          {/* Primary Action Buttons */}
          <div className="cover-cta-row">
            <button type="button" className="cover-primary-btn" onClick={() => onLaunch('speak')}>
              Launch Translator Studio
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
            <button type="button" className="cover-ghost-btn" onClick={() => onLaunch('picture')}>
              🖼️ Picture → Code (Reverse Flow)
            </button>
            <button type="button" className="cover-ghost-btn" onClick={onLoadHeroIntoReverse}>
              Open in Code → Visual Mode
            </button>
          </div>
        </div>
      </section>

      {/* Code & Live Visual Showcase */}
      <section className="cover-showcase-section">
        <div className="cover-section-header">
          <span className="cover-tag">Interactive Proof</span>
          <h2>The Code &amp; The Render</h2>
          <p>
            Every property in the code maps back to a semantic node. Click and inspect the Hero component below.
          </p>
        </div>

        <div className="cover-showcase-grid">
          {/* Visual Component Render */}
          <div className="cover-card cover-visual-card">
            <div className="cover-card-bar">
              <span className="cover-dot dot-red" />
              <span className="cover-dot dot-yellow" />
              <span className="cover-dot dot-green" />
              <span className="cover-card-title">Live Component Proof (Tailwind CSS)</span>
              <button
                type="button"
                className="cover-card-action"
                onClick={onLoadHeroIntoReverse}
                title="Edit this in the visual studio"
              >
                Inspect in Studio →
              </button>
            </div>
            <div className="cover-preview-wrapper">
              <div className="cover-preview-box">
                {/* Embedded preview representation */}
                <div className="cover-live-hero">
                  <div className="cover-live-grid" />
                  <div className="cover-live-radial" />
                  <span className="cover-live-eyebrow">
                    vibe-translate-communicate
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </span>
                  <h2 className="cover-live-title">Innovate Without Limits</h2>
                  <p className="cover-live-sub">
                    Transform ideas into code with semantic translation and visual verification.
                  </p>
                  <button type="button" className="cover-live-cta" onClick={() => onLaunch('speak')}>
                    Explore Now
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Component Code View */}
          <div className="cover-card cover-code-card">
            <div className="cover-card-bar">
              <span className="cover-card-title">Hero.tsx · Next.js / React</span>
              <div className="cover-card-actions">
                <button type="button" className="ghost" onClick={handleCopy}>
                  {copied ? 'Copied!' : 'Copy Code'}
                </button>
                <button type="button" className="ghost" onClick={handleDownload}>
                  Download .tsx
                </button>
              </div>
            </div>
            <pre className="cover-code-snippet">
              <code>{heroCode}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* 3 Pillars: Vibe - Translate - Communicate */}
      <section className="cover-pillars-section">
        <div className="cover-section-header">
          <span className="cover-tag">Core Philosophy</span>
          <h2>Vibe · Translate · Communicate</h2>
          <p>Reducing misinterpretation between human intent and machine execution.</p>
        </div>

        <div className="cover-pillars-grid">
          <div className="cover-pillar">
            <div className="cover-pillar-icon">🎙️</div>
            <h3>1. Vibe (Intent)</h3>
            <p>
              Speak or describe an idea freely. The system parses your intent into a structured <code>IntentModel</code>{' '}
              without discarding domain ergonomics.
            </p>
          </div>
          <div className="cover-pillar">
            <div className="cover-pillar-icon">⚡</div>
            <h3>2. Translate (Code)</h3>
            <p>
              Target Next.js/React, HTML+CSS, Python, and TypeScript contracts. Domain constraint linters catch implausible
              outputs before execution.
            </p>
          </div>
          <div className="cover-pillar">
            <div className="cover-pillar-icon">🔄</div>
            <h3>3. Communicate (Verify)</h3>
            <p>
              Two-way binding between pixels and syntax: click any rendered node to light up the source line and property.
              Point, correct, and evolve.
            </p>
          </div>
        </div>
      </section>

      {/* Jumpstart Bar */}
      <section className="cover-footer-cta">
        <h2>Start Translating Now</h2>
        <p>Pick a preset prompt or speak your custom vision.</p>
        <div className="cover-quick-prompts">
          <button
            type="button"
            className="chip-button"
            onClick={() => onLaunch('speak')}
          >
            "Build a wooden table, 48 inch top, 2 inch legs"
          </button>
          <button
            type="button"
            className="chip-button"
            onClick={() => onLaunch('speak')}
          >
            "A blue button that says Save"
          </button>
          <button
            type="button"
            className="chip-button"
            onClick={onLoadHeroIntoReverse}
          >
            "Hero Component (Code → Visual)"
          </button>
        </div>
      </section>
    </div>
  );
}
