// Where the app starts.

import { render } from 'preact';
import './styles/app.css';
import { App } from './app/App';
import { lockState } from './ai/lock';
import { platform } from './platform';
import { flushWrites, initStore, journalPendingWrites, lastBackupBytes, otherWindowOpen, requestPersistentStorage, storeReady, takeBackup } from './data/store';
import { toast } from './ui/kit';

const root = document.getElementById('app')!;
render(<App />, root);

platform
  .claimInstance()
  .then((alone) => {
    if (!alone) {
      // Another window has the app open. Do not load (or save) anything here:
      // two copies would overwrite each other's work.
      otherWindowOpen.value = true;
      return;
    }
    return initStore().then(() => {
      // Ask the browser not to clear our files when the disk gets full.
      void requestPersistentStorage();
      // A snapshot of everything every five minutes, but only if something changed.
      setInterval(() => {
        // Copying a very large library takes a moment. During a round nothing may
        // make the flow stutter, so a big copy waits for "End round" (which always
        // takes one). The round itself is saved continuously either way.
        if (lockState.value?.active && lastBackupBytes() > 5_000_000) return;
        void takeBackup('Automatic');
      }, 5 * 60 * 1000);
    });
  })
  .catch((err: unknown) => {
    console.error(err);
    root.textContent = `Policy Debate could not open its files: ${err instanceof Error ? err.message : String(err)}`;
  });

// When the window is hidden or closed: copy anything not yet saved into the
// crash journal (instant and guaranteed), then write it to the database too.
// Changes are normally on disk within a second of being made anyway.
const flush = () => {
  if (!storeReady.value) return;
  journalPendingWrites();
  void flushWrites().then(journalPendingWrites);
};
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', (e) => {
  flush();
  // Browser version, mid-round: closing the tab by accident (Ctrl+W is one key
  // from Ctrl+E) should ask first. Nothing would be lost either way: the round
  // is saved and comes back, still locked, when the app is reopened.
  if (platform.kind === 'browser' && lockState.value?.active) {
    e.preventDefault();
    e.returnValue = '';
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});

// Never fail silently: if something unexpected goes wrong, say so.
window.addEventListener('error', (e) => {
  console.error(e.error ?? e.message);
  toast('Something went wrong. Your saved work is safe; if this keeps happening, reload the app.', { kind: 'error' });
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  const reason = e.reason as { name?: string } | undefined;
  // A locked AI call is expected and already explained on screen.
  if (reason?.name !== 'AiLockedError') toast('Something went wrong. Your saved work is safe.', { kind: 'error' });
});
