// The list of Prep screens. Adding a screen = adding a line here.
//
// Prep screens are the only place AI features may appear. They are never
// rendered while Round Mode is on (see App.tsx).

import type { ComponentChildren } from 'preact';
import { CutterPage } from '../features/cutter/Cutter';
import { LibraryPage } from '../features/library/Library';
import { BlocksPage } from '../features/blocks/Blocks';
import { TopicalityPage } from '../features/topicality/Topicality';
import { CxPrepPage } from '../features/cxprep/CxPrep';
import { PracticePage } from '../features/practice/Practice';
import { ScoutingPage } from '../features/scouting/Scouting';

export interface PrepPage {
  path: string;
  label: string;
  render: (parts: string[]) => ComponentChildren;
  /** True if the whole page is an AI tool. It is left out of the menu when AI features are hidden. */
  aiOnly?: boolean;
}

export const PREP_PAGES: PrepPage[] = [
  { path: '/cutter', label: 'Card cutter', render: () => <CutterPage /> },
  { path: '/library', label: 'Library', render: (parts) => <LibraryPage openId={parts[1]} /> },
  { path: '/blocks', label: 'Blocks', render: (parts) => <BlocksPage parts={parts} /> },
  { path: '/topicality', label: 'Topicality', render: (parts) => <TopicalityPage parts={parts} /> },
  { path: '/cx', label: 'CX questions', render: () => <CxPrepPage />, aiOnly: true },
  { path: '/practice', label: 'Rebuttal practice', render: (parts) => <PracticePage roundId={parts[1]} /> },
  { path: '/scouting', label: 'Scouting', render: (parts) => <ScoutingPage parts={parts} /> },
];

export function renderPrepPage(parts: string[]): ComponentChildren | null {
  const page = PREP_PAGES.find((p) => p.path === `/${parts[0]}`);
  return page ? page.render(parts) : null;
}
