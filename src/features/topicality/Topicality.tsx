// The Topicality center. Everything here is built on the ACTIVE TOPIC: its
// exact wording, its key terms, and your definitions for them.
//
//   Files        negative shells and affirmative answers, with 2NC/1NR/2NR/1AR/2AR extensions
//   Definitions  your definition cards, grouped by the word they define (cut with the card cutter,
//                so the verbatim protection applies)
//   Plan check   paste a plan text: likely T arguments against it, and the aff's best answers
//   Drills       practise 2NR and 2AR topicality speeches, with feedback

import { useMemo, useState } from 'preact/hooks';
import { aiAnalyzePlan, aiTAnswers, aiTExtension, aiTShell } from '../../ai/tasks';
import { formatUsd } from '../../ai/pricing';
import { unverifiedQuotes } from '../../core/ai/quotes';
import { tagText } from '../../core/cards/text';
import type { SpeechId } from '../../core/debate/formats';
import { newId } from '../../core/ids';
import { activeTopic, db } from '../../data/store';
import type { Card, Drill, TFile, TSection, TSectionRole } from '../../data/schema';
import { navigate } from '../../app/router';
import { confirmDialog, Field, Segmented, Select, TextArea, TextInput, toast } from '../../ui/kit';
import { AiButton, AiDraftNote, AiSection, AiStatus, AiText, useAi } from '../ai/AiUi';
import { aiMode } from '../ai/availability';
import { pickCard } from '../blocks/Blocks';
import { ANSWER_ROLES, newTFile, ROLE_LABEL, SHELL_ROLES, tFileTitle, tFileToItems, tFileToText } from '../blocks/blockService';
import { CardBody, VerifyBadge } from '../cards/CardView';
import { cardCiteText, cardShortCite, copyItems, downloadDocx, highlightSide } from '../cards/cardService';
import { cutterPreset } from '../cutter/Cutter';
import { DrillBox, DrillHistory, type DrillSpec } from '../practice/DrillBox';

type Tab = 'files' | 'definitions' | 'plan' | 'drills';

const STANDARD_IDEAS = ['Limits', 'Ground', 'Predictability', 'Precision', 'Education', 'Bright line', 'Topic literature', 'Extra-topicality', 'Effects topicality'];
const VOTER_IDEAS = ['Fairness', 'Education', 'Jurisdiction'];
const OFFENSE_IDEAS = ['Their interpretation overlimits', 'Aff ground', 'Arbitrary / no intent to define', 'Topic education', 'Functional limits check'];
const SHELL_EXT: SpeechId[] = ['2NC', '1NR', '2NR'];
const ANSWER_EXT: SpeechId[] = ['1AR', '2AR'];

function definitionsFor(term: string): Card[] {
  const topicId = activeTopic()?.id;
  const t = term.trim().toLowerCase();
  return db.cards.list.value.filter((c) => c.topicId === topicId && c.kind === 'definition' && (!t || c.term.trim().toLowerCase() === t));
}

