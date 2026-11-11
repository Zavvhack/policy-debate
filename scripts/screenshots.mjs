// Takes the screenshots used in the README, from the real app.
//
//   npm run build:html
//   node scripts/screenshots.mjs
//
// It opens the built single-file app in a browser, uses it the way a debater
// would (cuts a card, flows part of a round), and saves pictures to
// docs/screenshots/. Everything shown is made up: the article, its author and
// the publication do not exist.

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const APP = pathToFileURL(`${root}dist-html/policy-debate.html`).toString();
const OUT = `${root}docs/screenshots`;
mkdirSync(OUT, { recursive: true });

const ARTICLE = `Why coverage gaps persist
By Dr. Maria Okafor, professor of health policy at Example University
January 28, 2026 — The Example Review

Roughly 26 million Americans remain uninsured. That number is not falling. Subsidies that expired in 2025 pushed premiums up in most states, and enrollment dropped for the first time in a decade.

A single national plan would not eliminate every cost. It would, however, cut administrative spending sharply, because providers would bill one payer under one set of rules instead of hundreds.

Critics answer that the transition would be disruptive. That is true, and it is an argument about how to phase the change in, not about whether coverage gaps close on their own. They do not.`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 2 });
const shot = async (name) => {
  // Close any pop-up messages so they do not cover the screen.
  await page.locator('.toast-x').evaluateAll((buttons) => buttons.forEach((b) => b.click()));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${name}.png` });
};
const go = async (hash) => {
  await page.goto(`${APP}#${hash}`);
  await page.waitForTimeout(250);
};

// --- first launch -----------------------------------------------------------
await page.goto(APP);
await page.getByRole('dialog').waitFor();
await shot('welcome');
await page.getByRole('button', { name: 'Skip' }).click();
await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
await shot('home');

// --- cut two cards by hand ---------------------------------------------------
const selectInSource = (from, to) =>
  page.locator('textarea.source-text').evaluate(
    (el, [a, b]) => {
      const s = el.value.indexOf(a);
      el.focus();
      el.setSelectionRange(s, el.value.indexOf(b, s) + b.length);
    },
    [from, to],
  );
const selectInCard = (from, to) =>
  page
    .locator('.ev-body-edit')
    .first()
    .evaluate(
      (body, [a, b]) => {
        const full = body.textContent ?? '';
        const s = full.indexOf(a);
        const e = full.indexOf(b, s) + b.length;
        const range = document.createRange();
        let seen = 0;
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const len = n.nodeValue.length;
          if (s >= seen && s <= seen + len) range.setStart(n, s - seen);
          if (e >= seen && e <= seen + len) range.setEnd(n, e - seen);
          seen += len;
        }
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        body.focus();
      },
      [from, to],
    );
const mark = async (key, from, to) => {
  await selectInCard(from, to);
  await page.keyboard.press(key);
};

await go('/cutter');
await page.locator('textarea.source-text').fill(ARTICLE);
await page.getByRole('textbox', { name: 'Author first name' }).fill('Maria');
await page.getByRole('textbox', { name: 'Author last name' }).fill('Okafor');
await page.getByRole('textbox', { name: 'Year' }).fill('2026');
await page.getByRole('textbox', { name: 'Date', exact: true }).fill('1/28');
await page.getByRole('textbox', { name: 'Qualifications' }).fill('professor of health policy at Example University');
await page.getByRole('textbox', { name: 'Title' }).fill('Why coverage gaps persist');
await page.getByRole('textbox', { name: 'Publication' }).fill('The Example Review');
await page.getByRole('textbox', { name: 'Cut by' }).fill('AB');
await page.getByRole('radio', { name: 'Aff', exact: true }).click();
await page.getByRole('textbox', { name: /^Tag/ }).fill('Coverage gaps are [[not closing]] on their own');
await page.getByLabel('Labels', { exact: true }).fill('Inherency');
await selectInSource('Roughly 26 million', 'in a decade.');
await page.getByRole('button', { name: 'Cut the selected text by hand' }).click();
await page.locator('.cardbox').first().waitFor();
await mark('u', 'Roughly', 'not falling.');
await mark('h', '26 million Americans remain uninsured.', '26 million Americans remain uninsured.');
await mark('e', 'not falling.', 'not falling.');
await mark('u', 'enrollment dropped', 'in a decade.');
await mark('h', 'enrollment dropped', 'dropped');

