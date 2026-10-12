import { useEffect, useRef, useState } from 'react';

interface LinuxWidgetModalProps {
  onClose: () => void;
}

const REPO = 'chrisfbaileycb-arch/vibe-translate-communicate-';
const SCRIPT_URL = `https://raw.githubusercontent.com/${REPO}/main/scripts/install-widget.sh`;
const SOURCE_URL = `https://github.com/${REPO}/blob/main/scripts/install-widget.sh`;

const ONE_LINER = `curl -fsSL ${SCRIPT_URL} | bash`;
const READ_FIRST = `curl -fsSL ${SCRIPT_URL} -o install-widget.sh\nless install-widget.sh\nbash install-widget.sh`;

const USAGE: { cmd: string; what: string }[] = [
  { cmd: 'linguacode-voice "find log files bigger than 100MB"', what: 'Type it — command + safety line, copied to the clipboard.' },
  { cmd: 'linguacode-voice', what: 'Speak it — press Enter to stop recording.' },
  { cmd: 'eval "$(linguacode-voice --shell-init bash)"', what: 'Add to ~/.bashrc (or zsh): Alt+S speaks straight onto your prompt line. Nothing runs until you press Enter.' },
  { cmd: 'linguacode-voice --notify', what: 'Bind to a desktop hotkey: records 6 s, copies, shows a notification.' },
  { cmd: 'linguacode-voice key set', what: 'Optional: your OpenRouter / OpenAI-compatible key (desktop keyring or a 0600 file).' },
  { cmd: 'linguacode-voice key clear', what: 'Destroy the stored key.' },
];

function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard permission denied — the text is selectable */
    }
  };
  return (
    <div className="copy-block">
      <pre aria-label={label}>{text}</pre>
      <button type="button" className="ghost" onClick={copy}>
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

export default function LinuxWidgetModal({ onClose }: LinuxWidgetModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal linux-widget"
        role="dialog"
        aria-modal="true"
        aria-labelledby="linux-widget-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="membership-head">
          <div>
            <span className="membership-eyebrow">Terminal Voice Companion · Linux</span>
            <h2 id="linux-widget-title">Speak plain English, paste a verified command</h2>
            <p>
              A native CLI — no browser sandbox. It turns your intent into one POSIX command plus a one-line safety note and
              puts it on your clipboard. Destructive commands are never copied without an explicit yes.
            </p>
          </div>
          <button type="button" className="ghost modal-close" onClick={onClose} aria-label="Close Linux widget dialog">
            ✕
          </button>
        </header>

        <h3 className="lw-step">Install (no sudo — everything goes in ~/.local)</h3>
        <CopyBlock text={ONE_LINER} label="One-line install command" />
        <details className="lw-details">
          <summary>Prefer to read the script before running it?</summary>
          <CopyBlock text={READ_FIRST} label="Download, inspect, then install" />
          <p className="hint">
            Source:{' '}
            <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
              scripts/install-widget.sh ↗
            </a>{' '}
            · uninstall with <code>bash install-widget.sh --uninstall</code>
          </p>
        </details>

        <h3 className="lw-step">Use it</h3>
        <ul className="lw-usage">
          {USAGE.map((u) => (
            <li key={u.cmd}>
              <code>{u.cmd}</code>
              <span>{u.what}</span>
            </li>
          ))}
        </ul>

        <h3 className="lw-step">Requirements</h3>
        <ul className="lw-reqs">
          <li>Linux with Node.js 18+ (the CLI is one file, no npm packages).</li>
          <li>Recorder: PipeWire, PulseAudio, ALSA or ffmpeg · Clipboard: wl-clipboard (Wayland) or xclip / xsel (X11).</li>
          <li>
            Speech-to-text: whisper.cpp offline, or <code>HF_TOKEN</code> for Hugging Face Whisper. Without either, it asks you
            to type.
          </li>
          <li>No API key needed — local rules work offline. Add a key for open-ended requests; safety is always re-checked locally.</li>
        </ul>
      </div>
    </div>
  );
}
