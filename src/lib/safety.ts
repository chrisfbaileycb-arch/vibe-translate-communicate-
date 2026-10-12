/**
 * Safety & flag inspector for POSIX shell commands.
 *
 *  - safe (green):        read-only commands — ls, cat, grep, find …
 *  - caution (yellow):    network or file writes — curl, touch, cp, redirects …
 *  - destructive (red):   data loss — rm, --force, DROP, TRUNCATE …
 *
 * Deliberately conservative: anything it does not recognise is "caution", never "safe".
 */

export type SafetyLevel = 'safe' | 'caution' | 'destructive';

export interface CommandSafety {
  command: string;
  level: SafetyLevel;
  /** Program names found in each pipeline / && / ; segment. */
  programs: string[];
  flags: string[];
  reasons: string[];
}

const RANK: Record<SafetyLevel, number> = { safe: 0, caution: 1, destructive: 2 };

const SAFE = new Set([
  'ls', 'cat', 'grep', 'egrep', 'rg', 'find', 'head', 'tail', 'wc', 'echo', 'printf', 'pwd', 'which', 'du', 'df',
  'stat', 'diff', 'sort', 'uniq', 'awk', 'jq', 'date', 'test', '[', 'true', 'whoami', 'env', 'file', 'less', 'tree',
  'basename', 'dirname', 'realpath', 'cut', 'tr', 'xargs', 'sleep', 'exit',
]);

const CAUTION = new Set([
  'curl', 'wget', 'touch', 'cp', 'mv', 'mkdir', 'scp', 'rsync', 'ssh', 'tee', 'tar', 'zip', 'unzip', 'gzip', 'chmod',
  'chown', 'ln', 'npm', 'npx', 'bun', 'pnpm', 'yarn', 'pip', 'apt', 'apt-get', 'brew', 'docker', 'kubectl', 'psql',
  'mysql', 'sqlite3', 'git', 'make', 'node', 'python', 'python3', 'sed', 'crontab', 'systemctl',
]);

const DESTRUCTIVE = new Set(['rm', 'rmdir', 'dd', 'mkfs', 'shred', 'truncate', 'kill', 'killall', 'pkill', 'reboot', 'shutdown', 'halt']);

/** Git subcommands that only read. */
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'branch', 'remote', 'fetch', 'blame', 'rev-parse']);

const DESTRUCTIVE_FLAGS = new Set(['--force', '-f', '--hard', '--delete', '-delete', '--no-preserve-root', '--prune', '-D']);

const DESTRUCTIVE_SQL = /\b(drop\s+(table|database|schema|index)|truncate(\s+table)?|delete\s+from)\b/i;

function stripQuotes(token: string): string {
  return token.replace(/^['"]|['"]$/g, '');
}

/** Split on pipes / && / || / ; while respecting simple quoting. */
function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (quote) {
      current += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
      continue;
    }
    if (c === ';' || c === '|' || c === '&') {
      if ((c === '|' || c === '&') && command[i + 1] === c) i += 1;
      segments.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter(Boolean);
}

function tokenize(segment: string): string[] {
  return segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function escalate(result: CommandSafety, level: SafetyLevel, reason: string): void {
  if (RANK[level] > RANK[result.level]) result.level = level;
  if (!result.reasons.includes(reason)) result.reasons.push(reason);
}

export function classifyCommand(command: string): CommandSafety {
  const result: CommandSafety = { command, level: 'safe', programs: [], flags: [], reasons: [] };
  const trimmed = command.trim();
  if (!trimmed || trimmed.startsWith('#')) return result;

  if (DESTRUCTIVE_SQL.test(trimmed)) escalate(result, 'destructive', 'destructive SQL (DROP / TRUNCATE / DELETE FROM)');
  if (/(^|[^>&0-9])>(?!>|&)\s*\S/.test(trimmed.replace(/"[^"]*"|'[^']*'/g, ''))) {
    escalate(result, 'caution', 'redirect `>` overwrites a file');
  } else if (/>>/.test(trimmed)) {
    escalate(result, 'caution', 'redirect `>>` appends to a file');
  }

  for (const segment of splitSegments(trimmed)) {
    const tokens = tokenize(segment);
    // Skip env assignments and privilege wrappers to find the real program.
    let i = 0;
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1;
    if (tokens[i] === 'sudo' || tokens[i] === 'doas') {
      escalate(result, 'caution', 'runs with elevated privileges (sudo)');
      i += 1;
    }
    const program = tokens[i]?.split('/').pop();
    if (!program) continue;
    result.programs.push(program);
    const args = tokens.slice(i + 1);
    const flags = args.filter((t) => /^-{1,2}[A-Za-z]/.test(t)).map(stripQuotes);
    result.flags.push(...flags);

    if (DESTRUCTIVE.has(program)) {
      escalate(result, 'destructive', `\`${program}\` deletes or destroys data`);
    } else if (program === 'git') {
      const sub = args.find((a) => !a.startsWith('-'));
      if (sub === 'reset' && flags.includes('--hard')) escalate(result, 'destructive', '`git reset --hard` discards work');
      else if (sub === 'clean') escalate(result, 'destructive', '`git clean` deletes untracked files');
      else if (sub === 'push' && flags.some((f) => f === '--force' || f === '-f' || f.startsWith('--force-with-lease'))) {
        escalate(result, 'destructive', '`git push --force` rewrites remote history');
      } else if (sub && GIT_READ.has(sub)) {
        /* read-only */
      } else escalate(result, 'caution', `\`git${sub ? ` ${sub}` : ''}\` changes the repository or remote`);
    } else if (program === 'find') {
      if (flags.includes('-delete') || /-exec\s+rm\b/.test(segment)) escalate(result, 'destructive', '`find -delete` / `-exec rm` deletes matches');
    } else if (program === 'sed') {
      if (flags.some((f) => f.startsWith('-i'))) escalate(result, 'caution', '`sed -i` edits files in place');
    } else if (program === 'curl' || program === 'wget') {
      const method = args[args.findIndex((a) => a === '-X' || a === '--request') + 1];
      if (method && /^(DELETE)$/i.test(stripQuotes(method))) escalate(result, 'destructive', 'HTTP DELETE request');
      else escalate(result, 'caution', `\`${program}\` makes a network request`);
    } else if (CAUTION.has(program)) {
      escalate(result, 'caution', `\`${program}\` writes files, the network or a service`);
    } else if (!SAFE.has(program)) {
      escalate(result, 'caution', `\`${program}\` is not a known command — review it`);
    }

    for (const flag of flags) {
      if (DESTRUCTIVE_FLAGS.has(flag) && program !== 'grep' && program !== 'tail' && program !== 'curl') {
        escalate(result, 'destructive', `flag \`${flag}\` forces or deletes`);
      }
      if (/^-[a-zA-Z]*r[a-zA-Z]*f|^-[a-zA-Z]*f[a-zA-Z]*r/.test(flag) && program === 'rm') {
        escalate(result, 'destructive', '`rm -rf` recursive force delete');
      }
    }
  }

  if (result.level === 'safe') result.reasons.push('read-only');
  result.flags = [...new Set(result.flags)];
  return result;
}

export function worstLevel(levels: SafetyLevel[]): SafetyLevel {
  return levels.reduce<SafetyLevel>((worst, l) => (RANK[l] > RANK[worst] ? l : worst), 'safe');
}
