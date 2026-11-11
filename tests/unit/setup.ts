// Runs before every test file.
// Gives the tests a real (in-memory) IndexedDB, the same API the app uses in a browser.
import 'fake-indexeddb/auto';

// The app version is injected by Vite at build time; tests need a stand-in.
(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = 'test';
(globalThis as unknown as { __SINGLE_FILE__: boolean }).__SINGLE_FILE__ = false;
