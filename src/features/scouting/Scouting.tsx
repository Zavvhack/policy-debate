// Scouting and tournament notes: opponents, judges, tournaments, and what worked.
//
// Everything here is typed in by you. The app links out to openCaselist and
// Tabroom but never reads from them automatically: Tabroom has no public API,
// and scraping either site would be unfair to the people who run them.

import { useState } from 'preact/hooks';
import { newId, now } from '../../core/ids';
import { searchItems } from '../../core/search';
import { activeTopic, db } from '../../data/store';
import type { Round, ScoutDoc, ScoutJudge, ScoutTeam, ScoutTournament } from '../../data/schema';
import { navigate } from '../../app/router';
import { confirmDialog, ExternalLink, Field, Segmented, TextArea, TextInput } from '../../ui/kit';

type Kind = ScoutDoc['type'];

const KIND_LABEL: Record<Kind, string> = { team: 'Teams', judge: 'Judges', tournament: 'Tournaments' };

function title(d: ScoutDoc): string {
  if (d.type === 'team') return [d.school, d.code].filter(Boolean).join(' ') || 'New team';
  if (d.type === 'judge') return d.name || 'New judge';
  return d.name || 'New tournament';
}

function create(kind: Kind): ScoutDoc {
  const t = now();
  const base = { id: newId(), createdAt: t, updatedAt: t };
  const topicId = activeTopic()?.id ?? '';
  if (kind === 'team') return { ...base, type: 'team', topicId, school: '', code: '', debaters: '', wikiUrl: '', affNotes: '', negNotes: '', notes: '' };
  if (kind === 'judge') return { ...base, type: 'judge', name: '', paradigmUrl: '', preferences: '', notes: '' };
  return { ...base, type: 'tournament', topicId, name: '', dates: '', url: '', notes: '' };
}

