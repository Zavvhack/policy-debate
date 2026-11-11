// The app's data, live.
//
// Screens read from the signals in here and re-draw themselves when the data
// changes. Every change is written to the database straight away (autosave);
// there is no Save button anywhere in the app.
//
//   db.cards.list.value        -> all cards (re-draws when cards change)
//   db.cards.put(card)         -> save a card
//   db.cards.remove(id)        -> delete (goes to the trash, can be undone)
//   settings.value             -> current settings
//   updateSettings({...})      -> change settings

import { signal, type Signal } from '@preact/signals';
import { newId, now, isoStamp } from '../core/ids';
import { defaultSettings, defaultTopic, mergeSettings } from '../core/debate/topics';
import { presetTemplates } from '../core/blocks/templates';
import { backupsToPrune, emptyData, makeSnapshot } from '../core/backup/backup';
import { repairDoc, repairList } from '../core/backup/repair';
import { initLock, watchOtherWindows, type LockState } from '../ai/lock';
import { platform } from '../platform';
import { openBackend, type Backend } from './db';
import {
  DATA_COLLECTIONS,
  SCHEMA_VERSION,
  type BackupDoc,
  type BaseDoc,
  type CollectionName,
  type CollectionTypes,
  type DataCollectionName,
  type LockDoc,
  type Settings,
  type Snapshot,
  type TrashDoc,
} from './schema';

// ---------------------------------------------------------------------------
// Save status (shown in the corner of the app so a failed save is never silent)
// ---------------------------------------------------------------------------

export interface SaveState {
  /** Writes waiting or in progress. */
  pending: number;
  /** The last error, or null. Stays until the next successful write. */
  error: string | null;
  lastSavedAt: number;
}

export const saveState = signal<SaveState>({ pending: 0, error: null, lastSavedAt: 0 });
/** 'memory' means the browser is NOT letting us save; the UI shows a warning. */
export const storageKind = signal<'indexeddb' | 'memory'>('indexeddb');
/** False until the database has been loaded. */
export const storeReady = signal(false);
/** True if the app is already open in another window or tab; this copy then loads nothing. */
export const otherWindowOpen = signal(false);
/**
 * Browser version: has the browser promised not to clear our files on its own?
 * 'unknown' until asked; 'no' means it may clear them if the disk gets full.
 */
export const storagePersisted = signal<'unknown' | 'yes' | 'no'>('unknown');

/** Ask the browser to treat our files as permanent. Safe to call anywhere; never throws. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    const sm = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!sm?.persist) return;
    const already = (await sm.persisted?.()) === true;
    storagePersisted.value = already || (await sm.persist()) ? 'yes' : 'no';
  } catch {
    /* not supported here */
  }
}

let backend: Backend | null = null;
let stopWatchingLock: () => void = () => {};
/** Counts changes, so the automatic backup knows whether anything is new. */
let changeCount = 0;
let backedUpAt = 0;
let lastSnapshotBytes = 0;
/** Size of the most recent snapshot. A large one takes a moment to make, so it is not made mid-round. */
export function lastBackupBytes(): number {
  return lastSnapshotBytes;
}

function be(): Backend {
  if (!backend) throw new Error('The database is not open yet.');
  return backend;
}

// --- write queue -----------------------------------------------------------

interface QueuedWrite {
  timer: ReturnType<typeof setTimeout> | null;
  run: () => Promise<void>;
  /** When the first not-yet-written change was made. */
  firstAt: number;
  /** What is waiting to be written, for the crash journal. Null for deletes and other one-off jobs. */
  pending: (() => { store: CollectionName; doc: { id: string } } | null) | null;
}
const queue = new Map<string, QueuedWrite>();
const inFlight = new Set<Promise<void>>();

/**
 * However fast you type, a change is on disk at most this long after it was
 * made. (Without this cap, non-stop typing would keep postponing the save.)
 */
const MAX_WAIT_MS = 800;

function bumpPending(delta: number): void {
  saveState.value = { ...saveState.value, pending: Math.max(0, saveState.value.pending + delta) };
}

let writeSeq = 0;
/** The number of the most recent write that failed (0 = none has). */
let failedSeq = 0;

