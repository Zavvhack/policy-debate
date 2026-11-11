// Small helpers shared by everything: ids, timestamps, and tiny utilities.

/** A unique id. Uses the browser's crypto so ids never collide, even in a batch. */
export function newId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(36).padStart(2, '0');
  return out;
}

/** Current time in milliseconds since 1970. Wrapped so tests can replace it. */
export function now(): number {
  return Date.now();
}

/** Limit a number to the range [lo, hi]. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** "8:00", "0:07", "-0:03" (negative = over time). */
export function formatClock(ms: number): string {
  const neg = ms < 0;
  // Round up so a display of "0:01" means "less than a second left has not been hidden".
  const totalSeconds = neg ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${neg && totalSeconds > 0 ? '-' : ''}${m}:${String(s).padStart(2, '0')}`;
}

/** A safe file name piece: letters, digits, dash, underscore, space. */
export function safeFileName(s: string, fallback = 'file'): string {
  const cleaned = s.replace(/[^\p{L}\p{N} _.-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 80) || fallback;
}

/** YYYY-MM-DD for file names and backups. */
export function isoDate(t = now()): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** YYYY-MM-DD_HH-MM-SS, used for versioned backup names. */
export function isoStamp(t = now()): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${isoDate(t)}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
