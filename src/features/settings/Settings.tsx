// Settings. Each section is its own small component further down this file.

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { newId, now, isoDate, formatClock } from '../../core/ids';
import { BUILT_IN_FORMATS, roundSeconds, validateFormat, type TimeFormat } from '../../core/debate/formats';
import { cleanAbbreviations, STARTER_ABBREVIATIONS } from '../../core/flow/abbrev';
import { describeSnapshot, parseSnapshot } from '../../core/backup/backup';
import { platform } from '../../platform';
import {
  backups,
  currentSnapshot,
  db,
  emptyTrash,
  loadBackupList,
  readBackup,
  restoreFromTrash,
  restoreSnapshot,
  settings,
  takeBackup,
  trash,
  updateSettings,
  storagePersisted,
} from '../../data/store';
import type { Topic } from '../../data/schema';
import { navigate } from '../../app/router';
import { confirmDialog, Field, Select, TextArea, TextInput, toast, Toggle } from '../../ui/kit';
import { playAlert, vibrateAlert, canVibrate } from '../round/sound';
import { EXTRA_SETTINGS } from './extra';

interface Section {
  id: string;
  label: string;
  render: () => ComponentChildren;
}

const SECTIONS: Section[] = [
  { id: 'appearance', label: 'Appearance', render: () => <Appearance /> },
  { id: 'topics', label: 'Topics', render: () => <Topics /> },
  ...EXTRA_SETTINGS,
  { id: 'timers', label: 'Timers', render: () => <Timers /> },
  { id: 'flow', label: 'Flowing', render: () => <Flowing /> },
  { id: 'backup', label: 'Backup & restore', render: () => <Backup /> },
  { id: 'about', label: 'About', render: () => <About /> },
];

