// The top of the app: decides between Round Mode and Prep.

import { useEffect } from 'preact/hooks';
import { isAiLocked, lockState } from '../ai/lock';
import { platform } from '../platform';
import { activeTopic, otherWindowOpen, saveState, settings, storageKind, storeReady } from '../data/store';
import { DialogHost, ToastHost } from '../ui/kit';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { RoundMode } from '../features/round/RoundMode';
import { RoundReviewPage, RoundsPage, StartRoundPage } from '../features/round/StartRound';
import { HomePage } from '../features/home/Home';
import { aiMode, refreshAiKey } from '../features/ai/availability';
import { showWelcome } from '../features/home/Welcome';
import { SettingsPage } from '../features/settings/Settings';
import { navigate, route, routeParts } from './router';
import { PREP_PAGES, renderPrepPage } from './pages';

interface NavItem {
  path: string;
  label: string;
  group: 'Prep' | 'Round' | 'App';
  aiOnly?: boolean;
}

const NAV: NavItem[] = [
  { path: '/home', label: 'Home', group: 'App' },
  ...PREP_PAGES.map((p) => ({ path: p.path, label: p.label, group: 'Prep' as const, aiOnly: p.aiOnly })),
  { path: '/round/new', label: 'Start a round', group: 'Round' },
  { path: '/rounds', label: 'Past rounds', group: 'Round' },
  { path: '/settings', label: 'Settings', group: 'App' },
];

function applyAppearance(): void {
  const s = settings.value;
  const root = document.documentElement;
  const dark = s.theme === 'dark' || (s.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.setProperty('--scale', String(s.textScale));
  // Highlight colours are used by card previews everywhere.
  root.style.setProperty('--hl-neg', s.highlight.negColor);
  root.style.setProperty('--hl-aff', s.highlight.affColor);
}

function Sidebar() {
  const current = `/${routeParts()[0] ?? 'home'}`;
  const full = route.value;
  const topic = activeTopic();
  const groups: NavItem['group'][] = ['App', 'Prep', 'Round'];
  const ai = aiMode();
  const isOn = (item: NavItem) => (item.path === '/round/new' ? full === '/round/new' : item.path === current && full !== '/round/new');
  return (
    <nav class="sidebar" aria-label="Main">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          PD
        </span>
        <span class="brand-name">Policy Debate</span>
      </div>
      {groups.map((g) => (
        <div key={g} class="nav-group">
          {g !== 'App' && <div class="nav-heading">{g === 'Prep' ? (ai === 'ready' ? 'Prep · AI allowed' : 'Prep') : 'Round · no AI'}</div>}
          {NAV.filter((n) => n.group === g && n.path !== '/settings' && !(n.aiOnly && ai === 'hidden')).map((n) => (
            <a key={n.path} href={`#${n.path}`} class={`nav-link ${isOn(n) ? 'is-on' : ''} ${n.path === '/round/new' ? 'nav-cta' : ''}`} aria-current={isOn(n) ? 'page' : undefined}>
              {n.label}
              {n.aiOnly && (
                <span class="nav-tag" title="This page is an AI tool. It needs your own Claude API key.">
                  AI
                </span>
              )}
            </a>
          ))}
        </div>
      ))}
      <div class="nav-foot">
        <a href="#/settings" class={`nav-link ${current === '/settings' ? 'is-on' : ''}`}>
          Settings
        </a>
        {topic && (
          <a href="#/settings/topics" class="topic-chip" title={topic.resolution}>
            <span class="muted">Topic</span>
            <span>{topic.name}</span>
          </a>
        )}
        <SaveStatus />
      </div>
    </nav>
  );
}

function SaveStatus() {
  const s = saveState.value;
  if (storageKind.value === 'memory') {
    return (
      <div class="save-status is-error" role="alert">
        Not saving: this browser is blocking storage. Download a backup before closing.
      </div>
    );
  }
  return (
    <div class={`save-status ${s.error ? 'is-error' : ''}`} role="status">
      {s.error ? s.error : s.pending ? 'Saving…' : 'All changes saved'}
      <span class="muted"> · {platform.kind === 'desktop' ? 'desktop app' : 'browser version'}</span>
    </div>
  );
}

function PrepShell() {
  // Prep is the only place AI appears, so this is where we find out whether a
  // key is saved, and where a first-time user gets the welcome.
  useEffect(() => {
    void refreshAiKey();
    if (!settings.value.seenWelcome) void showWelcome();
  }, []);
  const parts = routeParts();
  const top = parts[0] ?? 'home';
  let page;
  if (top === 'home') page = <HomePage />;
  else if (top === 'round' && parts[1] === 'new') page = <StartRoundPage />;
  else if (top === 'rounds' && parts[1]) page = <RoundReviewPage id={parts[1]} />;
  else if (top === 'rounds') page = <RoundsPage />;
  else if (top === 'settings') page = <SettingsPage section={parts[1]} />;
  else page = renderPrepPage(parts) ?? <HomePage />;
  return (
    <div class="shell">
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar />
      <main id="main" class="content" tabIndex={-1}>
        {/* The key makes a new page start fresh, so one broken page never blocks the others. */}
        <ErrorBoundary key={route.value} what="this page">
          {page}
        </ErrorBoundary>
      </main>
    </div>
  );
}

export function App() {
  // Re-apply theme, text size and colours whenever settings change.
  useEffect(() => {
    applyAppearance();
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', applyAppearance);
    return () => mq?.removeEventListener?.('change', applyAppearance);
  });

  if (otherWindowOpen.value) {
    return (
      <div class="splash splash-message" role="alert">
        <h1>Policy Debate is already open</h1>
        <p>
          It is open in another window or tab on this computer. Use that one. Two copies open at once would each save over the other's work, so this one has not loaded
          your files.
        </p>
        <button class="btn btn-primary" onClick={() => location.reload()}>
          I closed the other one: try again
        </button>
      </div>
    );
  }

  if (!storeReady.value) {
    return (
      <div class="splash" role="status">
        Loading your files…
      </div>
    );
  }

  // Reading lockState here subscribes the whole app to it: the moment a round
  // starts, Prep disappears; the moment it ends, Prep comes back.
  const locked = lockState.value !== null && isAiLocked();
  return (
    <>
      <ErrorBoundary what="the app">{locked ? <RoundMode /> : <PrepShell />}</ErrorBoundary>
      <DialogHost />
      <ToastHost />
    </>
  );
}

export { navigate };
