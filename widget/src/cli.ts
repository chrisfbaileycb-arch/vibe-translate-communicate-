/**
 * LinguaCode Terminal Voice Companion — native Linux CLI.
 *
 * Speak (or type) plain English -> ONE POSIX command + ONE safety line -> system clipboard.
 * Same engine as the studio and the Chrome extension (src/lib/shell.ts): local rules offline,
 * or your own OpenAI-compatible key (OpenRouter by default). Safety is always re-checked locally,
 * and destructive commands are never copied without an explicit yes.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { translateShell, type ShellTranslation } from '../../src/lib/shell.ts';

const VERSION = '0.1.0';
const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'qwen/qwen-2.5-coder-32b-instruct';
const WHISPER_URL = 'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo';
const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'linguacode');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const KEY_FILE = join(CONFIG_DIR, 'key');

interface Config {
  endpoint: string;
  model: string;
}

/* ---------------------------------- terminal output ---------------------------------- */

const tty = process.stderr.isTTY;
const paint = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint('1');
const dim = paint('2');
const red = paint('1;31');
const yellow = paint('33');
const green = paint('32');
const info = (s: string) => process.stderr.write(`${dim(s)}\n`);

function fail(message: string, code = 1): never {
  process.stderr.write(`${red('linguacode:')} ${message}\n`);
  process.exit(code);
}

/* ---------------------------------- config & key ---------------------------------- */

function loadConfig(): Config {
  let stored: Partial<Config> = {};
  try {
    stored = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Partial<Config>;
  } catch {
    /* first run */
  }
  return {
    endpoint: process.env.LINGUACODE_ENDPOINT || stored.endpoint || DEFAULT_ENDPOINT,
    model: process.env.LINGUACODE_MODEL || stored.model || DEFAULT_MODEL,
  };
}

function saveConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  // 0600 + chmod: whoever can rewrite the endpoint can redirect your key, so never trust the umask here.
  writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(CONFIG_FILE, 0o600);
}

function has(command: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' }).status === 0;
}

