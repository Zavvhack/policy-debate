// The browser version (the single .html file).

import type { Platform } from './index';

const KEY_NAME = 'policy-debate.apiKey';

function unsupported(what: string): never {
  throw new Error(`${what} is only available in the desktop app.`);
}

/** Read from sessionStorage first (this tab only), then localStorage (remembered). */
function readKey(): string | null {
  try {
    return sessionStorage.getItem(KEY_NAME) ?? localStorage.getItem(KEY_NAME);
  } catch {
    return null;
  }
}

export const browserPlatform: Platform = {
  kind: 'browser',
  can: { fetchUrl: false, keychain: false, diskBackups: false },

  async saveFile(name, data) {
    // The classic way to save a file from a web page: a temporary download link.
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  },

  async fetchUrl() {
    return unsupported('Fetching an article from a URL');
  },

  async hasApiKey() {
    return !!readKey();
  },
  async readApiKey() {
    return readKey();
  },
  async setApiKey(key, remember) {
    try {
      sessionStorage.removeItem(KEY_NAME);
      localStorage.removeItem(KEY_NAME);
      (remember ? localStorage : sessionStorage).setItem(KEY_NAME, key);
    } catch {
      throw new Error('This browser is blocking storage, so the key could not be saved.');
    }
  },
  async clearApiKey() {
    try {
      sessionStorage.removeItem(KEY_NAME);
      localStorage.removeItem(KEY_NAME);
    } catch {
      /* nothing stored */
    }
  },
  keyStorageNote:
    'Browser version: your key is kept only in this browser on this computer. By default it is held for this tab and forgotten when you close it. ' +
    'If you tick "Remember", it is saved in this browser\'s local storage as plain text: anyone who can use this browser profile could read it, ' +
    'so do not tick it on a shared or school computer. The key is sent only to api.anthropic.com. The desktop app stores it in the system keychain instead.',

  aiFetch: null,
  async setRoundActive() {
    // Nothing outside the page to tell. The lock in src/ai/lock.ts does the work.
  },
  async writeDiskBackup() {
    return unsupported('Writing backups to disk');
  },
  async backupFolder() {
    return '';
  },
  async claimInstance() {
    // Web Locks: the browser gives the lock to one tab and frees it when that tab closes.
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks?.request) return true; // an old browser: cannot tell, so carry on
    const tryOnce = () =>
      new Promise<boolean>((resolve) => {
        locks
          .request('policy-debate.one-window', { ifAvailable: true }, (lock) => {
            if (!lock) return resolve(false);
            resolve(true);
            return new Promise<never>(() => {}); // keep the lock for as long as this tab lives
          })
          .catch(() => resolve(true));
      });
    // A reload can arrive a moment before the old page has let go, so try a few times.
    for (let i = 0; i < 6; i++) {
      if (await tryOnce()) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  },
  openExternal(url) {
    if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
  },
};
