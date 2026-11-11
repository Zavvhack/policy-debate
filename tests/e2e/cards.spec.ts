import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { expect, test, type Page } from '@playwright/test';
import { APP_URL, openApp, startRound, watch } from './helpers';

const ARTICLE = `Why coverage gaps persist
By Dr. Maria Okafor, professor of health policy at Example University
January 28, 2026 — The Example Review

Roughly 26 million Americans remain uninsured. That number is not falling. Subsidies that expired in 2025 pushed premiums up by “double digits” in most states.

A single-payer system would not eliminate every cost. It would, however, cut administrative spending.`;

/** Select a stretch of text inside the article box, exactly as dragging over it would. */
async function selectInSource(page: Page, from: string, to: string) {
  await page.locator('textarea.source-text').evaluate(
    (el, [a, b]) => {
      const t = el as HTMLTextAreaElement;
      const s = t.value.indexOf(a);
      const e = t.value.indexOf(b, s) + b.length;
      t.focus();
      t.setSelectionRange(s, e);
    },
    [from, to],
  );
}

/** Select text inside a card body by its words. */
async function selectInCard(page: Page, from: string, to: string) {
  await page.locator('.ev-body-edit').first().evaluate(
    (body, [a, b]) => {
      const full = body.textContent ?? '';
      const s = full.indexOf(a);
      const e = full.indexOf(b, s) + b.length;
      const range = document.createRange();
      let seen = 0;
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const len = n.nodeValue!.length;
        if (s >= seen && s <= seen + len) range.setStart(n, s - seen);
        if (e >= seen && e <= seen + len) range.setEnd(n, e - seen);
        seen += len;
      }
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      (body as HTMLElement).focus();
    },
    [from, to],
  );
}

async function fillCite(page: Page) {
  await page.getByRole('textbox', { name: 'Author first name' }).fill('Maria');
  await page.getByRole('textbox', { name: 'Author last name' }).fill('Okafor');
  await page.getByRole('textbox', { name: 'Year' }).fill('2026');
  await page.getByRole('textbox', { name: 'Cut by' }).fill('AB');
}