/** Env var -> desktop keyring (secret-tool) -> 0600 file. */
function loadKey(): { key: string; source: string } | null {
  for (const name of ['LINGUACODE_API_KEY', 'OPENROUTER_API_KEY']) {
    if (process.env[name]) return { key: process.env[name]!, source: `$${name}` };
  }
  if (has('secret-tool')) {
    const r = spawnSync('secret-tool', ['lookup', 'service', 'linguacode', 'account', 'default'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return { key: r.stdout.trim(), source: 'desktop keyring' };
  }
  if (existsSync(KEY_FILE)) {
    const key = readFileSync(KEY_FILE, 'utf8').trim();
    if (key) return { key, source: KEY_FILE };
  }
  return null;
}

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin });
      rl.once('line', (line) => {
        rl.close();
        resolve(line.trim());
      });
      return;
    }
    process.stderr.write(prompt);
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stderr.write('\n');
          resolve(value.trim());
          return;
        }
        if (ch === '\u0003') {
          process.stdin.setRawMode(false);
          process.stderr.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function keyCommand(action: string | undefined, flags: Map<string, string>): Promise<void> {
  const config = loadConfig();
  if (action === 'set') {
    const key = await readHidden('Paste API key (input hidden): ');
    if (!key) fail('No key entered.');
    config.endpoint = flags.get('endpoint') ?? config.endpoint;
    config.model = flags.get('model') ?? config.model;
    saveConfig(config);
    const stored = has('secret-tool')
      ? spawnSync('secret-tool', ['store', '--label=LinguaCode API key', 'service', 'linguacode', 'account', 'default'], {
          input: key,
        }).status === 0
      : false;
    if (!stored) {
      mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(KEY_FILE, key, { mode: 0o600 });
      chmodSync(KEY_FILE, 0o600);
    }
    process.stderr.write(`${green('✓')} Key saved to ${stored ? 'your desktop keyring' : `${KEY_FILE} (mode 600)`}.\n`);
    process.stderr.write(`  endpoint ${config.endpoint}\n  model    ${config.model}\n`);
    return;
  }
  if (action === 'clear') {
    if (has('secret-tool')) spawnSync('secret-tool', ['clear', 'service', 'linguacode', 'account', 'default']);
    if (existsSync(KEY_FILE)) {
      writeFileSync(KEY_FILE, '\0'.repeat(128), { mode: 0o600 });
      unlinkSync(KEY_FILE);
    }
    process.stderr.write(`${green('✓')} Key destroyed (keyring entry and key file removed).\n`);
    if (process.env.LINGUACODE_API_KEY || process.env.OPENROUTER_API_KEY) {
      process.stderr.write(yellow('  A key is still set in your environment — unset LINGUACODE_API_KEY / OPENROUTER_API_KEY.\n'));
    }
    return;
  }
  const found = loadKey();
  process.stderr.write(
    found
      ? `key      ${found.key.slice(0, 6)}…${found.key.slice(-4)} (from ${found.source})\n`
      : 'key      none — local rules only (offline)\n',
  );
  process.stderr.write(`endpoint ${config.endpoint}\nmodel    ${config.model}\n`);
}

/* ---------------------------------- audio ---------------------------------- */

function recorderFor(file: string, seconds?: number): [string, string[]] | null {
  if (has('pw-record')) return ['pw-record', ['--rate', '16000', '--channels', '1', '--format', 's16', file]];
  if (has('parecord')) return ['parecord', ['--rate=16000', '--channels=1', '--format=s16le', '--file-format=wav', file]];
  if (has('arecord')) return ['arecord', ['-q', '-f', 'S16_LE', '-r', '16000', '-c', '1', '-t', 'wav', ...(seconds ? ['-d', String(seconds)] : []), file]];
  if (has('ffmpeg')) {
    return ['ffmpeg', ['-loglevel', 'error', '-f', 'pulse', '-i', 'default', '-ac', '1', '-ar', '16000', ...(seconds ? ['-t', String(seconds)] : []), '-y', file]];
  }
  return null;
}

/** Waits for one keypress on the TTY. Resolves true for Enter/Space, false for Esc/q. */
function waitForKey(): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', (buf: Buffer) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      const ch = buf.toString('utf8');
      if (ch === '\u0003') process.exit(130);
      resolve(!(ch === '\u001b' || ch === 'q'));
    });
  });
}

async function record(seconds?: number): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), 'linguacode-'));
  const file = join(dir, 'utterance.wav');
  const recorder = recorderFor(file, seconds);
  if (!recorder) fail('No audio recorder found. Install pipewire (pw-record), pulseaudio-utils (parecord), alsa-utils (arecord) or ffmpeg.');
  const child = spawn(recorder[0], recorder[1], { stdio: 'ignore' });
  const done = new Promise<void>((resolve) => child.on('close', () => resolve()));
  let keep = true;
  if (seconds || !process.stdin.isTTY) {
    info(`● Recording for ${seconds ?? 6}s…`);
    setTimeout(() => child.kill('SIGINT'), (seconds ?? 6) * 1000);
  } else {
    info('● Listening… press Enter to stop, Esc to cancel.');
    keep = await waitForKey();
    child.kill('SIGINT');
  }
  await done;
  if (!keep || !existsSync(file)) {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  return file;
}

