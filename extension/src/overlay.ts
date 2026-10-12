import { classifyCommand } from '../../src/lib/safety.ts';
import { safetyNote, type ShellTranslation } from '../../src/lib/shell.ts';
import type { OverlayRequest, OverlayStatus, Reply } from './shared.ts';
import { findTerminal, injectCommand, type TerminalTarget } from './terminal.ts';

/**
 * Floating mic overlay, injected on demand (shortcut or toolbar click).
 * Speech -> background (LinguaCode shell engine) -> one command + one safety line -> clipboard / web terminal.
 * Running the script again toggles the existing overlay instead of installing a second one.
 */

const CSS = `
:host { all: initial; }
.panel {
  position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
  width: min(580px, calc(100vw - 32px)); box-sizing: border-box; padding: 14px 16px 12px;
  border-radius: 14px; border: 1px solid #26364f; background: rgba(17, 26, 43, 0.97); color: #e6edf7;
  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45); backdrop-filter: blur(8px);
}
.panel * { box-sizing: border-box; }
header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.mic {
  width: 30px; height: 30px; flex: none; border-radius: 50%; border: 0; cursor: pointer; color: #041225;
  background: linear-gradient(140deg, #38bdf8, #2563eb); font-size: 14px; display: grid; place-items: center;
}
.mic.live { background: #f87171; animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(248, 113, 113, 0.5); } 50% { box-shadow: 0 0 0 8px rgba(248, 113, 113, 0); } }
.title { font-weight: 700; font-size: 13px; }
.chip { font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #93a4bd;
  border: 1px solid #26364f; border-radius: 999px; padding: 1px 8px; }
.close { margin-left: auto; background: transparent; border: 0; color: #93a4bd; font-size: 16px; cursor: pointer; padding: 2px 6px; }
.close:hover { color: #e6edf7; }
.heard { min-height: 20px; color: #93a4bd; font-style: italic; margin-bottom: 8px; word-break: break-word; }
.heard.final { color: #e6edf7; font-style: normal; }
input.ask, textarea.cmd {
  width: 100%; border-radius: 9px; border: 1px solid #26364f; background: #0a1120; color: #e6edf7;
  padding: 8px 10px; font: inherit; outline: none;
}
input.ask:focus, textarea.cmd:focus { border-color: #38bdf8; }
textarea.cmd {
  font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #cfe0f5; resize: none; min-height: 40px;
  border-left-width: 3px;
}
.safe textarea.cmd { border-left-color: #34d399; }
.caution textarea.cmd { border-left-color: #f59e0b; }
.destructive textarea.cmd { border-left-color: #f87171; }
.result { margin-top: 10px; }
.note { margin: 6px 0 10px; font-size: 12px; }
.safe .note { color: #34d399; }
.caution .note { color: #f59e0b; }
.destructive .note { color: #f87171; font-weight: 600; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.actions button {
  border-radius: 8px; border: 1px solid #26364f; background: transparent; color: #e6edf7;
  padding: 6px 12px; font: 600 12px/1.4 inherit; cursor: pointer;
}
.actions button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.destructive .actions button.primary { background: transparent; border-color: #f87171; color: #f87171; }
.actions button:hover { border-color: #38bdf8; }
.status { margin: 10px 0 0; font-size: 11.5px; color: #93a4bd; min-height: 17px; }
.status.err { color: #f87171; }
kbd { font: 11px ui-monospace, monospace; border: 1px solid #26364f; border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; }
[hidden] { display: none !important; }
`;

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const PASTE_KEYS = IS_MAC ? '⌘V' : 'Ctrl+Shift+V';