test('cut a card by hand, highlight it, and export a correct .docx', async ({ page }) => {
  const seen = watch(page);
  await openApp(page);
  await page.goto(`${APP_URL}#/cutter`);
  await page.locator('textarea.source-text').fill(ARTICLE);
  await fillCite(page);
  await page.getByRole('textbox', { name: /^Tag/ }).fill('Coverage gaps are [[not closing]]');

  // A made-up qualification is flagged, because it is not in the article.
  await page.getByRole('textbox', { name: 'Qualifications' }).fill('Nobel laureate');
  await expect(page.getByText('Not found in the article text: qualifications')).toBeVisible();
  await page.getByRole('textbox', { name: 'Qualifications' }).fill('professor of health policy at Example University');
  await expect(page.getByText('Not found in the article text')).toHaveCount(0);

  // Cut: a sloppy selection (mid-word to mid-word) is widened to whole words.
  await selectInSource(page, 'oughly 26 million', 'is not fal');
  await page.getByRole('button', { name: 'Cut the selected text by hand' }).click();
  const card = page.locator('.cardbox').first();
  await expect(card.getByText('✓ Matches source')).toBeVisible();
  await expect(card.locator('.ev-body-edit')).toHaveText('Roughly 26 million Americans remain uninsured. That number is not falling.');

  // Highlight with the keyboard: underline the first sentence, highlight a phrase, emphasise a word.
  await selectInCard(page, 'Roughly', 'uninsured.');
  await page.keyboard.press('u');
  await selectInCard(page, '26 million', 'Americans');
  await page.keyboard.press('h');
  await selectInCard(page, 'uninsured.', 'uninsured.');
  await page.keyboard.press('e');
  await expect(card.locator('.lv2')).toHaveText('26 million Americans');
  await expect(card.locator('.lv3')).toHaveText('uninsured.');
  await expect(card.locator('.lv0')).toHaveText(' That number is not falling.');
  // The text itself is untouched by all that.
  await expect(card.locator('.ev-body-edit')).toHaveText('Roughly 26 million Americans remain uninsured. That number is not falling.');
  // Clicking a word steps it up a level; Ctrl+Z undoes it.
  await card.locator('.lv0').click({ position: { x: 4, y: 3 } });
  await expect(card.locator('.lv0')).not.toHaveText(' That number is not falling.');
  await card.locator('.ev-body-edit').focus();
  await page.keyboard.press('Control+z');
  await expect(card.locator('.lv0')).toHaveText(' That number is not falling.');

  // Export and look inside the file.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .docx' }).click()]);
  expect(download.suggestedFilename()).toBe('Okafor 2026.docx');
  const zip = await JSZip.loadAsync(readFileSync((await download.path())!));
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('<w:pStyle w:val="Heading4"/>');
  expect(xml).toContain('>not closing</w:t>');
  expect(xml).toContain('>Okafor,</w:t>');
  expect(xml).toContain('> //AB</w:t>');
  expect(xml).toContain('>26 million Americans</w:t>');
  expect(xml).toMatch(/w:fill="FF9E9E"\/><\/w:rPr><w:t xml:space="preserve">26 million Americans/);
  expect(xml).toMatch(/<w:sz w:val="14"\/><w:szCs w:val="14"\/><\/w:rPr><w:t xml:space="preserve"> That number is not falling\./);

  // The card is in the library, and survives a reload.
  await page.goto(`${APP_URL}#/library`);
  await page.reload();
  await page.getByRole('button', { name: /Coverage gaps are not closing/ }).click();
  await expect(page.locator('.cardbox .lv2')).toHaveText('26 million Americans');
  await expect(page.locator('.cardbox').getByText('✓ Matches source')).toBeVisible();

  expect(seen.requests).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test('an exported .docx imports back as the same card, flagged as unchecked', async ({ page }) => {
  await openApp(page);
  await page.goto(`${APP_URL}#/cutter`);
  await page.locator('textarea.source-text').fill(ARTICLE);
  await fillCite(page);
  await page.getByRole('textbox', { name: /^Tag/ }).fill('Single payer cuts admin costs');
  await selectInSource(page, 'A single-payer', 'administrative spending.');
  await page.getByRole('button', { name: 'Cut the selected text by hand' }).click();
  await selectInCard(page, 'cut administrative', 'spending.');
  await page.keyboard.press('h');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .docx' }).click()]);
  const path = (await download.path())!;

  await page.goto(`${APP_URL}#/library`);
  await page.locator('input[type=file]').setInputFiles({ name: 'file.docx', mimeType: 'application/octet-stream', buffer: readFileSync(path) });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Imported 1 card.')).toBeVisible();
  await expect(page.locator('.library-list .list-row')).toHaveCount(2);
  await page.locator('.library-list .list-main').first().click();
  const imported = page.locator('.cardbox');
  await expect(imported.getByText('Imported · not checked against a source')).toBeVisible();
  await expect(imported.locator('.ev-body-edit')).toHaveText('A single-payer system would not eliminate every cost. It would, however, cut administrative spending.');
  await expect(imported.locator('.lv2')).toHaveText('cut administrative spending.');
  await expect(imported.locator('.ev-cite')).toHaveText('Maria Okafor, 2026 //AB');
});

test('import a PDF as a source', async ({ page, browser }) => {
  // Make a real PDF with the browser's own print-to-PDF.
  const maker = await browser.newPage();
  await maker.setContent(`<html><body style="font:14px serif;width:420px"><h1>Coverage report</h1><p>Roughly 26 million Americans remain uninsured, and administrative spending keeps rising across the health system every year.</p><p>A second paragraph discusses rural hospitals and uncompensated care in detail.</p></body></html>`);
  const pdf = await maker.pdf();
  await maker.close();

  await openApp(page);
  await page.goto(`${APP_URL}#/cutter`);
  await page.locator('input[type=file]').first().setInputFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByText(/rebuilt from the PDF/)).toBeVisible({ timeout: 20_000 });
  const text = await page.locator('textarea.source-text').inputValue();
  expect(text).toContain('Roughly 26 million Americans remain uninsured, and administrative spending keeps rising across the health system every year.');
  expect(text).toContain('rural hospitals and uncompensated care');
  // Wrapped lines were re-joined into one paragraph each.
  expect(text.split('\n\n').length).toBeGreaterThanOrEqual(2);
});

test('the browser version says clearly that URL fetching needs the desktop app', async ({ page }) => {
  await openApp(page);
  await page.goto(`${APP_URL}#/cutter`);
  await expect(page.getByText('Fetching from a URL needs the desktop app.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fetch' })).toHaveCount(0);
});

test('saved cards can be read in Round Mode and put in a speech doc', async ({ page }) => {
  await openApp(page);
  await page.goto(`${APP_URL}#/cutter`);
  await page.locator('textarea.source-text').fill(ARTICLE);
  await page.getByRole('textbox', { name: /^Tag/ }).fill('Uninsured numbers are stuck');
  await selectInSource(page, 'Roughly', 'falling.');
  await page.getByRole('button', { name: 'Cut the selected text by hand' }).click();
  await expect(page.locator('.cardbox')).toHaveCount(1);

  await startRound(page);
  await page.getByRole('radio', { name: 'Docs' }).click();
  await page.getByRole('searchbox', { name: 'Search your prepared files' }).fill('uninsured');
  await page.getByRole('button', { name: /Uninsured numbers are stuck/ }).click();
  const view = page.locator('.docs-view');
  await expect(view.locator('.ev-body')).toHaveText('Roughly 26 million Americans remain uninsured. That number is not falling.');
  // Read-only: no highlighting tools, no editable fields, in Round Mode.
  await expect(view.locator('.hl-tools')).toHaveCount(0);
  await expect(view.locator('input, textarea')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add to speech doc' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), view.getByRole('button', { name: 'Download .docx' }).click()]);
  expect(download.suggestedFilename()).toMatch(/speech\.docx$/);
});