type PendingDoc = NonNullable<QueuedWrite['pending']>;
/**
 * Every change that has been made but is not yet CONFIRMED on disk: waiting
 * for its timer, or handed to the database but not yet acknowledged. This is
 * what the crash journal saves, so a write that was cut off half-way by the
 * window closing is not lost either.
 */
const unsettled = new Map<string, PendingDoc>();

function runWrite(run: () => Promise<void>, key?: string, pending?: PendingDoc | null): Promise<void> {
  const seq = ++writeSeq;
  const p = run()
    .then(() => {
      // Only a write that started AFTER the last failure may clear the error:
      // an older, slower write finishing late must not hide a newer failure.
      const error = seq > failedSeq ? null : saveState.value.error;
      saveState.value = { ...saveState.value, error, lastSavedAt: now() };
      // Confirmed on disk. Forget it, unless a newer change to the same document is already waiting.
      if (key && pending && unsettled.get(key) === pending) unsettled.delete(key);
    })
    .catch((err: unknown) => {
      console.error('Save failed', err);
      failedSeq = Math.max(failedSeq, seq);
      const msg = err instanceof Error ? err.message : String(err);
      saveState.value = { ...saveState.value, error: `Could not save: ${msg}` };
    })
    .finally(() => {
      inFlight.delete(p);
      bumpPending(-1);
    });
  inFlight.add(p);
  return p;
}

/**
 * Schedule a write. Writes with the same key replace each other, so typing
 * quickly produces one save, not fifty.
 */
function scheduleWrite(key: string, run: () => Promise<void>, delayMs: number, pending: QueuedWrite['pending'] = null): void {
  changeCount++;
  const existing = queue.get(key);
  const firstAt = existing?.firstAt ?? now();
  if (existing) {
    if (existing.timer) clearTimeout(existing.timer);
  } else {
    bumpPending(1);
  }
  if (pending) unsettled.set(key, pending);
  else unsettled.delete(key); // a delete or other one-off job replaces any waiting document
  const fire = () => {
    queue.delete(key);
    void runWrite(run, key, pending);
  };
  const wait = Math.min(delayMs, MAX_WAIT_MS - (now() - firstAt));
  if (wait <= 0) {
    queue.set(key, { timer: null, run, firstAt, pending });
    fire();
  } else {
    queue.set(key, { timer: setTimeout(fire, wait), run, firstAt, pending });
  }
}

// --- crash journal ---------------------------------------------------------
//
// When the window is closing, the browser may not let a database write finish.
// localStorage, unlike the database, is written synchronously, so anything
// still waiting is copied there first and replayed the next time the app opens.

const JOURNAL_KEY = 'policy-debate.journal';

interface JournalEntry {
  store: CollectionName;
  doc: { id: string; updatedAt?: number };
}

/** Copy every change that has not reached the database yet into localStorage. Call when the window is going away. */
export function journalPendingWrites(): void {
  // Before the files have loaded there is nothing new to record, and the journal
  // left by the LAST session may not have been replayed yet: leave it alone.
  if (!storeReady.value) return;
  const entries: JournalEntry[] = [];
  for (const pending of unsettled.values()) {
    const item = pending();
    if (item) entries.push(item);
  }
  try {
    if (entries.length) localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries));
    else localStorage.removeItem(JOURNAL_KEY);
  } catch {
    // Too big for localStorage, or storage is blocked: the normal database write is still attempted.
  }
}

/** Apply a journal left by the last session, keeping whichever copy of each document is newer. */
async function replayJournal(store: Backend): Promise<void> {
  let entries: JournalEntry[] = [];
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) entries = parsed as JournalEntry[];
  } catch {
    entries = [];
  }
  for (const e of entries) {
    if (!e || typeof e !== 'object' || !e.doc || typeof e.doc.id !== 'string') continue;
    if (e.store !== 'meta' && !(DATA_COLLECTIONS as readonly string[]).includes(e.store)) continue;
    // The lock is never restored from the journal: it has its own, stricter storage.
    if (e.store === 'meta' && e.doc.id !== 'settings') continue;
    const saved = await store.get<{ updatedAt?: number }>(e.store, e.doc.id);
    if (!saved || (e.doc.updatedAt ?? 0) >= (saved.updatedAt ?? 0)) await store.put(e.store, e.doc);
  }
  try {
    localStorage.removeItem(JOURNAL_KEY);
  } catch {
    /* ignore */
  }
}