function send<T>(message: OverlayRequest): Promise<T> {
  return chrome.runtime.sendMessage<Reply<T>>(message).then((reply) => {
    if (!reply) throw new Error('The extension background is not responding.');
    if (!reply.ok) throw new Error(reply.error);
    return reply.data;
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function createOverlay() {
  const host = document.createElement('linguacode-voice');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>${CSS}</style>
    <div class="panel" role="dialog" aria-label="LinguaCode voice to shell">
      <header>
        <button class="mic" type="button" aria-label="Start or stop listening">●</button>
        <span class="title">LinguaCode → shell</span>
        <span class="chip engine">local</span>
        <button class="close" type="button" aria-label="Close">✕</button>
      </header>
      <div class="heard" aria-live="polite"></div>
      <form><input class="ask" type="text" placeholder="…or type it: find large log files in the logs folder" aria-label="Describe a shell command" /></form>
      <div class="result" hidden>
        <textarea class="cmd" rows="1" spellcheck="false" aria-label="Command (editable)"></textarea>
        <p class="note" role="status"></p>
        <div class="actions">
          <button class="primary copy" type="button">Copy</button>
          <button class="inject" type="button" hidden>Insert into terminal</button>
          <button class="again" type="button">Speak again</button>
        </div>
      </div>
      <p class="status" aria-live="polite"></p>
    </div>`;

  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const panel = $<HTMLDivElement>('.panel');
  const mic = $<HTMLButtonElement>('.mic');
  const engineChip = $<HTMLSpanElement>('.engine');
  const heard = $<HTMLDivElement>('.heard');
  const form = $<HTMLFormElement>('form');
  const ask = $<HTMLInputElement>('.ask');
  const result = $<HTMLDivElement>('.result');
  const cmd = $<HTMLTextAreaElement>('.cmd');
  const note = $<HTMLParagraphElement>('.note');
  const copyBtn = $<HTMLButtonElement>('.copy');
  const injectBtn = $<HTMLButtonElement>('.inject');
  const statusLine = $<HTMLParagraphElement>('.status');

  let status: OverlayStatus = { speech: 'webspeech', engine: 'local', autoCopy: true, shortcut: 'Alt+S' };
  let previousFocus: Element | null = null;
  let terminal: TerminalTarget | null = null;
  let level: ShellTranslation['safety']['level'] = 'safe';
  let stopListening: (() => void) | null = null;
  let open = false;

  // Keep page shortcuts (VS Code, Cloud Shell) from swallowing keystrokes typed into the overlay.
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }

  const say = (text: string, isError = false) => {
    statusLine.innerHTML = text;
    statusLine.classList.toggle('err', isError);
  };

  const setListening = (on: boolean) => {
    mic.classList.toggle('live', on);
    mic.textContent = on ? '■' : '●';
  };

  const fitCommand = () => {
    cmd.style.height = 'auto';
    cmd.style.height = `${cmd.scrollHeight + 2}px`;
  };

  const applySafety = (command: string) => {
    const safety = classifyCommand(command);
    level = safety.level;
    panel.classList.remove('safe', 'caution', 'destructive');
    panel.classList.add(level);
    note.textContent = safetyNote(safety);
    const risky = level === 'destructive';
    copyBtn.textContent = risky ? 'Copy anyway' : 'Copy';
    injectBtn.textContent = `${risky ? 'Insert anyway' : 'Insert'} into ${terminal?.label ?? 'terminal'}`;
  };

  async function writeClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* page not focused or clipboard blocked by permissions policy */
    }
    await send<null>({ type: 'lc.copy', text });
  }

  async function copy(manual: boolean) {
    const command = cmd.value.trim();
    if (!command) return;
    try {
      await writeClipboard(command);
      say(
        terminal
          ? `Copied. Paste with <kbd>${PASTE_KEYS}</kbd>, or use “Insert into ${terminal.label}”.`
          : `Copied. Press <kbd>${PASTE_KEYS}</kbd> in your terminal.`,
      );
    } catch (error) {
      say(`Copy failed: ${(error as Error).message}`, true);
    }
    if (!manual) copyBtn.blur();
  }

  async function translate(text: string) {
    heard.textContent = text;
    heard.classList.add('final');
    say('Translating…');
    try {
      const translation = await send<ShellTranslation>({ type: 'lc.translate', text });
      cmd.value = translation.command;
      result.hidden = false;
      fitCommand();
      applySafety(translation.command);
      if (level === 'destructive') {
        say('Not copied automatically — this command is destructive. Review it first.');
      } else if (status.autoCopy) {
        await copy(false);
      } else {
        say('');
      }
      cmd.focus();
    } catch (error) {
      say((error as Error).message, true);
      ask.focus();
    }
  }

  function listenWebSpeech() {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      say('This browser has no speech recognition here — type instead.', true);
      ask.focus();
      return;
    }
    const rec = new Recognition();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      heard.classList.remove('final');
      heard.textContent = finalText || interim;
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        say('Microphone is blocked for this site — allow it in the address bar, or type instead.', true);
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        say(`Speech error: ${e.error} — type instead.`, true);
      }
      ask.focus();
    };
    rec.onend = () => {
      setListening(false);
      stopListening = null;
      if (finalText.trim()) void translate(finalText.trim());
      else {
        if (!statusLine.classList.contains('err')) say('Didn’t catch that — speak again or type it.');
        ask.focus();
      }
    };
    rec.start();
    setListening(true);
    stopListening = () => rec.stop();
    say(`Listening… press <kbd>${status.shortcut}</kbd> or ■ to stop.`);
  }

  async function listenWhisper() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      say('Microphone is blocked for this site — allow it in the address bar, or type instead.', true);
      ask.focus();
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const limit = window.setTimeout(() => recorder.state === 'recording' && recorder.stop(), 12_000);
    recorder.onstop = async () => {
      window.clearTimeout(limit);
      stream.getTracks().forEach((t) => t.stop());
      setListening(false);
      stopListening = null;
      say('Transcribing with Whisper…');
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const text = await send<string>({ type: 'lc.transcribe', audio: await blobToBase64(blob), mime: blob.type });
        if (text) void translate(text);
        else say('Whisper heard nothing — speak again or type it.');
      } catch (error) {
        say((error as Error).message, true);
      }
    };
    recorder.start();
    setListening(true);
    stopListening = () => recorder.state === 'recording' && recorder.stop();
    say(`Recording (Whisper)… press <kbd>${status.shortcut}</kbd> or ■ to stop.`);
  }

  function listen() {
    if (stopListening) return;
    result.hidden = true;
    heard.textContent = '';
    if (status.speech === 'whisper') void listenWhisper();
    else listenWebSpeech();
  }

  function close() {
    stopListening?.();
    host.remove();
    open = false;
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }

  async function show() {
    previousFocus = document.activeElement;
    terminal = findTerminal(previousFocus);
    injectBtn.hidden = !terminal;
    (document.body ?? document.documentElement).appendChild(host);
    open = true;
    try {
      status = await send<OverlayStatus>({ type: 'lc.status' });
    } catch {
      /* keep defaults */
    }
    engineChip.textContent = status.engine === 'remote' ? 'AI · BYOK' : 'local rules';
    listen();
  }

  mic.addEventListener('click', () => (stopListening ? stopListening() : listen()));
  $<HTMLButtonElement>('.close').addEventListener('click', close);
  $<HTMLButtonElement>('.again').addEventListener('click', listen);
  copyBtn.addEventListener('click', () => void copy(true));
  injectBtn.addEventListener('click', () => {
    if (!terminal) return;
    const target = terminal;
    const command = cmd.value.trim();
    close();
    injectCommand(target, command);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    stopListening?.();
    if (ask.value.trim()) void translate(ask.value.trim());
    ask.value = '';
  });
  cmd.addEventListener('input', () => {
    fitCommand();
    applySafety(cmd.value);
    say('Edited — safety re-checked. Copy again when ready.');
  });
  cmd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // one line only; Enter copies instead of adding a newline
      void copy(true);
    }
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  return {
    toggle() {
      if (!open) void show();
      else if (stopListening) stopListening();
      else close();
    },
  };
}

(window.__lcOverlay ??= createOverlay()).toggle();
