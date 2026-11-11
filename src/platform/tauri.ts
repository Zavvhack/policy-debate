// The desktop version (Tauri).
//
// The Rust side (src-tauri/) exposes a handful of commands. We call them with
// `invoke`, which Tauri injects into the window. Nothing here is imported from
// the @tauri-apps packages, so the same bundle also runs in a plain browser.

import type { FetchedPage, Platform } from './index';

interface TauriInternals {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

function internals(): TauriInternals | null {
  const w = globalThis as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  return w.__TAURI_INTERNALS__ ?? null;
}

/** Are we running inside the desktop app? */
export function isTauri(): boolean {
  return internals() !== null;
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = internals();
  if (!t) return Promise.reject(new Error('Not running in the desktop app.'));
  return t.invoke<T>(cmd, args).catch((e: unknown) => {
    // Rust errors arrive as strings; turn them into real Errors.
    throw e instanceof Error ? e : new Error(String(e));
  });
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

interface AiResponse {
  status: number;
  headers: [string, string][];
  body: string;
}

/**
 * A stand-in for `fetch` used only for AI requests. The request body goes to
 * Rust, which adds the API key from the keychain and refuses outright while a
 * round is active. The key never enters this window.
 */
const aiFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => {
    headers[k] = v;
  });
  const body = typeof init?.body === 'string' ? init.body : init?.body ? await new Response(init.body).text() : '';
  const res = await invoke<AiResponse>('ai_request', { url, method: init?.method ?? 'POST', headers, body });
  return new Response(res.body, { status: res.status, headers: res.headers });
};

export const tauriPlatform: Platform = {
  kind: 'desktop',
  can: { fetchUrl: true, keychain: true, diskBackups: true },

  async saveFile(name, data) {
    const bytes = new Uint8Array(await data.arrayBuffer());
    return invoke<boolean>('save_file', { name, dataBase64: toBase64(bytes) });
  },

  async fetchUrl(url): Promise<FetchedPage> {
    const r = await invoke<{ url: string; status: number; content_type: string; body_base64: string }>('fetch_url', { url });
    return { url: r.url, status: r.status, contentType: r.content_type, bytes: fromBase64(r.body_base64) };
  },

  hasApiKey: () => invoke<boolean>('has_api_key'),
  async readApiKey() {
    return null; // by design: the key stays on the Rust side
  },
  setApiKey: (key) => invoke<void>('set_api_key', { key }),
  clearApiKey: () => invoke<void>('clear_api_key'),
  keyStorageNote:
    'Desktop app: your key is stored in the operating system keychain (Secret Service / KWallet on Linux, Credential Manager on Windows, Keychain on macOS), ' +
    'not in a file. It never enters the app window: requests go through the app\'s Rust core, which adds the key and sends it only to api.anthropic.com.',

  aiFetch,
  setRoundActive: (active) => invoke<void>('set_round_active', { active }),
  writeDiskBackup: (name, json) => invoke<void>('write_backup', { name, json }),
  backupFolder: () => invoke<string>('backup_folder'),
  // The Rust side holds a lock file for as long as the app runs.
  claimInstance: () => invoke<boolean>('claim_instance').catch(() => true),
  openExternal(url) {
    if (/^https?:\/\//i.test(url)) void invoke<void>('open_external', { url }).catch((e) => console.warn('Could not open the link', e));
  },
};
