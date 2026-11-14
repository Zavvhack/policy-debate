// The library: every card for the active topic, searchable.

import { useMemo, useRef, useState } from 'preact/hooks';
import { tagText } from '../../core/cards/text';
import { searchItems } from '../../core/search';
import { activeTopic, db } from '../../data/store';
import type { CardSide } from '../../data/schema';
import { navigate } from '../../app/router';
import { confirmDialog, openDialog, Segmented, Select, TextInput, toast, Field, useDebounced } from '../../ui/kit';
import { collectFiles, importedPacks, importMany, removeImportedLibrary, type BulkProgress, type BulkResult } from './bulkImport';
import { blockSearchFields, blockTitle, tFileSearchFields, tFileSide, tFileTitle } from '../blocks/blockService';
import { CardEditor } from '../cards/CardView';
import {
  cardSearchFields,
  cardShortCite,
  cardsToItems,
  checkCard,
  copyItems,
  downloadDocx,
  knownLabels,
  parseLabels,
  readEvidenceFile,
  saveImportedCards,
} from '../cards/cardService';

type SideFilter = 'all' | 'aff' | 'neg';
type KindFilter = 'all' | 'evidence' | 'definition';

/** Ask which side and labels an imported file's cards should get. */
function askImportDetails(fileName: string, count: number, analytics: number): Promise<{ side: CardSide; labels: string[] } | undefined> {
  return openDialog((close) => {
    const Body = () => {
      const [side, setSide] = useState<CardSide>('neg');
      const [labels, setLabels] = useState('');
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            close({ side, labels: parseLabels(labels) });
          }}
        >
          <h2 class="dialog-title">Import {count} card{count === 1 ? '' : 's'}</h2>
          <div class="dialog-body form-grid">
            <p>
              From <strong>{fileName}</strong>. {analytics > 0 && `${analytics} piece${analytics === 1 ? '' : 's'} of text without evidence (analytics) will be skipped.`}
            </p>
            <p class="muted">
              Imported cards are saved exactly as they are in the file and marked <em>"not checked against a source"</em>, because the app has no article to compare them
              with. Check other people's evidence against the original before you read it.
            </p>
            <Field label="Side" group>
              <Segmented
                ariaLabel="Side"
                value={side}
                onChange={setSide}
                options={[
                  { value: 'neg', label: 'Neg', class: 'seg-neg' },
                  { value: 'aff', label: 'Aff', class: 'seg-aff' },
                  { value: 'both', label: 'Both' },
                ]}
              />
            </Field>
            <Field label="Labels for all of them (optional)" hint="Each card also gets the heading it sat under in the file.">
              <TextInput value={labels} onChange={setLabels} placeholder="e.g. Opponent: Lincoln AB, 1AC" />
            </Field>
          </div>
          <div class="dialog-actions">
            <button type="button" class="btn" onClick={() => close()}>
              Cancel
            </button>
            <button type="submit" class="btn btn-primary">
              Import
            </button>
          </div>
        </form>
      );
    };
    return <Body />;
  });
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "Import many files": a whole folder or .zip of evidence files at once. */
function openBulkImport(): void {
  void openDialog<void>((close) => {
    const Body = () => {
      const [unknownSide, setUnknownSide] = useState<CardSide>('both');
      const [stage, setStage] = useState<'pick' | 'opening' | 'running' | 'done'>('pick');
      const [progress, setProgress] = useState<BulkProgress | null>(null);
      const [result, setResult] = useState<BulkResult | null>(null);
      const [ignored, setIgnored] = useState(0);
      const stop = useRef(false);
      const packs = importedPacks();
      const packCards = [...packs.values()].reduce((a, b) => a + b, 0);

      const start = async (e: Event) => {
        const input = e.target as HTMLInputElement;
        const picked = [...(input.files ?? [])];
        input.value = '';
        if (!picked.length) return;
        stop.current = false;
        setStage('opening');
        try {
          const { files, ignored: skippedFiles } = await collectFiles(picked);
          setIgnored(skippedFiles);
          if (!files.length) {
            setStage('pick');
            toast('No .docx files were found in what you picked.', { kind: 'error', ms: 7000 });
            return;
          }
          setStage('running');
          const res = await importMany(files, { unknownSide, onProgress: setProgress, cancelled: () => stop.current });
          setResult(res);
          setStage('done');
        } catch (err) {
          setStage('pick');
          toast(err instanceof Error ? err.message : String(err), { kind: 'error', ms: 9000 });
        }
      };

      const removeAll = async () => {
        const yes = await confirmDialog({
          title: `Remove ${plural(packCards, 'imported card')}?`,
          body: 'This removes the cards that came in with "Import many files", so you can import them again. They do not go to the trash, but you can bring them back by importing the same files. Cards you edited or put in a block are kept.',
          confirm: 'Remove them',
          danger: true,
        });
        if (!yes) return;
        const { removed, kept } = await removeImportedLibrary();
        toast(`Removed ${plural(removed, 'card')}.${kept ? ` Kept ${plural(kept, 'card')} you edited or used in a block.` : ''}`, { kind: 'success', ms: 7000 });
        close();
      };

      const busy = stage === 'opening' || stage === 'running';
      const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
      return (
        <>
          <h2 class="dialog-title">Import many files</h2>
          <div class="dialog-body form-grid">
            {stage === 'pick' && (
              <>
                <p>
                  Pick a <strong>.zip</strong> file, a whole <strong>folder</strong>, or lots of <strong>.docx</strong> files at once. Every card in them is added to the
                  library.
                </p>
                <p class="muted">
                  A file named like <em>Econ DA - Neg - DDI 2026.docx</em> gets its side from the name (Aff, Neg, or General for both), and the argument and the folder it
                  is in become labels you can filter by. Files you already imported are skipped, so it is safe to run again.
                </p>
                <Field label="Side for files whose name does not say" group>
                  <Segmented
                    ariaLabel="Side for files whose name does not say"
                    value={unknownSide}
                    onChange={setUnknownSide}
                    options={[
                      { value: 'neg', label: 'Neg', class: 'seg-neg' },
                      { value: 'aff', label: 'Aff', class: 'seg-aff' },
                      { value: 'both', label: 'Both' },
                    ]}
                  />
                </Field>
                <div class="row-tight">
                  <label class="btn btn-primary">
                    Choose a .zip or .docx files…
                    <input type="file" class="sr-only" accept=".zip,.docx" multiple onChange={start} data-testid="bulk-files" />
                  </label>
                  <label class="btn">
                    Choose a folder…
                    <input type="file" class="sr-only" {...{ webkitdirectory: '' }} multiple onChange={start} data-testid="bulk-folder" />
                  </label>
                </div>
                {packCards > 0 && (
                  <p class="muted">
                    Already imported: {plural(packs.size, 'file')}, {plural(packCards, 'card')}.{' '}
                    <button type="button" class="btn btn-quiet" onClick={removeAll}>
                      Remove them…
                    </button>
                  </p>
                )}
              </>
            )}
            {stage === 'opening' && <p>Opening what you picked…</p>}
            {stage === 'running' && progress && (
              <>
                <p>
                  File {Math.min(progress.done + 1, progress.total).toLocaleString()} of {progress.total.toLocaleString()} · {plural(progress.cards, 'card')} so far
                </p>
                <progress class="bulk-progress" max={100} value={pct} aria-label="Import progress" />
                <p class="muted bulk-current">{progress.current}</p>
                <p class="muted">You can keep this open in the background. Big libraries take a few minutes.</p>
              </>
            )}
            {stage === 'done' && result && (
              <div data-testid="bulk-result">
                <p>
                  <strong>
                    {result.cancelled ? 'Stopped. ' : 'Done. '}
                    Added {plural(result.cards, 'card')} from {plural(result.files, 'file')}.
                  </strong>
                </p>
                {result.skipped.length > 0 && <p class="muted">{plural(result.skipped.length, 'file was', 'files were')} already in the library, so skipped.</p>}
                {ignored > 0 && <p class="muted">{plural(ignored, 'file')} that {ignored === 1 ? 'is not a .docx was' : 'are not .docx were'} ignored.</p>}
                {result.empty.length > 0 && (
                  <details>
                    <summary>{plural(result.empty.length, 'file')} had no cards (only headings or notes)</summary>
                    <ul class="bulk-list">
                      {result.empty.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {result.failed.length > 0 && (
                  <details open>
                    <summary>{plural(result.failed.length, 'file')} could not be read</summary>
                    <ul class="bulk-list">
                      {result.failed.map((f) => (
                        <li key={f.name}>
                          {f.name}: {f.error}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <p class="muted">
                  Imported cards are marked "not checked against a source". Use the Label menu to see one argument or folder at a time.
                </p>
              </div>
            )}
          </div>
          <div class="dialog-actions">
            {stage === 'running' ? (
              <button type="button" class="btn" onClick={() => (stop.current = true)}>
                Stop
              </button>
            ) : (
              <button type="button" class={`btn ${stage === 'done' ? 'btn-primary' : ''}`} disabled={busy} onClick={() => close()}>
                {stage === 'done' ? 'Done' : 'Cancel'}
              </button>
            )}
          </div>
        </>
      );
    };
    return <Body />;
  }, false);
}

export function LibraryPage({ openId }: { openId?: string }) {
  const topic = activeTopic();
  const [query, setQuery] = useState('');
  const [side, setSide] = useState<SideFilter>('all');
  const [kind, setKind] = useState<KindFilter>('all');
  const [label, setLabel] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const all = db.cards.list.value;
  const mine = useMemo(() => all.filter((c) => c.topicId === topic?.id).sort((a, b) => b.createdAt - a.createdAt), [all, topic?.id]);
  // A big library is searched once you pause typing, so typing never lags.
  const settledQuery = useDebounced(query, mine.length > 3000 ? 250 : 0);
  const shown = useMemo(() => {
    const filtered = mine.filter(
      (c) => (side === 'all' || c.side === side || c.side === 'both') && (kind === 'all' || c.kind === kind) && (!label || c.labels.includes(label)),
    );
    return searchItems(filtered, settledQuery, cardSearchFields);
  }, [mine, side, kind, label, settledQuery]);
  // The same search also looks through blocks and T files, so the library is one place to find anything.
  const allBlocks = db.blocks.list.value;
  const allTFiles = db.tfiles.list.value;
  const others = useMemo(() => {
    if (!settledQuery.trim()) return [];
    const blocks = searchItems(allBlocks.filter((b) => b.topicId === topic?.id && (side === 'all' || b.side === side)), settledQuery, blockSearchFields).map((b) => ({
      key: b.id,
      kind: 'Block',
      title: blockTitle(b),
      href: `#/blocks/${b.id}`,
      side: b.side,
    }));
    const tfiles = searchItems(allTFiles.filter((f) => f.topicId === topic?.id && (side === 'all' || tFileSide(f) === side)), settledQuery, tFileSearchFields).map((f) => ({
      key: f.id,
      kind: 'T file',
      title: tFileTitle(f),
      href: `#/topicality/files/${f.id}`,
      side: tFileSide(f),
    }));
    return [...blocks, ...tfiles].slice(0, 30);
  }, [allBlocks, allTFiles, topic?.id, side, settledQuery]);
  const open = mine.find((c) => c.id === openId);
  const labels = knownLabels();
  const chosen = shown.filter((c) => picked.has(c.id));
  const target = chosen.length ? chosen : shown;

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const importFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const parsed = await readEvidenceFile(file);
      if (!parsed.cards.length) {
        toast('No cards were found in that file. Cards need a tag in Heading 4 (Verbatim\'s "Tag") with a cite and text under it.', { kind: 'error', ms: 9000 });
        return;
      }
      const details = await askImportDetails(file.name, parsed.cards.length, parsed.outline.filter((o) => o.kind === 'text').length);
      if (!details) return;
      const saved = saveImportedCards(parsed, details.side, details.labels);
      toast(`Imported ${saved.length} card${saved.length === 1 ? '' : 's'}.`, { kind: 'success' });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), { kind: 'error', ms: 9000 });
    }
  };

  const removePicked = async () => {
    if (!chosen.length) return;
    if (!(await confirmDialog({ title: `Delete ${chosen.length} card${chosen.length === 1 ? '' : 's'}?`, body: 'They go to the trash and can be restored for 30 days.', confirm: 'Delete', danger: true }))) return;
    for (const c of chosen) db.cards.remove(c.id, `Card: ${tagText(c.tag).slice(0, 50) || cardShortCite(c)}`);
    setPicked(new Set());
  };

  return (
    <div class="page page-wide">
      <div class="page-head">
        <div>
          <h1>Library</h1>
          <p class="lead">
            {mine.length.toLocaleString()} card{mine.length === 1 ? '' : 's'} for {topic?.name ?? 'this topic'}. Searching here also finds your blocks and T files.
          </p>
        </div>
        <div class="row-tight">
          <button class="btn btn-primary" onClick={() => navigate('/cutter')}>
            Cut a card
          </button>
          <label class="btn">
            Import a .docx file…
            <input type="file" class="sr-only" accept=".docx" onChange={importFile} />
          </label>
          <button class="btn" onClick={openBulkImport}>
            Import many files…
          </button>
        </div>
      </div>

      <div class="library-bar">
        <TextInput type="search" value={query} onChange={setQuery} placeholder='Search tags, cites and text… ("exact phrase")' aria-label="Search the library" />
        <Segmented
          ariaLabel="Side"
          value={side}
          onChange={setSide}
          options={[
            { value: 'all', label: 'All' },
            { value: 'aff', label: 'Aff', class: 'seg-aff' },
            { value: 'neg', label: 'Neg', class: 'seg-neg' },
          ]}
        />
        <Segmented
          ariaLabel="Type"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'evidence', label: 'Evidence' },
            { value: 'definition', label: 'Definitions' },
          ]}
        />
        <Select ariaLabel="Label" value={label} onChange={setLabel} options={[{ value: '', label: 'Any label' }, ...labels.map((l) => ({ value: l, label: l }))]} />
      </div>
      <div class="row-tight library-actions">
        <span class="muted">
          {shown.length} shown{chosen.length ? ` · ${chosen.length} selected` : ''}
        </span>
        <span class="spacer" />
        <button class="btn" disabled={!target.length} onClick={() => copyItems(cardsToItems(target))}>
          Copy {chosen.length ? 'selected' : 'all shown'}
        </button>
        <button class="btn" disabled={!target.length} onClick={() => downloadDocx(label || query || 'Library', cardsToItems(target))}>
          Download .docx
        </button>
        <button class="btn btn-danger-quiet" disabled={!chosen.length} onClick={removePicked}>
          Delete selected
        </button>
      </div>

      <div class="library-grid">
        <ul class="list library-list" aria-label="Cards">
          {!shown.length && !others.length && <li class="empty">{mine.length ? 'Nothing matches.' : 'No cards yet. Cut one, import a .docx evidence file, or use "Import many files" for a whole folder or .zip.'}</li>}
          {shown.slice(0, 400).map((c) => (
            <li key={c.id} class={`list-row ${c.id === openId ? 'is-open' : ''}`}>
              <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${tagText(c.tag) || 'card'}`} />
              <button class="list-main" onClick={() => navigate(`/library/${c.id}`)}>
                <span class={`pill side-${c.side === 'aff' ? 'aff' : c.side === 'neg' ? 'neg' : ''}`}>{c.side === 'both' ? 'Both' : c.side === 'aff' ? 'Aff' : 'Neg'}</span>
                <span class="list-title">{tagText(c.tag) || <span class="muted">(no tag yet)</span>}</span>
                {c.tagDraft && <span class="draft-chip">AI draft</span>}
                {checkCard(c).status === 'mismatch' && <span class="pill pill-bad">does not match source</span>}
                <span class="muted list-meta">
                  {cardShortCite(c)}
                  {c.kind === 'definition' ? ` · defines "${c.term}"` : ''}
                  {c.labels.length ? ` · ${c.labels.join(', ')}` : ''}
                </span>
              </button>
            </li>
          ))}
          {shown.length > 400 && <li class="empty">Showing the first 400. Search or filter to narrow it down.</li>}
          {others.map((o) => (
            <li key={o.key} class="list-row">
              <a class="list-main" href={o.href}>
                <span class={`pill side-${o.side}`}>{o.kind}</span>
                <span class="list-title">{o.title}</span>
                <span class="muted list-meta">Opens on its own page</span>
              </a>
            </li>
          ))}
        </ul>
        <div class="library-detail">
          {open ? (
            <CardEditor
              key={open.id}
              card={open}
              detailsOpen
              onChange={(c) => db.cards.put(c, 200)}
              actions={
                <>
                  <button class="btn btn-quiet" onClick={() => copyItems(cardsToItems([open]))}>
                    Copy
                  </button>
                  <button class="btn btn-quiet" onClick={() => downloadDocx(`${cardShortCite(open) || 'Card'}`, cardsToItems([open]))}>
                    .docx
                  </button>
                  <button
                    class="btn btn-quiet"
                    onClick={() => {
                      db.cards.remove(open.id, `Card: ${tagText(open.tag).slice(0, 50) || cardShortCite(open)}`);
                      navigate('/library');
                      toast('Card deleted. You can restore it from Settings → Backup.');
                    }}
                  >
                    Delete
                  </button>
                </>
              }
            />
          ) : (
            <div class="empty">Choose a card to read or edit it.</div>
          )}
        </div>
      </div>
    </div>
  );
}
