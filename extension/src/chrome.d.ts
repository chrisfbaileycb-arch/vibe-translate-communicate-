/**
 * Minimal typings for the slice of the Chrome extension API this extension uses
 * (keeps @types/chrome out of the app's dependencies).
 */
declare namespace chrome {
  interface Tab {
    id?: number;
    url?: string;
  }

  interface MessageSender {
    tab?: Tab;
    id?: string;
  }

  namespace runtime {
    const lastError: { message?: string } | undefined;
    const onMessage: {
      addListener(
        cb: (message: any, sender: MessageSender, sendResponse: (response?: unknown) => void) => boolean | void,
      ): void;
    };
    function sendMessage<T = unknown>(message: unknown): Promise<T>;
    function getURL(path: string): string;
    function openOptionsPage(): Promise<void>;
    function getContexts(filter: { contextTypes: string[] }): Promise<unknown[]>;
  }

  namespace commands {
    const onCommand: { addListener(cb: (command: string, tab?: Tab) => void): void };
    function getAll(): Promise<{ name?: string; shortcut?: string; description?: string }[]>;
  }

  namespace action {
    const onClicked: { addListener(cb: (tab: Tab) => void): void };
    function setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string; tabId?: number }): Promise<void>;
    function setTitle(details: { title: string; tabId?: number }): Promise<void>;
  }

  namespace tabs {
    function query(info: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
    function create(props: { url: string }): Promise<Tab>;
  }

  namespace scripting {
    function executeScript(injection: { target: { tabId: number }; files: string[] }): Promise<unknown[]>;
  }

  namespace offscreen {
    function createDocument(params: { url: string; reasons: string[]; justification: string }): Promise<void>;
  }

  namespace permissions {
    function contains(p: { origins: string[] }): Promise<boolean>;
    function request(p: { origins: string[] }): Promise<boolean>;
  }

  namespace storage {
    interface StorageArea {
      get(keys: string | string[]): Promise<Record<string, any>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    const local: StorageArea;
    const session: StorageArea & {
      setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }): Promise<void>;
    };
  }
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface Window {
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  SpeechRecognition?: new () => SpeechRecognitionLike;
  __lcOverlay?: { toggle(): void };
}