function whisperCppModel(): string | null {
  const candidates = [
    process.env.LINGUACODE_WHISPER_MODEL,
    join(homedir(), '.local/share/linguacode/ggml-base.en.bin'),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** whisper.cpp (offline) -> Hugging Face Whisper (hf_ token) -> null (caller falls back to typing). */
async function transcribe(file: string): Promise<string | null> {
  try {
    const model = whisperCppModel();
    const bin = ['whisper-cli', 'whisper-cpp'].find(has);
    if (model && bin) {
      info('Transcribing locally (whisper.cpp)…');
      const r = spawnSync(bin, ['-m', model, '-f', file, '-nt', '-np'], { encoding: 'utf8' });
      if (r.status === 0) return r.stdout.replace(/\[.*?\]/g, '').trim();
    }
    const stored = loadKey()?.key;
    const hf = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || (stored?.startsWith('hf_') ? stored : '');
    if (hf) {
      info('Transcribing with Hugging Face Whisper…');
      const response = await fetch(WHISPER_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${hf}`, 'content-type': 'audio/wav' },
        body: readFileSync(file),
      });
      if (!response.ok) throw new Error(`Whisper returned ${response.status}`);
      return ((await response.json()) as { text?: string }).text?.trim() ?? '';
    }
    return null;
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true });
  }
}

function askLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/* ---------------------------------- clipboard & notify ---------------------------------- */

function copyToClipboard(text: string): string | null {
  const tools: [string, string[]][] = [];
  if (process.env.WAYLAND_DISPLAY) tools.push(['wl-copy', []]);
  if (process.env.DISPLAY) tools.push(['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]);
  for (const [bin, args] of tools) {
    if (!has(bin)) continue;
    const r = spawnSync(bin, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 3000 });
    if (r.status === 0) return bin;
  }
  return null;
}

function notify(title: string, body: string, critical: boolean): void {
  if (has('notify-send')) {
    spawnSync('notify-send', ['-a', 'LinguaCode', '-u', critical ? 'critical' : 'normal', title, body]);
  } else {
    process.stderr.write(`${title}\n${body}\n`);
  }
}

/* ---------------------------------- shell integration ---------------------------------- */

const SHELL_INIT: Record<string, string> = {
  bash: `# LinguaCode: Alt+S speaks a command onto your prompt line (it is NOT executed).
__linguacode_voice() {
  local cmd
  cmd="$(linguacode-voice --print </dev/tty)" || return
  READLINE_LINE="\${READLINE_LINE:0:$READLINE_POINT}\${cmd}\${READLINE_LINE:$READLINE_POINT}"
  READLINE_POINT=$((READLINE_POINT + \${#cmd}))
}
bind -x '"\\es": __linguacode_voice'`,
  zsh: `# LinguaCode: Alt+S speaks a command onto your prompt line (it is NOT executed).
__linguacode_voice() {
  local cmd
  cmd="$(linguacode-voice --print </dev/tty)" || { zle reset-prompt; return }
  LBUFFER+="$cmd"
  zle reset-prompt
}
zle -N __linguacode_voice
bindkey '\\es' __linguacode_voice`,
};

/* ---------------------------------- main ---------------------------------- */

const HELP = `linguacode-voice ${VERSION} — plain English in, one verified POSIX command out.

Usage:
  linguacode-voice                     speak; press Enter to stop (falls back to typing without speech-to-text)
  linguacode-voice "find big log files"  translate text directly
  linguacode-voice --type              type instead of speaking
  linguacode-voice --print             command on stdout only (used by the Alt+S shell binding)
  linguacode-voice --notify [--seconds N]  desktop-hotkey mode: record N s (default 6), copy, notify
  linguacode-voice --shell-init bash|zsh   print the Alt+S prompt binding — add: eval "$(linguacode-voice --shell-init bash)"
  linguacode-voice key set [--endpoint URL] [--model ID]   store an API key (keyring, or ~/.config/linguacode/key 0600)
  linguacode-voice key clear           destroy the stored key
  linguacode-voice key status

Without a key everything runs offline on local rules. With a key, any OpenAI-compatible endpoint works
(default ${DEFAULT_ENDPOINT}, model ${DEFAULT_MODEL}). Safety is always re-checked locally.
Speech-to-text: whisper.cpp (whisper-cli + LINGUACODE_WHISPER_MODEL) offline, or HF_TOKEN for Hugging Face Whisper.`;

function parseArgs(argv: string[]): { flags: Map<string, string>; positional: string[] } {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split('=', 2);
    const takesValue = ['seconds', 'endpoint', 'model', 'shell-init'].includes(name);
    flags.set(name, inline ?? (takesValue ? (argv[++i] ?? '') : 'true'));
  }
  return { flags, positional };
}

function render(t: ShellTranslation): void {
  const color = t.safety.level === 'destructive' ? red : t.safety.level === 'caution' ? yellow : green;
  process.stdout.write(`${tty ? bold(t.command) : t.command}\n`);
  process.stderr.write(`${color(t.note)}\n`);
}

async function main(): Promise<void> {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (flags.has('help') || positional[0] === 'help') return void process.stdout.write(`${HELP}\n`);
  if (flags.has('version')) return void process.stdout.write(`${VERSION}\n`);
  if (flags.has('shell-init')) {
    const shell = flags.get('shell-init') || 'bash';
    if (!SHELL_INIT[shell]) fail(`Unsupported shell "${shell}" — use bash or zsh.`);
    return void process.stdout.write(`${SHELL_INIT[shell]}\n`);
  }
  if (positional[0] === 'key') return keyCommand(positional[1], flags);

  const notifyMode = flags.has('notify');
  const printMode = flags.has('print');
  const seconds = flags.has('seconds') ? Math.min(30, Math.max(1, Number(flags.get('seconds')) || 6)) : undefined;

  let text = positional.join(' ').trim();
  if (!text && !flags.has('type')) {
    const file = await record(notifyMode ? (seconds ?? 6) : seconds);
    if (!file) process.exit(130);
    const heard = await transcribe(file);
    if (heard === null) {
      if (notifyMode || !process.stdin.isTTY) {
        notify('LinguaCode: no speech-to-text', 'Install whisper.cpp or set HF_TOKEN, or run linguacode-voice --type.', true);
        process.exit(2);
      }
      info('No speech-to-text configured (whisper.cpp or HF_TOKEN) — type it instead.');
    } else {
      text = heard;
      if (text) info(`heard: “${text}”`);
    }
  }
  if (!text) text = await askLine('What should the command do? ');
  if (!text) process.exit(130);

  const config = loadConfig();
  const key = loadKey();
  let result: ShellTranslation;
  try {
    result = await translateShell(text, {
      id: key ? 'remote' : 'local',
      apiKey: key?.key,
      endpoint: config.endpoint,
      model: config.model,
    });
  } catch (error) {
    if (notifyMode) notify('LinguaCode', (error as Error).message, true);
    fail((error as Error).message);
  }

  const destructive = result.safety.level === 'destructive';
  if (printMode) {
    // Lands on the prompt line for review; it is never executed for you.
    process.stdout.write(result.command);
    process.stderr.write(`\n${(destructive ? red : result.safety.level === 'caution' ? yellow : green)(result.note)}\n`);
    return;
  }

  render(result);
  let copy = !destructive;
  if (destructive && notifyMode) {
    notify('⛔ Not copied — destructive command', `${result.command}\n${result.note}`, true);
    return;
  }
  if (destructive && process.stdin.isTTY) copy = /^y(es)?$/i.test(await askLine('Copy this destructive command anyway? [y/N] '));
  if (!copy) return;

  const tool = copyToClipboard(result.command);
  const pasteHint = 'paste with Ctrl+Shift+V';
  if (notifyMode) {
    notify(tool ? 'Copied — Ctrl+Shift+V in your terminal' : 'LinguaCode (clipboard unavailable)', `${result.command}\n${result.note}`, false);
  } else if (tool) {
    info(`Copied via ${tool} — ${pasteHint}.`);
  } else {
    info('No clipboard tool found (install wl-clipboard, xclip or xsel) — copy the command above.');
  }
}

main().catch((error: Error) => fail(error.message));