/** Rounds whose opponent, judge or tournament matches this entry. */
function roundsFor(d: ScoutDoc): Round[] {
  const has = (hay: string, needle: string) => needle.trim().length > 1 && hay.toLowerCase().includes(needle.trim().toLowerCase());
  return db.rounds.list.value
    .filter((r) => {
      if (d.type === 'team') return has(r.meta.opponent, d.school) || has(r.meta.opponent, d.code);
      if (d.type === 'judge') return has(r.meta.judge, d.name);
      return has(r.meta.tournament, d.name);
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

function LinkField({ label, value, onChange, hint, linkText }: { label: string; value: string; onChange: (v: string) => void; hint: string; linkText: string }) {
  return (
    <Field label={label} hint={hint}>
      <span class="row-tight url-row">
        <TextInput type="url" value={value} onChange={onChange} placeholder="https://…" />
        {/^https?:\/\//i.test(value) && <ExternalLink href={value}>{linkText}</ExternalLink>}
      </span>
    </Field>
  );
}

function PastRounds({ doc }: { doc: ScoutDoc }) {
  const rounds = roundsFor(doc);
  return (
    <div>
      <div class="field-label">Past rounds</div>
      {!rounds.length && <p class="muted">None yet. Rounds appear here when the name matches what you type when starting a round.</p>}
      <ul class="plain-list">
        {rounds.map((r) => (
          <li key={r.id}>
            <a class="link" href={`#/rounds/${r.id}`}>
              {r.name}
            </a>{' '}
            <span class="muted">
              · {new Date(r.startedAt).toLocaleDateString()}
              {r.result ? ` · ${r.result}` : ''}
            </span>
            {r.whatWorked.trim() && <div class="muted">What worked: {r.whatWorked.trim()}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TeamForm({ doc }: { doc: ScoutTeam }) {
  const save = (patch: Partial<ScoutTeam>) => db.scouting.put({ ...doc, ...patch }, 250);
  return (
    <>
      <div class="row">
        <Field label="School">
          <TextInput value={doc.school} onChange={(school) => save({ school })} />
        </Field>
        <Field label="Team code" class="field-small">
          <TextInput value={doc.code} onChange={(code) => save({ code })} placeholder="AB" />
        </Field>
        <Field label="Debaters">
          <TextInput value={doc.debaters} onChange={(debaters) => save({ debaters })} />
        </Field>
      </div>
      <LinkField label="Their openCaselist page" value={doc.wikiUrl} onChange={(wikiUrl) => save({ wikiUrl })} hint="Find them on opencaselist.com and paste the address of their page." linkText="Open" />
      <Field label="When they are affirmative" hint="Plan text, advantages, how they answer T and the usual disads.">
        <TextArea rows={4} value={doc.affNotes} onChange={(affNotes) => save({ affNotes })} />
      </Field>
      <Field label="When they are negative" hint="What they read in the 1NC, what they go for in the 2NR.">
        <TextArea rows={4} value={doc.negNotes} onChange={(negNotes) => save({ negNotes })} />
      </Field>
      <Field label="Other notes">
        <TextArea rows={3} value={doc.notes} onChange={(notes) => save({ notes })} />
      </Field>
    </>
  );
}

function JudgeForm({ doc }: { doc: ScoutJudge }) {
  const save = (patch: Partial<ScoutJudge>) => db.scouting.put({ ...doc, ...patch }, 250);
  return (
    <>
      <Field label="Name">
        <TextInput value={doc.name} onChange={(name) => save({ name })} />
      </Field>
      <LinkField label="Paradigm on Tabroom" value={doc.paradigmUrl} onChange={(paradigmUrl) => save({ paradigmUrl })} hint="Judges post their philosophies on tabroom.com under Paradigms. Paste the address of theirs." linkText="Open" />
      <Field label="Preferences" hint="Your summary of their paradigm: speed, topicality, kritiks, theory, what they say they vote on.">
        <TextArea rows={5} value={doc.preferences} onChange={(preferences) => save({ preferences })} />
      </Field>
      <Field label="What you have seen" hint="How they actually voted, comments from ballots, what to do differently next time.">
        <TextArea rows={4} value={doc.notes} onChange={(notes) => save({ notes })} />
      </Field>
    </>
  );
}

function TournamentForm({ doc }: { doc: ScoutTournament }) {
  const save = (patch: Partial<ScoutTournament>) => db.scouting.put({ ...doc, ...patch }, 250);
  return (
    <>
      <div class="row">
        <Field label="Name">
          <TextInput value={doc.name} onChange={(name) => save({ name })} />
        </Field>
        <Field label="Dates" class="field-small">
          <TextInput value={doc.dates} onChange={(dates) => save({ dates })} />
        </Field>
      </div>
      <LinkField label="Tabroom page" value={doc.url} onChange={(url) => save({ url })} hint="The tournament's page on tabroom.com: invitation, pairings and results." linkText="Open" />
      <Field label="Notes" hint="Rules that differ here (prep time, evidence sharing, AI and internet rules), schedule, who is in the pool.">
        <TextArea rows={6} value={doc.notes} onChange={(notes) => save({ notes })} />
      </Field>
    </>
  );
}

export function ScoutingPage({ parts }: { parts: string[] }) {
  const kind: Kind = parts[1] === 'judge' || parts[1] === 'tournament' ? parts[1] : 'team';
  const openId = parts[2];
  const [query, setQuery] = useState('');
  const topicId = activeTopic()?.id;
  // Judges are kept across topics; teams and tournaments belong to a season's topic.
  const all = db.scouting.list.value.filter((d) => d.type === kind && (d.type === 'judge' || d.topicId === topicId));
  const shown = searchItems(
    [...all].sort((a, b) => title(a).localeCompare(title(b))),
    query,
    (d) => [
      { text: title(d), weight: 5 },
      { text: JSON.stringify(d), weight: 1 },
    ],
  );
  const open = all.find((d) => d.id === openId);
  const add = () => {
    const d = db.scouting.put(create(kind));
    navigate(`/scouting/${kind}/${d.id}`);
  };
  const remove = async (d: ScoutDoc) => {
    if (!(await confirmDialog({ title: `Delete "${title(d)}"?`, body: 'It can be restored from Settings → Backup for 30 days.', confirm: 'Delete', danger: true }))) return;
    db.scouting.remove(d.id, `Scouting: ${title(d)}`);
    navigate(`/scouting/${kind}`);
  };
  return (
    <div class="page page-wide">
      <div class="page-head">
        <div>
          <h1>Scouting</h1>
          <p class="lead">Opponents, judges and tournaments, with your notes and the rounds you have had against them.</p>
        </div>
        <div class="row-tight">
          <Segmented<Kind> ariaLabel="Kind" value={kind} onChange={(k) => navigate(`/scouting/${k}`)} options={(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
          <button class="btn btn-primary" onClick={add}>
            Add
          </button>
        </div>
      </div>
      <div class="library-grid">
        <div>
          <TextInput type="search" value={query} onChange={setQuery} placeholder={`Search ${KIND_LABEL[kind].toLowerCase()}…`} aria-label="Search" />
          <ul class="list library-list">
            {!shown.length && <li class="empty">{all.length ? 'Nothing matches.' : `No ${KIND_LABEL[kind].toLowerCase()} yet.`}</li>}
            {shown.map((d) => (
              <li key={d.id} class={`list-row ${d.id === openId ? 'is-open' : ''}`}>
                <button class="list-main" onClick={() => navigate(`/scouting/${kind}/${d.id}`)}>
                  <span class="list-title">{title(d)}</span>
                  <span class="muted list-meta">
                    {roundsFor(d).length} round{roundsFor(d).length === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          {open ? (
            <div class="card form-grid" key={open.id}>
              {open.type === 'team' && <TeamForm doc={open} />}
              {open.type === 'judge' && <JudgeForm doc={open} />}
              {open.type === 'tournament' && <TournamentForm doc={open} />}
              <PastRounds doc={open} />
              <div class="form-actions">
                <button class="btn btn-danger-quiet" onClick={() => remove(open)}>
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div class="empty">
              Choose one, or press Add.
              <br />
              Useful links: <ExternalLink href="https://opencaselist.com">openCaselist</ExternalLink> (what teams have disclosed) and{' '}
              <ExternalLink href="https://www.tabroom.com">Tabroom</ExternalLink> (pairings, results, judge paradigms).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
