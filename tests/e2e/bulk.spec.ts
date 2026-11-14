// "Import many files": a .zip of a camp library goes into the library in one go.
import JSZip from 'jszip';
import { expect, test } from '@playwright/test';
import { buildDocx } from '../../src/core/docx/write';
import { emptyCite } from '../../src/core/cards/cite';
import { defaultSettings } from '../../src/core/debate/topics';
import { APP_URL, openApp, watch } from './helpers';

async function evidence(tag: string): Promise<Uint8Array> {
  return buildDocx(
    [
      { kind: 'heading', level: 3, text: `${tag} block` },
      {
        kind: 'card',
        side: 'neg',
        card: { tag: [{ t: tag }], cite: { ...emptyCite('AB'), last: 'Okafor', year: '2026', title: 'T', publication: 'P' }, text: `Evidence about ${tag}.`, marks: [{ s: 0, e: 8, lv: 2 }] },
      },
    ],
    defaultSettings().highlight,
  );
}

test('a .zip of library files is imported with sides and labels from the names', async ({ page }) => {
  const w = watch(page);
  const zip = new JSZip();
  zip.file('Debate Library/Disadvantages/Econ DA - Neg - DDI 2026.docx', await evidence('Econ link'));
  zip.file('Debate Library/Disadvantages/Econ DA - Aff - DDI 2026.docx', await evidence('No econ link'));
  zip.file('Debate Library/_INDEX.txt', 'index');
  const buffer = Buffer.from(await zip.generateAsync({ type: 'uint8array' }));

  await openApp(page);
  await page.goto(`${APP_URL}#/library`);
  await page.getByRole('button', { name: 'Import many files…' }).click();
  await page.getByTestId('bulk-files').setInputFiles({ name: 'Debate_Library.zip', mimeType: 'application/zip', buffer });
  await expect(page.getByTestId('bulk-result')).toContainText('Added 2 cards from 2 files.');
  await page.getByRole('button', { name: 'Done' }).click();

  const rows = page.locator('.library-list .list-row');
  await expect(rows).toHaveCount(2);
  await page.getByRole('radio', { name: 'Aff' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('No econ link');
  await expect(rows.first()).toContainText('Econ DA, Disadvantages');

  // Running it again adds nothing.
  await page.getByRole('button', { name: 'Import many files…' }).click();
  await expect(page.getByText('Already imported: 2 files, 2 cards.')).toBeVisible();
  await page.getByTestId('bulk-files').setInputFiles({ name: 'Debate_Library.zip', mimeType: 'application/zip', buffer });
  await expect(page.getByTestId('bulk-result')).toContainText('Added 0 cards');
  await expect(page.getByTestId('bulk-result')).toContainText('2 files were already in the library');
  expect(w.errors).toEqual([]);
  expect(w.requests).toEqual([]);
});
