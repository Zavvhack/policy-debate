import { expect, test, type Page } from '@playwright/test';
import { APP_URL, openApp, startRound, watch } from './helpers';

test('opens from a file with no network and no errors', async ({ page }) => {
  const seen = watch(page);
  await openApp(page);
  await expect(page.getByText('Resolved: The United States federal government should establish national health insurance in the United States.')).toBeVisible();
  await expect(page.getByText('All changes saved')).toBeVisible();
  expect(seen.requests).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test('flow a round with the keyboard only, reload mid-round, end it', async ({ page }) => {
  const seen = watch(page);
  await openApp(page);
  await startRound(page);
  // Prep navigation is gone while the round is on.
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

  // Add an off-case sheet: it starts at the 1NC.
  await page.getByRole('button', { name: '+ DA' }).click();
  await page.getByRole('textbox', { name: 'Sheet name' }).fill('Econ DA');
  await page.keyboard.press('Enter');
  await expect(page.locator('.flow-head').first()).toHaveText(/1NC/);
  await expect(page.locator('.flow-head')).toHaveCount(7);

  // Keyboard-only flowing.
  await page.getByRole('button', { name: 'New argument in the 1NC' }).click();
  await page.keyboard.type('Link: spending');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Impact: recession');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Tab'); // answer in the 2AC
  await page.keyboard.type('No link');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Link turn');
  await page.keyboard.press('Alt+t');
  await page.keyboard.press('Tab'); // block answers the turn
  await page.keyboard.type('Turn is non-unique');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Alt+e'); // neg extends the link
  await page.keyboard.type('Extend the link');

  const cells = page.locator('.fc');
  await expect(cells).toHaveCount(6);
  await expect(page.locator('.fc.is-ext')).toHaveCount(1);
  await expect(page.locator('.badge-turn')).toHaveCount(1);
  // The 2AC "No link" got no block answer; the 1NC impact got no 2AC answer. Both are hinted once the block is flowed.
  await expect(page.locator('.badge-maybe')).toHaveCount(1); // impact (the 2AC answer's window - the block - is still open)

  // Mark dropped with the keyboard.
  await (await cell(page, 'Impact: recession')).focus();
  await page.keyboard.press('Control+d');
  await expect(page.locator('.fc.is-dropped')).toHaveCount(1);

  // Timer: start with the keyboard, see it count, stop it.
  await page.keyboard.press('Alt+s');
  await expect(page.locator('.speech-timer.is-running')).toHaveCount(1);
  await expect(page.locator('.speech-time')).not.toHaveText('8:00', { timeout: 3000 });
  await page.keyboard.press('Alt+s');
  await expect(page.locator('.speech-timer.is-running')).toHaveCount(0);

  // CX notes.
  await page.keyboard.press('Alt+x');
  await page.getByRole('textbox', { name: 'Notes for CX of 1AC' }).fill('Plan cost?');
  await expect(page.locator('.save-pill')).toHaveText('Saved');

  // Reload mid-round (a crash, or closing the lid): still locked, nothing lost.
  await page.reload();
  await expect(page.getByText('Round Mode — AI off')).toBeVisible();
  await page.getByRole('tab', { name: /Econ DA/ }).click();
  await expect(page.locator('.fc')).toHaveCount(6);
  await expect(page.locator('.fc.is-dropped')).toHaveCount(1);
  await page.keyboard.press('Alt+x');
  await expect(page.getByRole('textbox', { name: 'Notes for CX of 1AC' })).toHaveValue('Plan cost?');

  // Ending needs a deliberate confirmation; Cancel is the default.
  await page.getByRole('button', { name: 'End round' }).click();
  await expect(page.getByRole('button', { name: 'Keep debating' })).toBeFocused();
  await page.getByRole('button', { name: 'End round' }).last().click();
  await expect(page.getByText('Round Mode — AI off')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  // The flow is now in Prep for review.
  await expect(page).toHaveURL(/#\/rounds\//);
  await page.getByRole('tab', { name: /Econ DA/ }).click();
  await expect(page.locator('.fc')).toHaveCount(6);

  expect(seen.requests).toEqual([]);
  expect(seen.errors).toEqual([]);
});

/** The flow cell whose text is exactly `text`. (A text box's contents are its value, which text filters do not see.) */
async function cell(page: Page, text: string) {
  const all = page.locator('textarea.fc-text');
  const index = await all.evaluateAll((els, t) => els.findIndex((e) => (e as HTMLTextAreaElement).value === t), text);
  expect(index, `a flow cell containing "${text}"`).toBeGreaterThanOrEqual(0);
  return all.nth(index);
}

test('backup file round-trip', async ({ page }) => {
  await openApp(page);
  await startRound(page, 'Affirmative');
  await page.getByRole('button', { name: 'New argument in the 1AC' }).click();
  await page.keyboard.type('Adv 1');
  await page.getByRole('button', { name: 'End round' }).click();
  await page.getByRole('button', { name: 'End round' }).last().click();
  await expect(page).toHaveURL(/#\/rounds\//);

  await page.goto(`${APP_URL}#/settings/backup`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download a backup file' }).click()]);
  const path = await download.path();
  expect(download.suggestedFilename()).toMatch(/^policy-debate-backup_\d{4}-\d{2}-\d{2}\.json$/);

  // Wipe the browser's data (as if on another computer), then restore.
  await page.evaluate(() => new Promise<void>((resolve) => {
    localStorage.clear();
    const req = indexedDB.deleteDatabase('policy-debate');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));
  await page.reload();
  await page.goto(`${APP_URL}#/rounds`);
  await expect(page.getByText('No rounds yet')).toBeVisible();
  await page.goto(`${APP_URL}#/settings/backup`);
  await page.locator('input[type=file]').setInputFiles(path!);
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText('Backup restored.')).toBeVisible();
  await page.goto(`${APP_URL}#/rounds`);
  await expect(page.locator('.list-row')).toHaveCount(1);
});
