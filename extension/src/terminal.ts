/**
 * Web-terminal prompt injection.
 *
 * xterm.js (VS Code Web, Cloud Shell, Gitpod, JupyterLab, ttyd …) takes keyboard and paste input through a
 * hidden `.xterm-helper-textarea`. Dispatching a paste event there goes through xterm's own paste path,
 * which honours bracketed-paste mode. The command is inserted WITHOUT a newline: the human presses Enter.
 */

export type TerminalTarget =
  | { kind: 'xterm'; element: HTMLTextAreaElement; label: string }
  | { kind: 'field'; element: HTMLTextAreaElement | HTMLInputElement; label: string };

function visible(el: Element | null): boolean {
  return Boolean(el && el.getClientRects().length > 0);
}

function describe(): string {
  const host = location.hostname;
  if (/vscode\.dev|github\.dev|codespaces/.test(host)) return 'VS Code terminal';
  if (/shell\.cloud\.google\.com|console\.cloud\.google\.com/.test(host)) return 'Cloud Shell';
  return 'web terminal';
}

/** Prefer the terminal that had focus before the overlay opened; else the first visible xterm on the page. */
export function findTerminal(previouslyFocused: Element | null): TerminalTarget | null {
  if (previouslyFocused instanceof HTMLTextAreaElement && previouslyFocused.classList.contains('xterm-helper-textarea')) {
    return { kind: 'xterm', element: previouslyFocused, label: describe() };
  }
  const xterm = [...document.querySelectorAll<HTMLTextAreaElement>('.xterm-helper-textarea')].find((t) =>
    visible(t.closest('.xterm')),
  );
  if (xterm) return { kind: 'xterm', element: xterm, label: describe() };
  if (
    (previouslyFocused instanceof HTMLTextAreaElement ||
      (previouslyFocused instanceof HTMLInputElement && /^(text|search|)$/.test(previouslyFocused.type))) &&
    visible(previouslyFocused) &&
    !previouslyFocused.readOnly
  ) {
    return { kind: 'field', element: previouslyFocused, label: 'focused input' };
  }
  return null;
}

export function injectCommand(target: TerminalTarget, command: string): void {
  const text = command.replace(/[\r\n]+/g, ' ');
  const el = target.element;
  el.focus();
  if (target.kind === 'xterm') {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    return;
  }
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.setRangeText(text, start, end, 'end');
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
}
