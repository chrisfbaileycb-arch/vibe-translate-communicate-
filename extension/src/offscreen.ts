/** Offscreen document: the extension's own focused-enough context for a clipboard write. */
chrome.runtime.onMessage.addListener((message: { target?: string; type?: string; text?: string }, _sender, sendResponse) => {
  if (message?.target !== 'offscreen' || message.type !== 'lc.offscreen.copy') return;
  const buffer = document.getElementById('buffer') as HTMLTextAreaElement;
  buffer.value = message.text ?? '';
  buffer.select();
  const ok = document.execCommand('copy');
  buffer.value = '';
  sendResponse(ok ? { ok: true, data: null } : { ok: false, error: 'Clipboard write was refused.' });
});
