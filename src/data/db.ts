// The lowest storage layer: a thin wrapper around IndexedDB.
//
// IndexedDB is the database built into every browser (and into the desktop
// app's window). It survives closing the app and holds far more than
// localStorage. Each collection (cards, rounds, ...) is one "object store",
// and every document is saved under its `id`.
//
// If IndexedDB is not available (some private-browsing modes), we fall back to
// keeping everything in memory and tell the user loudly, rather than
// pretending to save.

import { ALL_COLLECTIONS, type CollectionName } from './schema';

const DB_NAME = 'policy-debate';
const DB_VERSION = 1;

export interface Backend {
  /** 'indexeddb' = really saved. 'memory' = lost when the page closes. */
  readonly kind: 'indexeddb' | 'memory';
  getAll<T>(store: CollectionName): Promise<T[]>;
  get<T>(store: CollectionName, id: string): Promise<T | undefined>;
  put<T extends { id: string }>(store: CollectionName, doc: T): Promise<void>;
  delete(store: CollectionName, id: string): Promise<void>;
  /** Replace the entire contents of several stores in one all-or-nothing step. */
  replaceAll(contents: Partial<Record<CollectionName, { id: string }[]>>): Promise<void>;
  close(): void;
}

/** Turn an IndexedDB request into a Promise. */
function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Database request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Database write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Database write was cancelled'));
  });
}

class IndexedDbBackend implements Backend {
  readonly kind = 'indexeddb' as const;
  constructor(private db: IDBDatabase) {}

  getAll<T>(store: CollectionName): Promise<T[]> {
    return done(this.db.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<T[]>);
  }

  get<T>(store: CollectionName, id: string): Promise<T | undefined> {
    return done(this.db.transaction(store, 'readonly').objectStore(store).get(id) as IDBRequest<T | undefined>);
  }

  async put<T extends { id: string }>(store: CollectionName, doc: T): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(doc);
    await txDone(tx);
  }

  async delete(store: CollectionName, id: string): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    await txDone(tx);
  }

  async replaceAll(contents: Partial<Record<CollectionName, { id: string }[]>>): Promise<void> {
    const names = Object.keys(contents) as CollectionName[];
    if (!names.length) return;
    // One transaction: either every store is replaced, or (on any error) none is.
    const tx = this.db.transaction(names, 'readwrite');
    for (const name of names) {
      const os = tx.objectStore(name);
      os.clear();
      for (const doc of contents[name] ?? []) os.put(doc);
    }
    await txDone(tx);
  }

  close(): void {
    this.db.close();
  }
}

/** Used only when IndexedDB is unavailable, and in some tests. */
export class MemoryBackend implements Backend {
  readonly kind = 'memory' as const;
  private stores = new Map<CollectionName, Map<string, unknown>>();

  private store(name: CollectionName): Map<string, unknown> {
    let s = this.stores.get(name);
    if (!s) this.stores.set(name, (s = new Map()));
    return s;
  }

  async getAll<T>(store: CollectionName): Promise<T[]> {
    return structuredClone([...this.store(store).values()]) as T[];
  }
  async get<T>(store: CollectionName, id: string): Promise<T | undefined> {
    const v = this.store(store).get(id);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async put<T extends { id: string }>(store: CollectionName, doc: T): Promise<void> {
    this.store(store).set(doc.id, structuredClone(doc));
  }
  async delete(store: CollectionName, id: string): Promise<void> {
    this.store(store).delete(id);
  }
  async replaceAll(contents: Partial<Record<CollectionName, { id: string }[]>>): Promise<void> {
    for (const [name, docs] of Object.entries(contents) as [CollectionName, { id: string }[]][]) {
      const s = this.store(name);
      s.clear();
      for (const d of docs) s.set(d.id, structuredClone(d));
    }
  }
  close(): void {}
}

/** Open the database, creating the object stores the first time. */
export async function openBackend(name = DB_NAME): Promise<Backend> {
  if (typeof indexedDB === 'undefined') return new MemoryBackend();
  try {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of ALL_COLLECTIONS) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
      }
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open the database'));
      req.onblocked = () => reject(new Error('The database is open in another window. Close other Policy Debate windows and reload.'));
    });
    // If another tab upgrades the database, let go of it so we do not block that tab.
    db.onversionchange = () => db.close();
    return new IndexedDbBackend(db);
  } catch (err) {
    console.warn('IndexedDB is not available; using memory only.', err);
    return new MemoryBackend();
  }
}
