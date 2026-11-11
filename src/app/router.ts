// A tiny router.
//
// The current screen is stored after the # in the address, e.g. #/library.
// Hash routes work when the app is opened as a plain file from a USB drive,
// where "real" paths would not.

import { signal } from '@preact/signals';

function read(): string {
  const h = typeof location === 'undefined' ? '' : location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/home';
}

/** The current route, e.g. "/rounds/abc123". */
export const route = signal<string>(read());

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    route.value = read();
  });
}

export function navigate(path: string): void {
  if (typeof location !== 'undefined' && location.hash !== `#${path}`) location.hash = path;
  route.value = path;
}

/** Split "/rounds/abc" into ["rounds", "abc"]. */
export function routeParts(path = route.value): string[] {
  return path.split('/').filter(Boolean).map(decodeURIComponent);
}