export function SettingsPage({ section }: { section?: string }) {
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  return (
    <div class="page settings">
      <h1>Settings</h1>
      <div class="settings-layout">
        <nav class="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#/settings/${s.id}`} class={`nav-link ${s.id === current.id ? 'is-on' : ''}`} aria-current={s.id === current.id ? 'page' : undefined}>
              {s.label}
            </a>
          ))}
        </nav>
        <div class="settings-body">{current.render()}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Appearance() {
  const s = settings.value;
  return (
    <section class="card form-grid">
      <h2>Appearance</h2>
      <Field label="Theme">
        <Select
          value={s.theme}
          onChange={(theme) => updateSettings({ theme })}
          options={[
            { value: 'system', label: 'Match my computer' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Field>
      <Field label={`Text size: ${Math.round(s.textScale * 100)}%`} hint="Makes everything in the app bigger or smaller.">
        <input
          type="range"
          min="0.85"
          max="1.5"
          step="0.05"
          value={s.textScale}
          onInput={(e) => updateSettings({ textScale: Number((e.target as HTMLInputElement).value) })}
        />
      </Field>
    </section>
  );
}

// ---------------------------------------------------------------------------

function blankTopic(): Topic {
  const t = now();
  return { id: newId(), createdAt: t, updatedAt: t, name: 'New topic', season: '', resolution: 'Resolved: ', keyTerms: [], noviceLimits: [], noviceNote: '', notes: '', sources: [] };
}

function Topics() {
  const topics = db.topics.list.value;
  const activeId = settings.value.activeTopicId;
  const [editId, setEditId] = useState(activeId);
  const topic = topics.find((t) => t.id === editId) ?? topics[0];
  const save = (patch: Partial<Topic>) => db.topics.put({ ...topic, ...patch }, 250);

  const add = () => {
    const t = db.topics.put(blankTopic());
    setEditId(t.id);
  };
  const remove = async () => {
    if (topics.length <= 1) return toast('Keep at least one topic.', { kind: 'error' });
    const used =
      db.cards.list.value.filter((c) => c.topicId === topic.id).length +
      db.blocks.list.value.filter((b) => b.topicId === topic.id).length +
      db.tfiles.list.value.filter((f) => f.topicId === topic.id).length;
    const yes = await confirmDialog({
      title: `Delete the topic "${topic.name}"?`,
      body: used
        ? `${used} card(s), block(s) or T file(s) belong to this topic. They are kept, but you will only see them again if you restore the topic from the trash.`
        : 'It can be restored from the trash for 30 days.',
      confirm: 'Delete topic',
      danger: true,
    });
    if (!yes) return;
    const next = topics.find((t) => t.id !== topic.id)!;
    if (activeId === topic.id) updateSettings({ activeTopicId: next.id });
    db.topics.remove(topic.id, `Topic: ${topic.name}`);
    setEditId(next.id);
  };

  if (!topic) return null;
  return (
    <section class="card form-grid">
      <h2>Topics</h2>
      <p class="muted">
        Everything in Prep (your library, blocks, T files, and all AI help) belongs to the <strong>active topic</strong>. Switch topics here; add next year's when it is
        announced.
      </p>
      <div class="row">
        <Field label="Topic">
          <Select value={topic.id} onChange={setEditId} options={topics.map((t) => ({ value: t.id, label: `${t.name}${t.id === activeId ? '  (active)' : ''}` }))} />
        </Field>
        <div class="row-tight align-end">
          <button class="btn btn-primary" disabled={topic.id === activeId} onClick={() => (updateSettings({ activeTopicId: topic.id }), toast(`Active topic: ${topic.name}`, { kind: 'success' }))}>
            {topic.id === activeId ? 'Active' : 'Make active'}
          </button>
          <button class="btn" onClick={add}>
            Add a topic
          </button>
        </div>
      </div>
      <div class="row">
        <Field label="Short name">
          <TextInput value={topic.name} onChange={(name) => save({ name })} />
        </Field>
        <Field label="Season" class="field-small">
          <TextInput value={topic.season} onChange={(season) => save({ season })} placeholder="2027-28" />
        </Field>
      </div>
      <Field label="Resolution (exact wording)" hint="Copy it exactly from the NFHS or NSDA announcement. The AI is always given this text word for word.">
        <TextArea rows={3} value={topic.resolution} onChange={(resolution) => save({ resolution })} />
      </Field>
      <Field label="Key terms" hint="One per line. These are the words and phrases your topicality definitions are filed under.">
        <TextArea rows={6} value={topic.keyTerms.join('\n')} onChange={(v) => save({ keyTerms: v.split('\n').map((x) => x.trim()).filter(Boolean) })} />
      </Field>
      <Field
        label="Novice case limits"
        hint="One per line, as: Name — description. Leave empty if your league has none."
      >
        <TextArea
          rows={5}
          value={topic.noviceLimits.map((n) => (n.description ? `${n.name} — ${n.description}` : n.name)).join('\n')}
          onChange={(v) =>
            save({
              noviceLimits: v
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => {
                  const at = line.search(/\s[—–-]\s/);
                  return at < 0 ? { name: line, description: '' } : { name: line.slice(0, at).trim(), description: line.slice(at + 3).trim() };
                }),
            })
          }
        />
      </Field>
      <Field label="About the novice limits">
        <TextArea rows={3} value={topic.noviceNote} onChange={(noviceNote) => save({ noviceNote })} />
      </Field>
      <Field label="Notes">
        <TextArea rows={3} value={topic.notes} onChange={(notes) => save({ notes })} />
      </Field>
      {topic.sources.length > 0 && (
        <div>
          <div class="field-label">Sources</div>
          <ul class="plain-list">
            {topic.sources.map((s) => (
              <li key={s.url}>
                <a class="link" href={s.url} target="_blank" rel="noreferrer noopener">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div class="form-actions">
        <button class="btn btn-danger-quiet" onClick={remove} disabled={topics.length <= 1}>
          Delete this topic
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function minutes(seconds: number): string {
  return String(Math.round((seconds / 60) * 100) / 100);
}

function Timers() {
  const t = settings.value.timer;
  const set = (patch: Partial<typeof t>) => updateSettings((s) => ({ ...s, timer: { ...s.timer, ...patch } }));
  const formats = [...BUILT_IN_FORMATS, ...t.customFormats];
  const selected = formats.find((f) => f.id === t.formatId) ?? formats[0];
  const custom = t.customFormats.find((f) => f.id === selected.id);
  const problems = custom ? validateFormat(custom) : [];

  const addCustom = () => {
    const f: TimeFormat = { ...selected, id: `custom-${newId()}`, name: `${selected.name.replace(/^My copy of /, '')} (my copy)`, builtIn: false, source: undefined, sourceUrl: undefined };
    set({ customFormats: [...t.customFormats, f], formatId: f.id });
  };
  const patchCustom = (patch: Partial<TimeFormat>) => set({ customFormats: t.customFormats.map((f) => (f.id === selected.id ? { ...f, ...patch } : f)) });
  const removeCustom = () => set({ customFormats: t.customFormats.filter((f) => f.id !== selected.id), formatId: BUILT_IN_FORMATS[0].id });
  const num = (label: string, key: 'constructive' | 'cx' | 'rebuttal' | 'prep') => (
    <Field label={label} class="field-small">
      <input
        class="input"
        type="number"
        min="0"
        step="0.5"
        value={minutes(custom![key])}
        onInput={(e) => patchCustom({ [key]: Math.round(Number((e.target as HTMLInputElement).value) * 60) })}
      />
    </Field>
  );

  return (
    <section class="card form-grid">
      <h2>Timers</h2>
      <Field label="Default time format" hint="You can also pick a format each time you start a round.">
        <Select value={selected.id} onChange={(formatId) => set({ formatId })} options={formats.map((f) => ({ value: f.id, label: f.name }))} />
      </Field>
      <div class="format-summary">
        <div>
          <strong>{minutes(selected.constructive)}</strong> min constructives · <strong>{minutes(selected.cx)}</strong> min cross-ex · <strong>{minutes(selected.rebuttal)}</strong> min
          rebuttals · <strong>{minutes(selected.prep)}</strong> min prep per team
        </div>
        <div class="muted">Speaking time: {formatClock(roundSeconds(selected) * 1000)}.</div>
        {selected.source && (
          <div class="muted">
            Source: {selected.source}{' '}
            {selected.sourceUrl && (
              <a class="link" href={selected.sourceUrl} target="_blank" rel="noreferrer noopener">
                Check it
              </a>
            )}
          </div>
        )}
      </div>
      {custom ? (
        <div class="subcard form-grid">
          <Field label="Name">
            <TextInput value={custom.name} onChange={(name) => patchCustom({ name })} />
          </Field>
          <div class="row">
            {num('Constructive (min)', 'constructive')}
            {num('Cross-ex (min)', 'cx')}
            {num('Rebuttal (min)', 'rebuttal')}
            {num('Prep per team (min)', 'prep')}
          </div>
          {problems.length > 0 && (
            <ul class="problems" role="alert">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div>
            <button class="btn btn-danger-quiet" onClick={removeCustom}>
              Delete this format
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button class="btn" onClick={addCustom}>
            Make my own format from this one
          </button>
          <p class="field-hint">Built-in formats cannot be edited, because each one is tied to a rulebook. Copy one to change the times (for example 5 minutes of prep).</p>
        </div>
      )}
      <Field label="Warning before time runs out" hint="Seconds. Use 0 for no warning.">
        <input class="input input-small" type="number" min="0" max="300" step="5" value={t.warningSec} onInput={(e) => set({ warningSec: Math.max(0, Math.round(Number((e.target as HTMLInputElement).value))) })} />
      </Field>
      <Toggle checked={t.sound} onChange={(sound) => set({ sound })} label="Beep" hint="Two short beeps at the warning, three at zero. Check the room's rules and your judge before using sound." />
      <Toggle checked={t.flash} onChange={(flash) => set({ flash })} label="Flash the timer" />
      <Toggle
        checked={t.vibrate && canVibrate}
        disabled={!canVibrate}
        onChange={(vibrate) => set({ vibrate })}
        label="Vibrate"
        hint={canVibrate ? 'Works on phones and some tablets.' : 'Not available on this device (laptops cannot vibrate).'}
      />
      <div class="row-tight">
        <button class="btn" onClick={() => (playAlert('warning'), vibrateAlert('warning'))}>
          Test the warning
        </button>
        <button class="btn" onClick={() => (playAlert('done'), vibrateAlert('done'))}>
          Test the end-of-time alert
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Flowing() {
  const f = settings.value.flow;
  const set = (patch: Partial<typeof f>) => updateSettings((s) => ({ ...s, flow: { ...s.flow, ...patch } }));
  const [text, setText] = useState(f.abbreviations.map((a) => `${a.code} = ${a.expansion}`).join('\n'));
  const parse = (v: string) =>
    cleanAbbreviations(
      v.split('\n').map((line) => {
        const at = line.indexOf('=');
        return at < 0 ? { code: '', expansion: '' } : { code: line.slice(0, at), expansion: line.slice(at + 1) };
      }),
    );
  const onText = (v: string) => {
    setText(v);
    set({ abbreviations: parse(v) });
  };
  return (
    <section class="card form-grid">
      <h2>Flowing</h2>
      <Toggle
        checked={f.mergeBlock}
        onChange={(mergeBlock) => set({ mergeBlock })}
        label="One column for the negative block (new rounds)"
        hint="Off: the 2NC and 1NR each get their own column. On: one 'Block' column, like most paper flows."
      />
      <Toggle checked={f.dropHints} onChange={(dropHints) => set({ dropHints })} label='Show "no answer?" hints' hint="Marks arguments the other team has not answered once their chance has passed. You decide whether to call it dropped (Ctrl+D)." />
      <Field label={`Flow text size: ${f.fontPx}px`}>
        <input type="range" min="11" max="22" step="1" value={f.fontPx} onInput={(e) => set({ fontPx: Number((e.target as HTMLInputElement).value) })} />
      </Field>
      <Field
        label="My abbreviations"
        hint={
          <>
            One per line, as <code>code = what it expands to</code>. On the flow, a code is replaced as soon as you finish the word. Codes are case-sensitive and cannot contain
            spaces. {f.abbreviations.length} active.
          </>
        }
      >
        <TextArea rows={10} value={text} onChange={onText} placeholder={'nu = non-unique\nlt = link turn'} class="mono" />
      </Field>
      <div>
        <button
          class="btn"
          onClick={() => {
            const merged = cleanAbbreviations([...f.abbreviations, ...STARTER_ABBREVIATIONS]);
            setText(merged.map((a) => `${a.code} = ${a.expansion}`).join('\n'));
            set({ abbreviations: merged });
          }}
        >
          Add the starter list
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function when(t: number): string {
  return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function Backup() {
  const [folder, setFolder] = useState('');
  useEffect(() => {
    void loadBackupList();
    if (platform.can.diskBackups) void platform.backupFolder().then(setFolder).catch(() => {});
  }, []);

  const download = async () => {
    const json = JSON.stringify(currentSnapshot(), null, 1);
    const ok = await platform.saveFile(`policy-debate-backup_${isoDate()}.json`, new Blob([json], { type: 'application/json' }));
    if (ok) {
      updateSettings((s) => ({ ...s, backup: { lastFileExportAt: now() } }));
      toast('Backup file saved.', { kind: 'success' });
    }
  };

  const restoreText = async (json: string, what: string) => {
    const parsed = parseSnapshot(json);
    if (!parsed.ok) return toast(parsed.error, { kind: 'error' });
    const yes = await confirmDialog({
      title: `Restore ${what}?`,
      body: (
        <>
          <p>
            It contains: <strong>{describeSnapshot(parsed.snapshot)}</strong>
            {parsed.snapshot.exportedAt ? ` (saved ${when(parsed.snapshot.exportedAt)})` : ''}.
          </p>
          <p>This replaces everything currently in the app. A safety copy of what you have now is taken first, so you can go back.</p>
          {parsed.warnings.length > 0 && (
            <ul class="problems">
              {parsed.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </>
      ),
      confirm: 'Restore',
      danger: true,
    });
    if (!yes) return;
    try {
      await restoreSnapshot(parsed.snapshot);
      toast('Backup restored.', { kind: 'success' });
      navigate('/home');
    } catch (err) {
      toast(`Restore failed: ${err instanceof Error ? err.message : err}. Nothing was changed.`, { kind: 'error' });
    }
  };

  const pickFile = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void file.text().then((text) => restoreText(text, `"${file.name}"`));
  };

  return (
    <>
      <section class="card form-grid">
        <h2>Backup &amp; restore</h2>
        {platform.kind === 'browser' ? (
          <p>
            <strong>Browser version:</strong> your files are stored inside this browser, on this computer. They are <em>not</em> inside the .html file, so they do not travel
            with a USB drive, and clearing the browser's site data erases them. <strong>Download a backup file regularly</strong> and keep it next to the app. To move to
            another computer, restore that file there.
            <br />
            <strong>Updating to a new version:</strong> download a backup first, then save the new <code>policy-debate.html</code> over the old one, in the same folder and
            with the same name. Some browsers tie your saved files to the file's exact name and place.
          </p>
        ) : (
          <p>
            <strong>Desktop app:</strong> besides the snapshots below, a copy of every automatic backup is written to
            <br />
            <code>{folder || 'the app data folder'}</code>
          </p>
        )}
        <div class="row-tight">
          <button class="btn btn-primary" onClick={download}>
            Download a backup file
          </button>
          <label class="btn">
            Restore from a file…
            <input type="file" accept="application/json,.json" class="sr-only" onChange={pickFile} />
          </label>
        </div>
        {platform.kind === 'browser' && storagePersisted.value !== 'unknown' && (
          <p class={storagePersisted.value === 'yes' ? 'muted' : 'notice'}>
            {storagePersisted.value === 'yes'
              ? 'This browser has agreed to keep your files until you delete them yourself.'
              : 'This browser may clear your files on its own if the computer runs low on disk space. A backup file is the only copy that is safe from that.'}
          </p>
        )}
        <p class="muted">
          {settings.value.backup.lastFileExportAt ? `Last backup file: ${when(settings.value.backup.lastFileExportAt)}.` : 'You have not saved a backup file yet.'}
        </p>
      </section>

      <section class="card">
        <h2>Automatic snapshots</h2>
        <p class="muted">
          The app saves a snapshot of everything when you end a round, before any restore, and every few minutes while you work. The newest ten are kept, plus one a day for
          two weeks.
        </p>
        <div class="row-tight">
          <button class="btn" onClick={() => takeBackup('Manual snapshot', true).then(() => toast('Snapshot taken.', { kind: 'success' }))}>
            Take a snapshot now
          </button>
        </div>
        {!backups.value.length && <div class="empty">No snapshots yet.</div>}
        <ul class="list">
          {backups.value.map((b) => (
            <li key={b.id} class="list-row">
              <span class="list-main static">
                <span class="list-title">{when(b.createdAt)}</span>
                <span class="muted list-meta">
                  {b.reason} · {Math.max(1, Math.round(b.bytes / 1024))} KB
                </span>
              </span>
              <button
                class="btn btn-quiet"
                onClick={async () => {
                  const json = await readBackup(b.id);
                  if (json) await platform.saveFile(`policy-debate-snapshot_${isoDate(b.createdAt)}.json`, new Blob([json], { type: 'application/json' }));
                }}
              >
                Download
              </button>
              <button
                class="btn btn-quiet"
                onClick={async () => {
                  const json = await readBackup(b.id);
                  if (json) await restoreText(json, `the snapshot from ${when(b.createdAt)}`);
                }}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section class="card">
        <h2>Recently deleted</h2>
        <p class="muted">Deleted items are kept for 30 days.</p>
        {!trash.value.length && <div class="empty">Nothing in the trash.</div>}
        <ul class="list">
          {trash.value.map((t) => (
            <li key={t.id} class="list-row">
              <span class="list-main static">
                <span class="list-title">{t.label}</span>
                <span class="muted list-meta">Deleted {when(t.deletedAt)}</span>
              </span>
              <button class="btn btn-quiet" onClick={() => restoreFromTrash(t.id) && toast('Restored.', { kind: 'success' })}>
                Restore
              </button>
            </li>
          ))}
        </ul>
        {trash.value.length > 0 && (
          <button
            class="btn btn-danger-quiet"
            onClick={async () => {
              if (await confirmDialog({ title: 'Empty the trash?', body: 'These items will be gone for good.', confirm: 'Empty trash', danger: true })) emptyTrash();
            }}
          >
            Empty the trash
          </button>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function About() {
  return (
    <section class="card form-grid">
      <h2>About</h2>
      <p>
        Policy Debate {__APP_VERSION__} · {platform.kind === 'desktop' ? 'desktop app' : 'browser version'}
      </p>
      <p>
        <strong>The rule this app is built around:</strong> no AI during a round, ever. Starting a round switches every AI feature off in the code itself, not just on screen,
        and only ending the round switches it back on.
      </p>
      <p class="muted">
        AI in Prep is a research aid. Under NSDA rules generative AI may not be cited as a source, and the original source of any evidence must be available on request. Many
        leagues go further, so check your own league's and each tournament's rules.
      </p>
      {platform.kind === 'browser' && (
        <div class="unavailable">
          <strong>Only in the desktop app:</strong> fetching an article from a URL, keeping your API key in the system keychain, and automatic backups to disk. Everything
          else works here, including offline.
        </div>
      )}
    </section>
  );
}