function SectionEditor({ file, section, onChange, onRemove, onMove }: { file: TFile; section: TSection; onChange: (patch: Partial<TSection>) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void }) {
  const card = db.cards.get(section.cardId);
  const takesCard = section.role === 'interp' || section.role === 'counter-interp';
  return (
    <div class={`t-section ${section.on ? '' : 'is-off'} ${section.draft ? 'is-draft' : ''}`}>
      <div class="row-tight">
        <input type="checkbox" checked={section.on} onChange={(e) => onChange({ on: (e.target as HTMLInputElement).checked })} aria-label={`Include ${section.title || ROLE_LABEL[section.role]}`} title="Untick to keep this in the file but leave it out when you read or export it" />
        <TextInput value={section.title} onChange={(title) => onChange({ title })} placeholder={ROLE_LABEL[section.role]} aria-label="Name" />
        {section.role === 'extension' && (
          <Select
            ariaLabel="Speech"
            value={section.speech ?? (file.type === 'shell' ? '2NR' : '2AR')}
            onChange={(speech) => onChange({ speech })}
            options={(file.type === 'shell' ? SHELL_EXT : ANSWER_EXT).map((s) => ({ value: s, label: s }))}
          />
        )}
        <span class="item-tools">
          <button class="icon-btn" onClick={() => onMove(-1)} aria-label="Move up">
            ↑
          </button>
          <button class="icon-btn" onClick={() => onMove(1)} aria-label="Move down">
            ↓
          </button>
          <button class="icon-btn" onClick={onRemove} aria-label="Remove">
            ×
          </button>
        </span>
      </div>
      <TextArea rows={section.role === 'extension' ? 6 : 3} value={section.text} onChange={(text) => onChange({ text, draft: false })} ariaLabel={section.title || ROLE_LABEL[section.role]} placeholder={placeholderFor(section.role)} />
      {section.draft && (
        <div class="row-tight">
          <span class="draft-chip">AI draft — check it</span>
          <button class="link" onClick={() => onChange({ draft: false })}>
            I have checked this
          </button>
        </div>
      )}
      {takesCard && (
        <div class="t-card">
          {card ? (
            <details>
              <summary>
                Definition card: <strong>{tagText(card.tag) || cardShortCite(card)}</strong> <span class="muted">· {cardShortCite(card)}</span>
              </summary>
              <VerifyBadge card={card} />
              <CardBody card={card} side={highlightSide(card, file.type === 'shell' ? 'neg' : 'aff')} />
            </details>
          ) : (
            <span class="warn-text">No definition card yet. An interpretation needs evidence behind it.</span>
          )}
          <span class="row-tight">
            <button
              class="btn"
              onClick={async () => {
                const id = await pickCard((c) => c.kind === 'definition');
                if (id) onChange({ cardId: id });
              }}
            >
              {card ? 'Change' : 'Choose a definition'}
            </button>
            {card && (
              <button class="btn btn-quiet" onClick={() => onChange({ cardId: undefined })}>
                Remove
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function placeholderFor(role: TSectionRole): string {
  switch (role) {
    case 'interp':
      return 'What the word means, in one sentence, matching your definition card.';
    case 'violation':
      return 'What the plan does, and why that is not what the word means.';
    case 'standard':
      return 'Why your interpretation is better for debate. Be specific to this topic.';
    case 'voter':
      return 'Why topicality decides the round.';
    case 'we-meet':
      return 'Why the plan meets their interpretation.';
    case 'counter-interp':
      return 'Your own interpretation of the word, which the plan meets.';
    case 'reasonability':
      return 'Why the judge should ask "is the aff reasonably topical?" rather than pick the single best interpretation.';
    case 'offense':
      return 'Why their interpretation is bad for debate.';
    default:
      return 'The words you will read.';
  }
}

function FileEditor({ file }: { file: TFile }) {
  const ai = useAi();
  const topic = activeTopic();
  const save = (patch: Partial<TFile>, delay = 250) => db.tfiles.put({ ...file, ...patch }, delay);
  const setSection = (id: string, patch: Partial<TSection>) => save({ sections: file.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const add = (role: TSectionRole, title: string, extra: Partial<TSection> = {}) => save({ sections: [...file.sections, { id: newId(), role, title, text: '', on: true, ...extra }] }, 0);
  const move = (id: string, dir: -1 | 1) => {
    // Move within the same group only.
    const s = file.sections.find((x) => x.id === id)!;
    const group = file.sections.filter((x) => x.role === s.role);
    const at = group.indexOf(s);
    const swap = group[at + dir];
    if (!swap) return;
    const sections = [...file.sections];
    const a = sections.indexOf(s);
    const b = sections.indexOf(swap);
    [sections[a], sections[b]] = [sections[b], sections[a]];
    save({ sections }, 0);
  };
  const roles = file.type === 'shell' ? SHELL_ROLES : ANSWER_ROLES;
  const interpCard = db.cards.get(file.sections.find((s) => (s.role === 'interp' || s.role === 'counter-interp') && s.cardId)?.cardId);
  const definitionText = interpCard ? `${tagText(interpCard.tag)}\n${cardCiteText(interpCard)}\n${interpCard.text}` : '';

  const draft = () =>
    ai.run(async (signal) => {
      const out =
        file.type === 'shell'
          ? await aiTShell({ topic, term: file.term, plan: file.about, definition: definitionText, signal })
          : await aiTAnswers({ topic, term: file.term, plan: file.about, theirShell: file.notes, signal });
      const fresh: TSection[] = out.sections.map((s) => ({ id: newId(), role: s.role as TSectionRole, title: s.title, text: s.text, on: true, draft: true }));
      // Fill empty sections of the same kind first; add the rest as new sections.
      const sections = file.sections.map((s) => ({ ...s }));
      for (const f of fresh) {
        const empty = sections.find((s) => s.role === f.role && !s.text.trim() && !s.draft);
        if (empty) Object.assign(empty, { text: f.text, title: f.role === 'standard' || f.role === 'voter' || f.role === 'offense' ? f.title || empty.title : empty.title, draft: true });
        else sections.push(f);
      }
      save({ sections }, 0);
      toast(`Draft added (${formatUsd(out.usd)}). Every AI section is marked until you edit or confirm it.`, { kind: 'success', ms: 7000 });
    });

  const extend = (speech: SpeechId) =>
    ai.run(async (signal) => {
      const out = await aiTExtension({ topic, speech, fileText: tFileToText(file), signal });
      add('extension', `${speech} extension`, { speech, text: out.text, draft: true });
      toast(`${speech} extension drafted (${formatUsd(out.usd)}).`, { kind: 'success' });
    });

  const drafts = file.sections.filter((s) => s.draft).length;
  const ideas: Partial<Record<TSectionRole, string[]>> = { standard: STANDARD_IDEAS, voter: VOTER_IDEAS, offense: OFFENSE_IDEAS };

  return (
    <div class="form-grid">
      <div class="card form-grid">
        <div class="row">
          <Field label="Word or phrase">
            <TextInput value={file.term} onChange={(term) => save({ term })} list="topic-terms" placeholder="e.g. establish" />
          </Field>
          <Field label={file.type === 'shell' ? 'Run against (their plan or case)' : 'Our plan'}>
            <TextInput value={file.about} onChange={(about) => save({ about })} placeholder={file.type === 'shell' ? 'e.g. Medicaid expansion affs' : 'Plan text or short description'} />
          </Field>
        </div>
        <Field label="Title (optional)">
          <TextInput value={file.title} onChange={(title) => save({ title })} placeholder={tFileTitle({ ...file, title: '' })} />
        </Field>
        {file.type === 'answers' && (
          <Field label="Their shell, as flowed or pasted (optional)" hint="Used when AI drafts answers, so they respond to what the other team actually says.">
            <TextArea rows={3} value={file.notes} onChange={(notes) => save({ notes })} />
          </Field>
        )}
        <datalist id="topic-terms">
          {(topic?.keyTerms ?? []).map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <div class="row-tight">
          <button class="btn" onClick={() => copyItems(tFileToItems(file))}>
            Copy
          </button>
          <button class="btn" onClick={() => downloadDocx(tFileTitle(file), tFileToItems(file))}>
            Download .docx
          </button>
          <span class="spacer" />
          <AiButton ai={ai} onRun={draft} tier="strong" promptChars={2500 + definitionText.length + file.about.length + file.notes.length} outputTokens={1400} disabled={!file.term.trim()}>
            {file.type === 'shell' ? 'Draft the shell' : 'Draft the answers'}
          </AiButton>
        </div>
        <AiStatus ai={ai} />
        {drafts > 0 && <AiDraftNote>{drafts} section{drafts === 1 ? ' is' : 's are'} marked as AI drafts. Check the reasoning and put it in your own words. AI never supplies definitions: those come from your library.</AiDraftNote>}
      </div>

      {roles.map((role) => {
        const secs = file.sections.filter((s) => s.role === role);
        const unused = (ideas[role] ?? []).filter((name) => !secs.some((s) => s.title.toLowerCase() === name.toLowerCase()));
        return (
          <section key={role} class="card t-group">
            <h3>{ROLE_LABEL[role]}</h3>
            {secs.map((s) => (
              <SectionEditor key={s.id} file={file} section={s} onChange={(patch) => setSection(s.id, patch)} onRemove={() => save({ sections: file.sections.filter((x) => x.id !== s.id) }, 0)} onMove={(dir) => move(s.id, dir)} />
            ))}
            <div class="row-tight">
              {role === 'extension' ? (
                (file.type === 'shell' ? SHELL_EXT : ANSWER_EXT).map((sp) => (
                  <span key={sp} class="row-tight">
                    <button class="chip-btn" onClick={() => add('extension', `${sp} extension`, { speech: sp })}>
                      + {sp} block
                    </button>
                    <button class="chip-btn" onClick={() => extend(sp)} disabled={ai.busy} title="Draft it with AI from the rest of this file">
                      ✦ draft {sp}
                    </button>
                  </span>
                ))
              ) : unused.length ? (
                unused.map((name) => (
                  <button key={name} class="chip-btn" onClick={() => add(role, name)}>
                    + {name}
                  </button>
                ))
              ) : (
                <button class="chip-btn" onClick={() => add(role, '')}>
                  + Another
                </button>
              )}
              {(ideas[role] ?? []).length > 0 && unused.length > 0 && (
                <button class="chip-btn" onClick={() => add(role, '')}>
                  + Other
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FilesTab({ openId }: { openId?: string }) {
  const topic = activeTopic();
  const files = db.tfiles.list.value.filter((f) => f.topicId === topic?.id).sort((a, b) => b.updatedAt - a.updatedAt);
  const open = files.find((f) => f.id === openId);
  const create = (type: TFile['type']) => {
    const f = db.tfiles.put(newTFile(type, ''));
    navigate(`/topicality/files/${f.id}`);
  };
  const remove = async (f: TFile) => {
    if (!(await confirmDialog({ title: `Delete "${tFileTitle(f)}"?`, body: 'It can be restored from Settings → Backup for 30 days.', confirm: 'Delete', danger: true }))) return;
    db.tfiles.remove(f.id, `T file: ${tFileTitle(f)}`);
    navigate('/topicality');
  };
  return (
    <div class="library-grid">
      <div>
        <div class="row-tight add-row">
          <button class="btn btn-primary" onClick={() => create('shell')}>
            New neg shell
          </button>
          <button class="btn" onClick={() => create('answers')}>
            New aff answers
          </button>
        </div>
        <ul class="list library-list">
          {!files.length && <li class="empty">No T files yet. Start a negative shell or a set of affirmative answers.</li>}
          {files.map((f) => (
            <li key={f.id} class={`list-row ${f.id === openId ? 'is-open' : ''}`}>
              <button class="list-main" onClick={() => navigate(`/topicality/files/${f.id}`)}>
                <span class={`pill side-${f.type === 'shell' ? 'neg' : 'aff'}`}>{f.type === 'shell' ? 'Neg shell' : 'Aff answers'}</span>
                <span class="list-title">{tFileTitle(f)}</span>
                <span class="muted list-meta">{f.sections.filter((s) => s.text.trim()).length} sections written</span>
              </button>
              <button class="btn btn-quiet" onClick={() => remove(f)} aria-label={`Delete ${tFileTitle(f)}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>{open ? <FileEditor key={open.id} file={open} /> : <div class="empty">Choose a file, or start a new one.</div>}</div>
    </div>
  );
}

function DefinitionsTab() {
  const topic = activeTopic();
  const all = definitionsFor('');
  const terms = topic?.keyTerms ?? [];
  const known = new Set(terms.map((t) => t.toLowerCase()));
  const otherTerms = [...new Set(all.map((c) => c.term.trim()).filter((t) => t && !known.has(t.toLowerCase())))];
  const untagged = all.filter((c) => !c.term.trim());
  const cut = (term: string) => {
    cutterPreset.value = { kind: 'definition', term };
    navigate('/cutter');
  };
  const group = (term: string, cards: Card[]) => (
    <section key={term} class="card def-group">
      <div class="row-tight">
        <h3>“{term}”</h3>
        <span class="muted">
          {cards.length} definition{cards.length === 1 ? '' : 's'}
        </span>
        <span class="spacer" />
        <button class="btn" onClick={() => cut(term)}>
          Cut a definition
        </button>
      </div>
      {cards.map((c) => (
        <details key={c.id} class="def-card">
          <summary>
            <span class={`pill ${c.side === 'aff' ? 'side-aff' : c.side === 'neg' ? 'side-neg' : ''}`}>{c.side === 'both' ? 'Both' : c.side === 'aff' ? 'Aff' : 'Neg'}</span>{' '}
            <strong>{tagText(c.tag) || '(no tag)'}</strong> <span class="muted">· {cardShortCite(c)}</span>
          </summary>
          <div class="row-tight">
            <VerifyBadge card={c} />
            <button class="link" onClick={() => navigate(`/library/${c.id}`)}>
              Edit in the library
            </button>
          </div>
          <CardBody card={c} side={highlightSide(c)} />
          <p class="field-hint">Full cite: {cardCiteText(c) || '(none yet)'}</p>
        </details>
      ))}
    </section>
  );
  return (
    <div>
      <p class="lead">
        One group for each word or phrase of the resolution. Definitions are ordinary cards cut with the card cutter, so they carry a full cite and are checked word for word
        against their source. Change the list of terms in <a class="link" href="#/settings/topics">Settings → Topics</a>.
      </p>
      <p class="resolution-line">{topic?.resolution}</p>
      {terms.map((t) => group(t, definitionsFor(t)))}
      {otherTerms.map((t) => group(t, definitionsFor(t)))}
      {untagged.length > 0 && group('(no term set)', untagged)}
    </div>
  );
}

function PlanTab() {
  const ai = useAi();
  const [plan, setPlan] = useState('');
  const [result, setResult] = useState<{ text: string; bad: string[] } | null>(null);
  const defs = definitionsFor('');
  const defsText = defs.map((c) => `- "${c.term}" — ${cardShortCite(c)}: ${tagText(c.tag)}\n  ${c.text.slice(0, 500)}`).join('\n');
  const run = () =>
    ai.run(async (signal) => {
      const out = await aiAnalyzePlan({ topic: activeTopic(), plan, definitions: defsText, signal });
      setResult({ text: out.text, bad: unverifiedQuotes(out.text, [plan, defsText, activeTopic()?.resolution ?? '']) });
      toast(`Analysis ready (${formatUsd(out.usd)}).`, { kind: 'success' });
    });
  return (
    <div class="card form-grid">
      <h2>Is this plan topical?</h2>
      <p class="muted">Paste a plan text (yours, or one an opponent disclosed). You get the topicality arguments a negative is likely to run against it, and the affirmative's best answers.</p>
      <AiSection title="Checking a plan against the topic">
      <Field label="Plan text">
        <TextArea rows={4} value={plan} onChange={setPlan} placeholder="The United States federal government should …" />
      </Field>
      <AiButton ai={ai} onRun={run} tier="strong" promptChars={plan.length + defsText.length + 2500} outputTokens={2200} disabled={plan.trim().length < 15} primary>
        Analyse topicality
      </AiButton>
      <p class="field-hint">
        Uses the active topic's exact wording and your {defs.length} definition card{defs.length === 1 ? '' : 's'}. The AI is told not to invent sources; any quote it gives that is not in your material is
        flagged.
      </p>
      <AiStatus ai={ai} />
      {result && (
        <>
          <AiText text={result.text} badQuotes={result.bad} />
          <div class="row-tight">
            <button class="btn" onClick={() => copyItems([{ kind: 'text', text: result.text }])}>
              Copy
            </button>
            <button
              class="btn"
              onClick={() => {
                const f = db.tfiles.put({ ...newTFile('answers', ''), about: plan.trim().slice(0, 300), notes: result.text });
                navigate(`/topicality/files/${f.id}`);
              }}
            >
              Start aff answers for this plan
            </button>
          </div>
        </>
      )}
      </AiSection>
    </div>
  );
}

function DrillsTab() {
  const topic = activeTopic();
  const files = db.tfiles.list.value.filter((f) => f.topicId === topic?.id);
  const [fileId, setFileId] = useState(files[0]?.id ?? '');
  const [kind, setKind] = useState<'t-2nr' | 't-2ar'>('t-2nr');
  const [minutes, setMinutes] = useState(5);
  const [past, setPast] = useState<Drill | undefined>();
  const [attempt, setAttempt] = useState(0);
  const file = files.find((f) => f.id === fileId);
  const spec: DrillSpec = useMemo(() => {
    const term = file?.term.trim() || 'the term';
    const fileText = file ? tFileToText(file) : '';
    return kind === 't-2nr'
      ? {
          kind,
          title: `2NR on T: ${term}`,
          prompt: `You are the 2NR and you are going for topicality on "${term}" and nothing else. Assume the 2AC said: we meet, a counter-interpretation, and reasonability, and the 1AR extended all three. Extend your interpretation with its definition, explain the violation, answer the we-meet and the counter-interpretation, win one or two standards and compare them with theirs, and tell the judge why it is a voting issue. ${minutes} minutes.`,
          context: fileText,
          seconds: minutes * 60,
        }
      : {
          kind,
          title: `2AR on T: ${term}`,
          prompt: `You are the 2AR and the 2NR went for topicality on "${term}" and nothing else: interpretation, violation, limits and ground, competing interpretations, voting issue. Give the 2AR: we meet, your counter-interpretation, why it is better for debate, reasonability, and why there was no abuse in this round. ${minutes} minutes.`,
          context: fileText,
          seconds: minutes * 60,
        };
  }, [file, kind, minutes]);
  return (
    <div class="form-grid">
      <div class="card form-grid">
        <h2>T drills</h2>
        <div class="row">
          <Field label="Speech" group>
            <Segmented
              ariaLabel="Speech"
              value={kind}
              onChange={setKind}
              options={[
                { value: 't-2nr', label: '2NR on T', class: 'seg-neg' },
                { value: 't-2ar', label: '2AR on T', class: 'seg-aff' },
              ]}
            />
          </Field>
          <Field label="Work from this file">
            <Select value={fileId} onChange={setFileId} options={[{ value: '', label: '(no file: speak from memory)' }, ...files.map((f) => ({ value: f.id, label: tFileTitle(f) }))]} />
          </Field>
          <Field label="Minutes" class="field-small">
            <Select value={String(minutes)} onChange={(v) => setMinutes(Number(v))} options={['2', '3', '5', '6'].map((m) => ({ value: m, label: m }))} />
          </Field>
        </div>
        <DrillBox key={`${kind}-${fileId}-${minutes}-${attempt}-${past?.id ?? ''}`} spec={past ? { ...spec, kind: past.kind, title: past.title, prompt: past.prompt } : spec} existing={past} />
        {past && (
          <button class="btn" onClick={() => (setPast(undefined), setAttempt((a) => a + 1))}>
            Start a fresh attempt
          </button>
        )}
      </div>
      <DrillHistory kinds={['t-2nr', 't-2ar']} onOpen={setPast} />
    </div>
  );
}

export function TopicalityPage({ parts }: { parts: string[] }) {
  const tab: Tab = parts[1] === 'definitions' || parts[1] === 'plan' || parts[1] === 'drills' ? parts[1] : 'files';
  const topic = activeTopic();
  return (
    <div class="page page-wide">
      <div class="page-head">
        <div>
          <h1>Topicality</h1>
          <p class="lead">{topic ? topic.resolution : 'No topic is set.'}</p>
        </div>
        <Segmented<Tab>
          ariaLabel="Topicality section"
          value={tab}
          onChange={(t) => navigate(t === 'files' ? '/topicality' : `/topicality/${t}`)}
          options={[
            { value: 'files', label: 'Shells & answers' },
            { value: 'definitions', label: 'Definitions' },
            ...(aiMode() === 'hidden' ? [] : [{ value: 'plan' as const, label: 'Is this plan topical? ✦' }]),
            { value: 'drills', label: 'Drills' },
          ]}
        />
      </div>
      {tab === 'files' && <FilesTab openId={parts[1] === 'files' ? parts[2] : undefined} />}
      {tab === 'definitions' && <DefinitionsTab />}
      {tab === 'plan' && <PlanTab />}
      {tab === 'drills' && <DrillsTab />}
    </div>
  );
}
