// Things that protect a debater's work, checked in a real browser against the built single file.
import { expect, test } from '@playwright/test';
import { APP_URL, openApp, startRound, watch } from './helpers';

test('a second tab does not load your files (two copies would overwrite each other)', async ({ page, context }) => {
  const seen = watch(page);
  await openApp(page);
  const second = await context.newPage();
  await second.goto(APP_URL);
  await expect(second.getByRole('heading', { name: 'Policy Debate is already open' })).toBeVisible();
  await expect(second.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  // Close the first tab, and the second one can take over.
  await page.close();
  await second.getByRole('button', { name: /try again/ }).click();
  await expect(second.getByText('All changes saved')).toBeVisible();
  expect(seen.errors).toEqual([]);
});

test('undo on the flow keeps what you typed, redo brings a removed cell back, Esc leaves the grid', async ({ page }) => {
  const seen = watch(page);
  await openApp(page);
  await startRound(page);
  await page.getByRole('button', { name: 'New argument in the 1AC' }).click();
  await page.keyboard.type('Adv 1');
  await page.keyboard.press('Tab'); // an answer in the 1NC
  await page.keyboard.type('No solvency');
  // Delete the answer by mistake...
  await page.keyboard.press('Control+Shift+Backspace');
  await expect(page.locator('.fc')).toHaveCount(1);
  // ...keep typing in the first cell...
  await page.keyboard.type(': access to care');
  // ...then undo. The answer is back AND the new words are still there.
  await page.keyboard.press('Alt+z');
  await expect(page.locator('.fc')).toHaveCount(2);
  await expect(page.locator('.fc-text').first()).toHaveValue('Adv 1: access to care');
  await expect(page.locator('.fc-text').nth(1)).toHaveValue('No solvency');
  // Redo removes it again; undo once more brings it back. Nothing is ever gone for good.
  await page.keyboard.press('Alt+Shift+z');
  await expect(page.locator('.fc')).toHaveCount(1);
  await page.keyboard.press('Alt+z');
  await expect(page.locator('.fc')).toHaveCount(2);
  await expect(page.locator('.fc-text').first()).toHaveValue('Adv 1: access to care');

  // Tab is used for flowing inside the grid, so Esc is the keyboard way out.
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-tab.is-on')).toBeFocused();
  expect(seen.errors).toEqual([]);
});

test('a damaged saved round cannot blank Round Mode: it is repaired and the flow is still there', async ({ page }) => {
  await openApp(page);
  await startRound(page);
  await page.getByRole('button', { name: 'New argument in the 1AC' }).click();
  await page.keyboard.type('Plan text');
  await expect(page.locator('.save-pill')).toHaveText('Saved');
  // Break the saved round the way a cut-off write or an old version might: no clock, no notes, odd fields.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('policy-debate');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('rounds', 'readwrite');
          const store = tx.objectStore('rounds');
          const all = store.getAll();
          all.onsuccess = () => {
            for (const r of all.result) {
              delete r.clock;
              delete r.cxNotes;
              delete r.fills;
              r.meta = null;
              r.format = 'nonsense';
              store.put(r);
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await expect(page.getByText('Round Mode — AI off')).toBeVisible();
  await expect(page.locator('.fc-text').first()).toHaveValue('Plan text');
  await expect(page.locator('.speech-time')).toHaveText('8:00');
  await page.getByRole('radio', { name: 'CX notes' }).click();
  await expect(page.getByRole('textbox', { name: /Notes for/ }).first()).toBeVisible();
  await expect(page.locator('.crash')).toHaveCount(0);
});
