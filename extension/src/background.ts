import { translateShell } from '../../src/lib/shell.ts';
import type { VaultSecret } from '../../src/lib/vault.ts';
import {
  loadSettings,
  SECRET_KEY,
  WHISPER_URL,
  type OverlayRequest,
  type OverlayStatus,
  type Reply,
} from './shared.ts';

/**
 * Background service worker.
 *  - Shortcut / toolbar click -> inject the overlay into the active tab (activeTab, no blanket host access).
 *  - All network calls (LLM + Whisper) happen here, so the key never enters a page context.
 */

void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

async function toggleOverlay(tab?: chrome.Tab): Promise<void> {
  const target = tab?.id !== undefined ? tab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (target?.id === undefined) return;
  try {
    // overlay.js toggles itself if it is already installed in the page.
    await chrome.scripting.executeScript({ target: { tabId: target.id }, files: ['overlay.js'] });
    await chrome.action.setBadgeText({ text: '', tabId: target.id });
  } catch {
    // chrome://, the Web Store and the PDF viewer refuse content scripts — fall back to the options page console.
    await chrome.action.setBadgeBackgroundColor({ color: '#f59e0b', tabId: target.id });
    await chrome.action.setBadgeText({ text: '!', tabId: target.id });
    await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#try') });
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-voice' || command === 'toggle-voice-alt') void toggleOverlay(tab);
});
chrome.action.onClicked.addListener((tab) => void toggleOverlay(tab));

async function loadSecret(): Promise<VaultSecret | null> {
  const stored = await chrome.storage.session.get(SECRET_KEY);
  return (stored[SECRET_KEY] as VaultSecret | undefined) ?? null;
}

async function shortcutLabel(): Promise<string> {
  const commands = await chrome.commands.getAll();
  return commands.find((c) => c.name === 'toggle-voice')?.shortcut || 'Alt+S';
}

async function transcribe(audioBase64: string, mime: string): Promise<string> {
  const secret = await loadSecret();
  if (!secret?.apiKey.startsWith('hf_')) {
    throw new Error('Whisper needs a Hugging Face token (hf_…). Add one in the extension options, or switch to browser speech.');
  }
  const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  const response = await fetch(WHISPER_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret.apiKey}`, 'content-type': mime },
    body: bytes,
  });
  if (!response.ok) throw new Error(`Whisper returned ${response.status}`);
  const data = (await response.json()) as { text?: string };
  return (data.text ?? '').trim();
}

let offscreenReady: Promise<void> | null = null;

/** Last-resort clipboard write when the page refused navigator.clipboard (unfocused document, permissions policy). */
async function copyViaOffscreen(text: string): Promise<void> {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length === 0) {
    offscreenReady ??= chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: 'Copy the translated shell command to the clipboard.',
    });
    await offscreenReady;
    offscreenReady = null;
  }
  const reply = await chrome.runtime.sendMessage<Reply<null>>({ target: 'offscreen', type: 'lc.offscreen.copy', text });
  if (!reply?.ok) throw new Error(reply && !reply.ok ? reply.error : 'Clipboard unavailable.');
}

async function handle(message: OverlayRequest): Promise<unknown> {
  switch (message.type) {
    case 'lc.translate': {
      const [settings, secret] = await Promise.all([loadSettings(), loadSecret()]);
      const useRemote = settings.engine === 'remote' && secret !== null;
      return translateShell(message.text, {
        id: useRemote ? 'remote' : 'local',
        apiKey: secret?.apiKey,
        endpoint: secret?.endpoint || settings.endpoint,
        model: secret?.model || settings.model,
      });
    }
    case 'lc.transcribe':
      return transcribe(message.audio, message.mime);
    case 'lc.copy':
      await copyViaOffscreen(message.text);
      return null;
    case 'lc.status': {
      const [settings, secret] = await Promise.all([loadSettings(), loadSecret()]);
      const status: OverlayStatus = {
        speech: settings.speech,
        engine: settings.engine === 'remote' && secret ? 'remote' : 'local',
        autoCopy: settings.autoCopy,
        shortcut: await shortcutLabel(),
      };
      return status;
    }
  }
}

chrome.runtime.onMessage.addListener((message: OverlayRequest & { target?: string }, _sender, sendResponse) => {
  if (message?.target === 'offscreen' || typeof message?.type !== 'string' || !message.type.startsWith('lc.')) return;
  handle(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
  return true; // async response
});
