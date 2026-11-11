// Backups: turning everything into one JSON file, and reading such a file back.
//
// A backup file is untrusted input (it might be old, hand-edited, or not a
// backup at all), so parseSnapshot() checks it carefully and never throws
// half-way through a restore.

import { repairList, repairRound } from './repair';
import { mergeSettings } from '../debate/topics';
import {
  DATA_COLLECTIONS,
  SCHEMA_VERSION,
  type BaseDoc,
  type DataCollectionName,
  type Settings,
  type Snapshot,
} from '../../data/schema';

export function makeSnapshot(
  data: Snapshot['data'],
  settings: Settings | null,
  exportedAt: number,
  appVersion: string,
): Snapshot {
  return { app: 'policy-debate', schema: SCHEMA_VERSION, exportedAt, appVersion, settings, data };
}

export function emptyData(): Snapshot['data'] {
  const data = {} as Record<DataCollectionName, BaseDoc[]>;
  for (const name of DATA_COLLECTIONS) data[name] = [];
  return data as unknown as Snapshot['data'];
}

export type ParseResult = { ok: true; snapshot: Snapshot; warnings: string[] } | { ok: false; error: string };

/** Read and check a backup file's text. */
export function parseSnapshot(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'This file is not valid JSON, so it is not a Policy Debate backup.' };
  }
  if (!raw || typeof raw !== 'object' || (raw as { app?: unknown }).app !== 'policy-debate') {
    return { ok: false, error: 'This file is not a Policy Debate backup.' };
  }
  const input = raw as Partial<Snapshot>;
  const schema = typeof input.schema === 'number' ? input.schema : 0;
  if (schema > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `This backup was made by a newer version of Policy Debate (data format ${schema}). Update the app, then restore it.`,
    };
  }
  if (!input.data || typeof input.data !== 'object') {
    return { ok: false, error: 'This backup file has no data in it.' };
  }
  const warnings: string[] = [];
  const data = emptyData();
  for (const name of DATA_COLLECTIONS) {
    const list = (input.data as Record<string, unknown>)[name];
    if (list === undefined) continue; // older backups may not have newer collections
    if (!Array.isArray(list)) {
      warnings.push(`"${name}" was not a list and was skipped.`);
      continue;
    }
    const { docs, dropped } = repairList(name, list);
    if (dropped) warnings.push(`${dropped} damaged item(s) in "${name}" were skipped.`);
    (data as unknown as Record<string, BaseDoc[]>)[name] = docs;
  }
  const snapshot: Snapshot = {
    app: 'policy-debate',
    schema: SCHEMA_VERSION,
    exportedAt: typeof input.exportedAt === 'number' ? input.exportedAt : 0,
    appVersion: typeof input.appVersion === 'string' ? input.appVersion : '',
    settings: input.settings ? mergeSettings(input.settings) : null,
    data,
  };
  return { ok: true, snapshot, warnings };
}

export { repairRound };

/** Count what is in a snapshot, for the "restore this backup?" confirmation. */
export function describeSnapshot(s: Snapshot): string {
  const parts: string[] = [];
  const label: Partial<Record<DataCollectionName, [string, string]>> = {
    cards: ['card', 'cards'],
    blocks: ['block', 'blocks'],
    tfiles: ['T file', 'T files'],
    rounds: ['round', 'rounds'],
    topics: ['topic', 'topics'],
    scouting: ['scouting note', 'scouting notes'],
  };
  for (const name of DATA_COLLECTIONS) {
    const n = s.data[name].length;
    const words = label[name];
    if (n && words) parts.push(`${n} ${n === 1 ? words[0] : words[1]}`);
  }
  return parts.length ? parts.join(', ') : 'nothing yet';
}

/**
 * Which automatic snapshots to keep: the newest `keepRecent`, plus the newest
 * one from each of the last `keepDays` days. Returns the ids to delete.
 *
 * Every snapshot is a full copy of everything, so a big library would otherwise
 * be stored two dozen times over and could fill the browser's storage (which
 * would make ordinary saves fail). If the kept snapshots add up to more than
 * `maxBytes`, the oldest go too, but the newest three always stay.
 */
export function backupsToPrune(
  backups: { id: string; createdAt: number; bytes?: number }[],
  keepRecent = 10,
  keepDays = 14,
  maxBytes = 150 * 1024 * 1024,
): string[] {
  const sorted = [...backups].sort((a, b) => b.createdAt - a.createdAt);
  const keep = new Set(sorted.slice(0, keepRecent).map((b) => b.id));
  const days = new Set<string>();
  for (const b of sorted) {
    const day = new Date(b.createdAt).toDateString();
    if (days.has(day)) continue;
    if (days.size >= keepDays) break;
    days.add(day);
    keep.add(b.id);
  }
  const ALWAYS = 3;
  let total = 0;
  let kept = 0;
  for (const b of sorted) {
    if (!keep.has(b.id)) continue;
    kept++;
    total += b.bytes ?? 0;
    if (kept > ALWAYS && total > maxBytes) keep.delete(b.id);
  }
  return sorted.filter((b) => !keep.has(b.id)).map((b) => b.id);
}
