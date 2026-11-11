// Speech doc view for Round Mode: read-only access to your OWN prepared files.
//
// Nothing here can generate text. You can search, read, copy for evidence
// exchange, and build a speech doc out of things you prepared. The only thing
// you can type is the blanks of your preset templates, and that is by hand.
// (This file must not import anything from src/ai except the lock - a test checks.)

import { useMemo, useState } from 'preact/hooks';
import { tagText } from '../../core/cards/text';
import type { DocItem } from '../../core/docx/write';
import { searchItems } from '../../core/search';
import { db } from '../../data/store';
import type { Round } from '../../data/schema';
import { Segmented, TextInput } from '../../ui/kit';
import { CardBody } from '../cards/CardView';
import { cardSearchFields, cardShortCite, cardsToItems, copyItems, downloadDocx, highlightSide } from '../cards/cardService';
import { roundDocSources, type RoundDocEntry } from './roundDocSources';

type Filter = 'all' | 'card' | 'block' | 'tfile';

export function RoundDocs({ round, onFills }: { round: Round; onFills: (fills: Round['fills']) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** Keys of the things added to the speech doc, in reading order. */
  const [speech, setSpeech] = useState<string[]>([]);

  const cards = db.cards.list.value;
  const blocks = db.blocks.list.value;
  const tfiles = db.tfiles.list.value;
  const entries = useMemo<RoundDocEntry[]>(() => {
    const out: RoundDocEntry[] = [];
    for (const c of cards) {
      if (c.topicId !== round.topicId) continue;
      out.push({
        key: `card:${c.id}`,
        type: 'card',
        title: tagText(c.tag) || '(no tag)',
        sub: [cardShortCite(c), ...c.labels].filter(Boolean).join(' · '),
        side: c.side,
        fields: cardSearchFields(c),
        items: () => cardsToItems([c]),
        render: () => <CardBody card={c} side={highlightSide(c)} />,
      });
    }
    out.push(...roundDocSources(round, onFills));
    return out;
    // blocks and tfiles are listed so the view refreshes if they change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, blocks, tfiles, round.topicId, round.fills]);

  const shown = useMemo(() => {
    const filtered = entries.filter((e) => filter === 'all' || e.type === filter);
    // With no search, put this round's own side first.
    const ordered = query.trim() ? filtered : [...filtered].sort((a, b) => Number(b.side === round.meta.side) - Number(a.side === round.meta.side));
    return searchItems(ordered, query, (e) => e.fields).slice(0, 200);
  }, [entries, filter, query, round.meta.side]);

  const open = entries.find((e) => e.key === openKey) ?? null;
  const speechEntries = speech.map((k) => entries.find((e) => e.key === k)).filter((e): e is RoundDocEntry => !!e);
  const speechItems = (): DocItem[] => speechEntries.flatMap((e) => e.items());
  const inSpeech = (key: string) => speech.includes(key);
  const toggleSpeech = (key: string) => setSpeech((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  const move = (key: string, dir: -1 | 1) =>
    setSpeech((s) => {
      const list = [...s];
      const at = list.indexOf(key);
      const to = at + dir;
      if (at < 0 || to < 0 || to >= list.length) return s;
      [list[at], list[to]] = [list[to], list[at]];
      return list;
    });

  return (
    <div class="round-docs">
      <div class="docs-list">
        <div class="docs-search">
          <TextInput type="search" value={query} onChange={setQuery} placeholder="Search your files…" aria-label="Search your prepared files" />
          <Segmented
            ariaLabel="Kind of file"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'card', label: 'Cards' },
              { value: 'block', label: 'Blocks' },
              { value: 'tfile', label: 'T' },
            ]}
          />
        </div>
        <ul class="list">
          {!shown.length && <li class="empty">{entries.length ? 'Nothing matches.' : 'Nothing prepared for this topic yet. Cards, blocks and T files you save in Prep appear here.'}</li>}
          {shown.map((e) => (
            <li key={e.key} class={`list-row ${e.key === openKey ? 'is-open' : ''}`}>
              <button class="list-main" onClick={() => setOpenKey(e.key)}>
                <span class={`pill ${e.side === 'aff' ? 'side-aff' : e.side === 'neg' ? 'side-neg' : ''}`}>{e.type === 'card' ? 'Card' : e.type === 'block' ? 'Block' : 'T'}</span>
                <span class="list-title">{e.title}</span>
                <span class="muted list-meta">{e.sub}</span>
              </button>
              <button class="btn btn-quiet" onClick={() => toggleSpeech(e.key)} aria-pressed={inSpeech(e.key)} title="Add to or remove from the speech doc">
                {inSpeech(e.key) ? '✓ In speech' : '+ Speech'}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div class="docs-view">
        {speechEntries.length > 0 && (
          <section class="speech-doc" aria-label="Speech doc">
            <div class="row-tight">
              <strong>Speech doc</strong>
              <span class="muted">
                {speechEntries.length} item{speechEntries.length === 1 ? '' : 's'}
              </span>
              <span class="spacer" />
              <button class="btn" onClick={() => copyItems(speechItems())}>
                Copy
              </button>
              <button class="btn" onClick={() => downloadDocx(`${round.name} speech`, speechItems())}>
                Download .docx
              </button>
              <button class="btn btn-quiet" onClick={() => setSpeech([])}>
                Clear
              </button>
            </div>
            <ol class="speech-list">
              {speechEntries.map((e) => (
                <li key={e.key}>
                  <button class="link" onClick={() => setOpenKey(e.key)}>
                    {e.title}
                  </button>
                  <span class="row-tight">
                    <button class="icon-btn" onClick={() => move(e.key, -1)} aria-label="Move up">
                      ↑
                    </button>
                    <button class="icon-btn" onClick={() => move(e.key, 1)} aria-label="Move down">
                      ↓
                    </button>
                    <button class="icon-btn" onClick={() => toggleSpeech(e.key)} aria-label="Remove from the speech doc">
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {open ? (
          <section class="doc-open">
            <div class="row-tight doc-open-bar">
              <strong>{open.title}</strong>
              <span class="spacer" />
              <button class="btn" onClick={() => copyItems(open.items())}>
                Copy
              </button>
              <button class="btn" onClick={() => toggleSpeech(open.key)}>
                {inSpeech(open.key) ? 'Remove from speech doc' : 'Add to speech doc'}
              </button>
            </div>
            {open.render()}
          </section>
        ) : (
          <div class="empty">Choose a file on the left to read it. Everything here is something you prepared; nothing is generated during a round.</div>
        )}
      </div>
    </div>
  );
}