/** Write everything that is waiting, now, and wait for it to finish. */
export async function flushWrites(): Promise<void> {
  for (const [key, w] of [...queue]) {
    if (w.timer) clearTimeout(w.timer);
    queue.delete(key);
    void runWrite(w.run, key, w.pending);
  }
  // Wait for the database to confirm, but never forever: a write that hangs
  // must not freeze "End round" or a backup. (It stays in the crash journal.)
  const deadline = now() + 4000;
  while (inFlight.size && now() < deadline) {
    await Promise.race([Promise.allSettled([...inFlight]), new Promise((resolve) => setTimeout(resolve, Math.max(1, deadline - now())))]);
  }
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export class Collection<T extends BaseDoc> {
  /** All documents. Reading `.value` inside a component subscribes it to changes. */
  readonly list: Signal<T[]> = signal<T[]>([]);
  private map = new Map<string, T>();

  constructor(readonly name: DataCollectionName) {}

  /** Replace everything in memory (used at start-up and after a restore). */
  hydrate(docs: T[]): void {
    this.map = new Map(docs.map((d) => [d.id, d]));
    this.list.value = docs;
  }

  get(id: string | null | undefined): T | undefined {
    return id ? this.map.get(id) : undefined;
  }

  /**
   * Save a document (new or changed). Returns the saved copy.
   * @param delayMs wait this long for further changes before writing (use for typing)
   */
  put(doc: T, delayMs = 0): T {
    const saved: T = { ...doc, updatedAt: now(), createdAt: doc.createdAt || now() };
    const existed = this.map.has(saved.id);
    this.map.set(saved.id, saved);
    this.list.value = existed ? this.list.value.map((d) => (d.id === saved.id ? saved : d)) : [...this.list.value, saved];
    const name = this.name;
    // The write reads the latest copy from memory, so a delayed write never saves stale data.
    scheduleWrite(
      `${name}:${saved.id}`,
      async () => {
        const latest = this.map.get(saved.id);
        if (latest) await be().put(name, latest);
      },
      delayMs,
      () => {
        const latest = this.map.get(saved.id);
        return latest ? { store: name, doc: latest } : null;
      },
    );
    return saved;
  }

  /** Delete a document. It is kept in the trash so it can be restored. */
  remove(id: string, label: string): void {
    const doc = this.map.get(id);
    if (!doc) return;
    this.map.delete(id);
    this.list.value = this.list.value.filter((d) => d.id !== id);
    const name = this.name;
    const entry: TrashDoc = { id: newId(), collection: name, deletedAt: now(), label, doc };
    trash.value = [entry, ...trash.value];
    // Cancel any write still waiting for this document, then delete it.
    scheduleWrite(`${name}:${id}`, async () => {
      await be().put('trash', entry);
      await be().delete(name, id);
    }, 0);
  }
}

export const db = {
  topics: new Collection<CollectionTypes['topics']>('topics'),
  cards: new Collection<CollectionTypes['cards']>('cards'),
  sources: new Collection<CollectionTypes['sources']>('sources'),
  blocks: new Collection<CollectionTypes['blocks']>('blocks'),
  templates: new Collection<CollectionTypes['templates']>('templates'),
  tfiles: new Collection<CollectionTypes['tfiles']>('tfiles'),
  rounds: new Collection<CollectionTypes['rounds']>('rounds'),
  scouting: new Collection<CollectionTypes['scouting']>('scouting'),
  drills: new Collection<CollectionTypes['drills']>('drills'),
} satisfies { [K in DataCollectionName]: Collection<CollectionTypes[K]> };

function collection(name: DataCollectionName): Collection<BaseDoc> {
  return db[name] as unknown as Collection<BaseDoc>;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const settings = signal<Settings>(defaultSettings());

export function updateSettings(patch: Partial<Settings> | ((s: Settings) => Settings)): void {
  const next = typeof patch === 'function' ? patch(settings.value) : { ...settings.value, ...patch };
  settings.value = { ...next, id: 'settings' };
  scheduleWrite('meta:settings', () => be().put('meta', settings.value), 150, () => ({ store: 'meta', doc: settings.value }));
}

/** The topic everything is currently about. */
export function activeTopic(): CollectionTypes['topics'] | undefined {
  return db.topics.get(settings.value.activeTopicId) ?? db.topics.list.value[0];
}

// ---------------------------------------------------------------------------
// Trash (undo for deletes)
// ---------------------------------------------------------------------------

export const trash = signal<TrashDoc[]>([]);
const TRASH_DAYS = 30;

export function restoreFromTrash(trashId: string): boolean {
  const entry = trash.value.find((t) => t.id === trashId);
  if (!entry || !(DATA_COLLECTIONS as readonly string[]).includes(entry.collection)) return false;
  const doc = repairDoc(entry.collection as DataCollectionName, entry.doc);
  if (!doc) return false;
  collection(entry.collection as DataCollectionName).put(doc);
  trash.value = trash.value.filter((t) => t.id !== trashId);
  scheduleWrite(`trash:${trashId}`, () => be().delete('trash', trashId), 0);
  return true;
}

export function emptyTrash(): void {
  for (const t of trash.value) scheduleWrite(`trash:${t.id}`, () => be().delete('trash', t.id), 0);
  trash.value = [];
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

/**
 * Open the database and load everything into memory.
 * @param useBackend tests pass their own; the app lets it open IndexedDB.
 */
export async function initStore(useBackend?: Backend): Promise<void> {
  storeReady.value = false;
  for (const w of queue.values()) if (w.timer) clearTimeout(w.timer);
  queue.clear();
  unsettled.clear();
  inFlight.clear();
  saveState.value = { pending: 0, error: null, lastSavedAt: 0 };
  failedSeq = writeSeq;
  backend = useBackend ?? (await openBackend());
  storageKind.value = backend.kind;

  // Which version of the data format is this? A NEWER one means these files were
  // last used by a newer version of the app; an older app writing into them could
  // damage them, so stop here without touching anything.
  const format = await backend.get<{ id: string; version: number }>('meta', 'format');
  if (format && typeof format.version === 'number' && format.version > SCHEMA_VERSION) {
    throw new Error(
      'these files were last saved by a newer version of Policy Debate. Update the app to open them. Nothing has been changed.',
    );
  }
  if (!format || format.version !== SCHEMA_VERSION) await backend.put('meta', { id: 'format', version: SCHEMA_VERSION });

  // Anything the last session did not manage to write before it closed.
  await replayJournal(backend);

  for (const name of DATA_COLLECTIONS) {
    // Anything saved by an older version, or damaged, is filled in before a screen sees it.
    const { docs, dropped } = repairList(name, await backend.getAll<BaseDoc>(name));
    if (dropped) console.warn(`${dropped} unreadable item(s) in "${name}" were left out. They are still in the database and in older backups.`);
    collection(name).hydrate(docs);
  }

  // Settings.
  const savedSettings = await backend.get<Settings>('meta', 'settings');
  settings.value = mergeSettings(savedSettings);

  // First run: add the built-in topic.
  if (!db.topics.list.value.length) db.topics.put(defaultTopic(now()));
  if (!db.topics.get(settings.value.activeTopicId)) {
    updateSettings({ activeTopicId: db.topics.list.value[0].id });
  }

  // First run: add the preset fill-in-the-blank templates. A marker records that
  // this was done, so presets you delete do not come back.
  const seeded = (await backend.get<{ id: string; done: string[] }>('meta', 'seeded'))?.done ?? [];
  if (!seeded.includes('templates-1')) {
    for (const t of presetTemplates(now())) if (!db.templates.get(t.id)) db.templates.put(t);
    await backend.put('meta', { id: 'seeded', done: [...seeded, 'templates-1'] });
  }

  // Trash: drop anything older than 30 days.
  const allTrash = await backend.getAll<TrashDoc>('trash');
  const cutoff = now() - TRASH_DAYS * 24 * 3600 * 1000;
  trash.value = allTrash.filter((t) => t.deletedAt >= cutoff).sort((a, b) => b.deletedAt - a.deletedAt);
  for (const old of allTrash.filter((t) => t.deletedAt < cutoff)) void backend.delete('trash', old.id);

  // The Round Mode lock. If the saved round says it is still active, stay locked.
  const savedLock = await backend.get<LockDoc>('meta', 'roundLock');
  const state = initLock(savedLock, async (s: LockState) => {
    await be().put<LockDoc>('meta', { id: 'roundLock', ...s });
    await platform.setRoundActive(s.active).catch((e) => console.warn('Could not notify the desktop shell', e));
  });
  // If the app is open in a second window, follow a round started or ended there.
  stopWatchingLock();
  stopWatchingLock = watchOtherWindows(() => be().get<LockDoc>('meta', 'roundLock'));
  // Keep the desktop shell's copy of the lock in step with ours at start-up.
  await platform.setRoundActive(state.active).catch(() => {});

  changeCount = 0;
  backedUpAt = 0;
  storeReady.value = true;
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

/** Everything, as one object. */
export function currentSnapshot(): Snapshot {
  const data = emptyData() as unknown as Record<DataCollectionName, BaseDoc[]>;
  for (const name of DATA_COLLECTIONS) data[name] = collection(name).list.value;
  return makeSnapshot(data as unknown as Snapshot['data'], settings.value, now(), __APP_VERSION__);
}

export const backups = signal<Omit<BackupDoc, 'json'>[]>([]);

export async function loadBackupList(): Promise<void> {
  const all = await be().getAll<BackupDoc>('backups');
  backups.value = all.map(({ json: _json, ...meta }) => meta).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Take an automatic snapshot (kept inside the app, and on disk in the desktop
 * app). Skipped if nothing changed since the last one, unless `force`.
 */
export async function takeBackup(reason: string, force = false): Promise<boolean> {
  if (!storeReady.value || !backend) return false;
  if (!force && changeCount === backedUpAt) return false;
  const store = backend;
  try {
    await flushWrites();
    const json = JSON.stringify(currentSnapshot());
    const doc: BackupDoc = { id: newId(), createdAt: now(), reason, json, bytes: json.length };
    await store.put('backups', doc);
    backedUpAt = changeCount;
    lastSnapshotBytes = json.length;
    const all = await store.getAll<BackupDoc>('backups');
    for (const id of backupsToPrune(all)) await store.delete('backups', id);
    if (backend === store) backups.value = all.map(({ json: _json, ...meta }) => meta).sort((a, b) => b.createdAt - a.createdAt);
    if (platform.can.diskBackups) {
      await platform.writeDiskBackup(`policy-debate-backup_${isoStamp(doc.createdAt)}.json`, json);
    }
    return true;
  } catch (err) {
    // A failed backup must never interrupt the debater; it is reported and retried next time.
    console.warn('Backup failed', err);
    return false;
  }
}

export async function readBackup(id: string): Promise<string | null> {
  const doc = await be().get<BackupDoc>('backups', id);
  return doc?.json ?? null;
}

/**
 * Replace everything with the contents of a snapshot. A safety backup of the
 * current data is taken first, and the Round Mode lock is left exactly as it is.
 */
export async function restoreSnapshot(snapshot: Snapshot): Promise<void> {
  await takeBackup('Before restoring a backup', true);
  await flushWrites();
  const contents: Partial<Record<CollectionName, { id: string }[]>> = {};
  const clean = {} as Record<DataCollectionName, BaseDoc[]>;
  for (const name of DATA_COLLECTIONS) clean[name] = repairList(name, snapshot.data[name] ?? []).docs;
  for (const name of DATA_COLLECTIONS) contents[name] = clean[name];
  await be().replaceAll(contents);
  for (const name of DATA_COLLECTIONS) collection(name).hydrate(clean[name]);
  if (snapshot.settings) {
    settings.value = mergeSettings(snapshot.settings);
    await be().put('meta', settings.value);
  }
  if (!db.topics.list.value.length) db.topics.put(defaultTopic(now()));
  if (!db.topics.get(settings.value.activeTopicId)) updateSettings({ activeTopicId: db.topics.list.value[0].id });
  await flushWrites();
}

/** Tests only. */
export function closeStoreForTests(): void {
  stopWatchingLock();
  stopWatchingLock = () => {};
  backend?.close();
  backend = null;
  storeReady.value = false;
}
