import { useEffect, useRef, useState } from 'react';

export type MembershipTierId = 'founding';

interface MembershipModalProps {
  onClose: () => void;
  /** Called when a tier's CTA is pressed. Billing is not wired up in this build. */
  onSelectTier: (tier: MembershipTierId) => void;
}

const FOUNDING_PERKS = [
  'Full LinguaCode Studio — Component Compiler + Workflow DAG Canvas.',
  'Terminal Voice Companion: Chrome extension + native Linux widget download.',
  'Access to the Community Blueprint & Knowledge Graph repository.',
  'BYOK freedom: zero inference markup — bring your own capped OpenRouter or Gemini key.',
];

const COHORT_PERKS = [
  'Same Studio, Voice Companion and Knowledge Graph access.',
  'BYOK — zero inference markup, same as founders.',
  'Opens once the public blueprint registry reaches critical mass.',
];

export default function MembershipModal({ onClose, onSelectTier }: MembershipModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<MembershipTierId | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  const choose = (tier: MembershipTierId) => {
    setPicked(tier);
    onSelectTier(tier);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal membership"
        role="dialog"
        aria-modal="true"
        aria-labelledby="membership-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="membership-head">
          <div>
            <span className="membership-eyebrow">Membership</span>
            <h2 id="membership-title">Become a Founding Contributor</h2>
            <p>Lock in the seed rate before the public blueprint registry opens. Your keys, your bill — we never resell tokens.</p>
          </div>
          <button type="button" className="ghost modal-close" onClick={onClose} aria-label="Close membership dialog">
            ✕
          </button>
        </header>

        <div className="tier-grid">
          <article className="tier tier-founding">
            <div className="tier-top">
              <span className="tier-badge">FOUNDING CONTRIBUTOR • LIFETIME RATE GUARANTEE</span>
            </div>
            <h3>Founding Contributor</h3>
            <div className="tier-price">
              <b>$10</b>
              <span>/ quarter</span>
            </div>
            <p className="tier-equiv">≈ $3.33 / month, billed quarterly</p>
            <p className="tier-terms">Lock in $10/quarter permanently, as long as your subscription stays active.</p>
            <ul>
              {FOUNDING_PERKS.map((perk) => (
                <li key={perk}>{perk}</li>
              ))}
            </ul>
            <button type="button" className="primary tier-cta" onClick={() => choose('founding')}>
              Claim founding seat
            </button>
          </article>

          <article className="tier tier-future" aria-label="Future standard rate for subsequent cohorts">
            <div className="tier-top">
              <span className="tier-flag tier-flag-muted">Subsequent Cohorts</span>
            </div>
            <h3>Standard Rate</h3>
            <div className="tier-price">
              <b>
                <s>$25</s>
              </b>
              <span>/ quarter</span>
            </div>
            <p className="tier-equiv">Future standard rate — founders never move to it.</p>
            <ul>
              {COHORT_PERKS.map((perk) => (
                <li key={perk}>{perk}</li>
              ))}
            </ul>
            <button type="button" className="ghost tier-cta" disabled>
              Not open yet
            </button>
          </article>
        </div>

        <div className="rewards-banner">
          <span className="rewards-icon" aria-hidden="true">
            ★
          </span>
          <p>
            <b>Community karma:</b> Earn free quarterly membership extensions by contributing verified blueprints and workflow DAGs
            upvoted by the community.
          </p>
        </div>

        {picked ? (
          <p className="vault-notice" role="status">
            Founding Contributor selected. Checkout isn&apos;t live yet — this build has no billing connected.
          </p>
        ) : null}
      </div>
    </div>
  );
}