await page.getByRole('textbox', { name: /^Tag/ }).fill('A single plan [[cuts administrative costs]]');
await page.getByLabel('Labels', { exact: true }).fill('Solvency');
await selectInSource('A single national plan', 'instead of hundreds.');
await page.getByRole('button', { name: 'Cut the selected text by hand' }).click();
await page.waitForTimeout(200);
await mark('u', 'It would, however,', 'one set of rules');
await mark('h', 'cut administrative spending sharply', 'sharply');
await mark('e', 'one payer', 'one payer');
await page.evaluate(() => getSelection()?.removeAllRanges());
await page.locator('.cardbox').first().scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollTo(0, 0));
await shot('card-cutter');

await go('/library');
await page.locator('.list-main').first().click();
await page.waitForTimeout(250);
await shot('library');

// --- a block from a template ------------------------------------------------
await go('/blocks');
await page.waitForTimeout(200);
await shot('blocks');

// --- a round ------------------------------------------------------------------
await go('/round/new');
await page.getByRole('radio', { name: 'Negative' }).click();
const field = async (name, value) => {
  const box = page.getByRole('textbox', { name });
  if (await box.count()) await box.first().fill(value);
};
await field(/Tournament/, 'Example Invitational');
await field(/Round/, '3');
await field(/Opponent/, 'Riverside CD');
await field(/Judge/, 'J. Rivera');
await shot('start-round');
await page.getByRole('button', { name: /Start round/ }).click();
await page.getByText('Round Mode — AI off').waitFor();

const type = (text) => page.keyboard.type(text);
const press = (key) => page.keyboard.press(key);
await page.getByRole('button', { name: 'New argument in the 1AC' }).click();
await type('Adv 1: coverage — 26m uninsured, not falling');
await press('Tab');
await type('No inherency — states are expanding now');
await press('Tab');
await type('State plans leave gaps — Okafor 26');
await press('Shift+Tab');
await press('Enter');
await type('Alt cause: provider shortages');
await press('Shift+Tab');
await press('Control+Enter');
await type('Adv 2: admin costs — one payer, one set of rules');
await press('Tab');
await type('Transition costs outweigh');
await press('Alt+t');
await press('Shift+Tab');
await press('Control+Enter');
await type('Plan: USFG establishes NHI');

await page.getByRole('button', { name: '+ DA' }).click();
await page.getByRole('textbox', { name: 'Sheet name' }).fill('Spending DA');
await press('Enter');
await page.getByRole('button', { name: 'New argument in the 1NC' }).click();
await type('Uniqueness: deficit falling now');
await press('Enter');
await type('Link: NHI costs trillions');
await press('Tab');
await type('No link — admin savings offset');
await press('Shift+Tab');
await press('Enter');
await type('Impact: rate spike → recession');

await press('Alt+1');
await press('Alt+s');
await page.waitForTimeout(1300);
await press('Alt+s');
await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
await shot('round-flow');

await press('Alt+b');
await page.waitForTimeout(200);
await shot('round-timer');
await press('Alt+b');

await page.getByRole('radio', { name: 'Docs' }).click();
await page.getByText('Coverage gaps are not closing on their own').first().click();
await page.waitForTimeout(250);
await shot('round-docs');

// Dark theme, same flow.
await page.emulateMedia({ colorScheme: 'dark' });
await page.getByRole('radio', { name: 'Flow' }).click();
await page.waitForTimeout(200);
await shot('round-flow-dark');

await browser.close();
console.log(`Saved to ${OUT}`);
