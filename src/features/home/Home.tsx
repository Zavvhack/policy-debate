// The first screen you see in Prep.

import { platform } from '../../platform';
import { activeTopic, db, settings, storageKind } from '../../data/store';
import { navigate } from '../../app/router';
import { PREP_PAGES } from '../../app/pages';
import { aiMode } from '../ai/availability';
import { showWelcome } from './Welcome';

const DAY = 24 * 3600 * 1000;

export function HomePage() {
  const topic = activeTopic();
  const rounds = [...db.rounds.list.value].sort((a, b) => b.startedAt - a.startedAt).slice(0, 4);
  const lastExport = settings.value.backup.lastFileExportAt;
  const hasWork = db.cards.list.value.length + db.blocks.list.value.length + db.rounds.list.value.length + db.tfiles.list.value.length > 0;
  const backupStale = platform.kind === 'browser' && hasWork && Date.now() - lastExport > 7 * DAY;

  return (
    <div class="page">
      <h1>Policy Debate</h1>
      {topic && (
        <section class="card topic-card" aria-label="Current topic">
          <div class="eyebrow">Current topic · {topic.season}</div>
          <p class="resolution">{topic.resolution}</p>
          <a class="link" href="#/settings/topics">
            Change topic or edit its details
          </a>
        </section>
      )}

      {storageKind.value === 'memory' && (
        <div class="notice notice-danger" role="alert">
          <strong>Your work is not being saved.</strong> This browser is blocking storage (this happens in some private windows). Use a normal window, or download a
          backup from Settings before you close this page.
        </div>
      )}
      {backupStale && (
        <div class="notice">
          <strong>Time for a backup.</strong> The browser version keeps your files inside this browser on this computer. They do not travel with the USB drive.{' '}
          <a class="link" href="#/settings/backup">
            Download a backup file
          </a>{' '}
          so nothing is lost if the browser's data is cleared.
        </div>
      )}

      <div class="home-grid">
        <section class="card home-round">
          <h2>In a round</h2>
          <p>Flow, timers, your own files, and CX notes. AI is switched off the moment you start.</p>
          <button class="btn btn-primary btn-large" onClick={() => navigate('/round/new')}>
            Start a round
          </button>
          {rounds.length > 0 && (
            <>
              <h3>Recent rounds</h3>
              <ul class="plain-list">
                {rounds.map((r) => (
                  <li key={r.id}>
                    <a class="link" href={`#/rounds/${r.id}`}>
                      {r.name}
                    </a>{' '}
                    <span class="muted">· {new Date(r.startedAt).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
              <a class="link" href="#/rounds">
                All rounds
              </a>
            </>
          )}
        </section>
        <section class="card">
          <h2>Prep</h2>
          {PREP_PAGES.length === 0 ? (
            <p class="muted">Prep tools are being added.</p>
          ) : (
            <ul class="tile-list">
              {PREP_PAGES.filter((p) => !(p.aiOnly && aiMode() === 'hidden')).map((p) => (
                <li key={p.path}>
                  <a class="tile" href={`#${p.path}`}>
                    {p.label}
                    {p.aiOnly && <span class="nav-tag">AI</span>}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p class="muted home-foot">
        New here?{' '}
        <button class="link" onClick={() => void showWelcome()}>
          Show the welcome again
        </button>
        {aiMode() === 'hidden' && (
          <>
            {' '}
            · AI features are hidden.{' '}
            <a class="link" href="#/settings/ai">
              Change
            </a>
          </>
        )}
      </p>
    </div>
  );
}
