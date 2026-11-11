// What differs between the two forms of the app.
//
//   Browser version  - the single .html file. Data lives in the browser.
//   Desktop version  - the installed app (Tauri). Adds the OS keychain, fetching
//                      articles by URL, and backups written to disk.
//
// The rest of the app only ever talks to the `platform` object below, and
// checks `platform.can.*` before offering a feature. That is what keeps the
// two versions on one codebase: features the browser cannot support are shown
// as disabled with an explanation, never broken.

import { browserPlatform } from './browser';
import { isTauri, tauriPlatform } from './tauri';

export interface FetchedPage {
  /** The address after any redirects. */
  url: string;
  status: number;
  contentType: string;
  /** Raw bytes, so PDFs survive intact. */
  bytes: Uint8Array;
}

export interface Platform {
  kind: 'browser' | 'desktop';
  can: {
    /** Fetch an article from a URL (browsers block this for security). */
    fetchUrl: boolean;
    /** Store the API key in the operating system's keychain. */
    keychain: boolean;
    /** Write automatic backups to a folder on disk. */
    diskBackups: boolean;
  };
  /** Save a file the user asked for. Resolves false if they cancelled. */
  saveFile(name: string, data: Blob): Promise<boolean>;
  fetchUrl(url: string): Promise<FetchedPage>;

  /** True if an API key is stored (without revealing it). */
  hasApiKey(): Promise<boolean>;
  /** Browser version only: the key itself, for sending to Anthropic. Desktop returns null (the key stays in Rust). */
  readApiKey(): Promise<string | null>;
  setApiKey(key: string, remember: boolean): Promise<void>;
  clearApiKey(): Promise<void>;
  /** Plain-English explanation of where the key is kept, shown in Settings. */
  keyStorageNote: string;

  /** Desktop: a `fetch` that sends AI requests through the Rust side, which adds the key. */
  aiFetch: typeof fetch | null;
  /** Tell the desktop shell that a round started or ended (it enforces the AI lock a second time). */
  setRoundActive(active: boolean): Promise<void>;
  /** Desktop: write a backup file into the app's backup folder. */
  writeDiskBackup(name: string, json: string): Promise<void>;
  /** Desktop: where backups go, for display. */
  backupFolder(): Promise<string>;
  /**
   * Make sure this is the only open copy of the app. Two copies would each hold
   * their own idea of your files and overwrite each other's saves.
   * Resolves false if another window or tab already has the app open.
   */
  claimInstance(): Promise<boolean>;
  /** Open a web link in the user's normal browser (openCaselist, Tabroom, sources). */
  openExternal(url: string): void;
}

export const platform: Platform = isTauri() ? tauriPlatform : browserPlatform;
