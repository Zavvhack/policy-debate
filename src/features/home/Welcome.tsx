// The first-launch welcome: four short steps that say what the app is for and
// where things are. Shown once; it can be opened again from Home.

import { useState } from 'preact/hooks';
import { navigate } from '../../app/router';
import { platform } from '../../platform';
import { updateSettings } from '../../data/store';
import { openDialog } from '../../ui/kit';

interface Step {
  title: string;
  body: preact.ComponentChildren;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to Policy Debate',
    body: (
      <>
        <p>One place to get ready for policy debate rounds, and to debate in them. It has two halves:</p>
        <ul class="welcome-list">
          <li>
            <strong>Prep</strong> is for before the tournament: cutting cards, building blocks, topicality files and scouting notes.
          </li>
          <li>
            <strong>Round Mode</strong> is for the round itself: flowing, timers, your own files and cross-ex notes.
          </li>
        </ul>
        <p>It works offline, and there is no account to make.</p>
      </>
    ),
  },
  {
    title: 'In a round',
    body: (
      <>
        <p>
          Press <strong>Start a round</strong> and the screen changes to Round Mode:
        </p>
        <ul class="welcome-list">
          <li>
            <strong>Flow</strong> with the keyboard: Enter for a new argument, Tab to answer it. Press <kbd class="kbd">Alt</kbd>+<kbd class="kbd">/</kbd> for every shortcut.
          </li>
          <li>
            <strong>Timers</strong> for each speech and both teams' prep, with a warning before time runs out.
          </li>
          <li>
            <strong>Docs</strong> shows the cards and blocks you prepared. <strong>CX notes</strong> is a page to type on.
          </li>
        </ul>
        <p>
          Everything saves as you type. When the round is over, press <strong>End round</strong>.
        </p>
      </>
    ),
  },
  {
    title: 'Before a round',
    body: (
      <ul class="welcome-list">
        <li>
          <strong>Card cutter:</strong> paste an article, mark what you will read, and save it as a card. The card's words can never be changed from the article's.
        </li>
        <li>
          <strong>Library:</strong> every card you have cut or imported, searchable. Export to Word or copy into Google Docs.
        </li>
        <li>
          <strong>Blocks</strong> and <strong>Topicality:</strong> write your answers once, with fill-in-the-blank templates to start from.
        </li>
        <li>
          <strong>Rebuttal practice</strong> and <strong>Scouting:</strong> timed speech drills, and notes on teams and judges.
        </li>
      </ul>
    ),
  },
  {
    title: 'Your files stay on this computer',
    body: (
      <>
        <p>Nothing you type is sent anywhere. There is no server and no sign-in.</p>
        {platform.kind === 'browser' ? (
          <p>
            In this browser version, your files live inside <strong>this browser on this computer</strong>. Clearing the browser's data erases them, so go to{' '}
            <strong>Settings → Backup</strong> now and then and download a backup file.
          </p>
        ) : (
          <p>
            The app also writes backup copies to a folder on this computer. <strong>Settings → Backup</strong> shows where, and lets you save a backup file to take to
            another computer.
          </p>
        )}
      </>
    ),
  },
  {
    title: 'AI is optional',
    body: (
      <>
        <p>
          <strong>You do not need AI to use this app.</strong> Flowing, timers, the library, cutting cards by hand, blocks, templates and topicality files all work without
          it.
        </p>
        <p>
          If you have your own Claude API key (a paid account with Anthropic), a few Prep tools can use it: suggesting which words of an article to highlight, drafting
          blocks, and feedback on practice speeches. AI is <strong>never available during a round</strong>, and it cannot write evidence.
        </p>
        <p>Which do you want?</p>
      </>
    ),
  },
];

function WelcomeBody({ close }: { close: (choice?: 'key' | 'hide' | 'later') => void }) {
  const [at, setAt] = useState(0);
  const step = STEPS[at];
  const last = at === STEPS.length - 1;
  return (
    <div class="welcome">
      <p class="eyebrow" aria-live="polite">
        Step {at + 1} of {STEPS.length}
      </p>
      <h2 class="dialog-title">{step.title}</h2>
      <div class="dialog-body">{step.body}</div>
      <div class="dialog-actions">
        {!last && (
          <button class="btn btn-quiet" onClick={() => close('later')}>
            Skip
          </button>
        )}
        {at > 0 && (
          <button class="btn" onClick={() => setAt(at - 1)}>
            Back
          </button>
        )}
        {!last ? (
          <button class="btn btn-primary" autofocus onClick={() => setAt(at + 1)}>
            Next
          </button>
        ) : (
          <>
            <button class="btn" onClick={() => close('key')}>
              I have a key: set it up
            </button>
            <button class="btn" onClick={() => close('later')}>
              Decide later
            </button>
            <button class="btn btn-primary" autofocus onClick={() => close('hide')}>
              No AI: hide those features
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Show the welcome. Whatever the user does with it, it counts as seen. */
export async function showWelcome(): Promise<void> {
  const choice = await openDialog<'key' | 'hide' | 'later'>((close) => <WelcomeBody close={close} />);
  updateSettings((s) => ({ ...s, seenWelcome: true, ai: { ...s.ai, show: choice === 'hide' ? false : choice === 'key' ? true : s.ai.show } }));
  if (choice === 'key') navigate('/settings/ai');
}
