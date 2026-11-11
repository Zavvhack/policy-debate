// Most people who use this app have no AI key. These tests check that the app
// feels complete without one: nothing looks broken, nothing shows an error,
// and nothing is ever sent anywhere.
import { expect, test, type Page } from '@playwright/test';
import { APP_URL, openApp, startRound, watch } from './helpers';

const ARTICLE = `Why coverage gaps persist
By Dr. Maria Okafor, professor of health policy at Example University

Roughly 26 million Americans remain uninsured. That number is not falling. Subsidies that expired in 2025 pushed premiums up in most states, and enrollment dropped.`;

/** No error boxes, no crash screens. */
async function expectCalm(page: Page) {
  await expect(page.locator('.notice-danger')).toHaveCount(0);
  await expect(page.locator('.crash')).toHaveCount(0);
  await expect(page.locator('.toast.is-error, .toast-error')).toHaveCount(0);
}

test('first launch: a short welcome explains the sections, and is shown only once', async ({ page }) => {
  const seen = watch(page);
  await openApp(page, true);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Welcome to Policy Debate' })).toBeVisible();
  await expect(dialog.getByText('Step 1 of 5')).toBeVisible();
  for (const title of ['In a round', 'Before a round', 'Your files stay on this computer', 'AI is optional']) {
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.getByRole('heading', { name: title })).toBeVisible();
  }
  await expect(dialog.getByText('You do not need AI to use this app.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Decide later' }).click();
  await expect(dialog).toHaveCount(0);
  // Not shown again after a reload...
  await page.reload();
  await page.getByRole('heading', { name: 'Policy Debate', level: 1 }).waitFor();
  await page.waitForTimeout(400);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // ...but it can be opened again from Home.
  await page.getByRole('button', { name: 'Show the welcome again' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Welcome to Policy Debate' })).toBeVisible();
  expect(seen.errors).toEqual([]);
  expect(seen.requests).toEqual([]);
});

test('with no key, every AI control is a quiet labelled note: no errors, no dead buttons, nothing sent', async ({ page }) => {
  const seen = watch(page);
  await openApp(page);

  // Card cutter: the manual cutter is all there; AI is one line.
  await page.goto(`${APP_URL}#/cutter`);
  await page.locator('textarea.source-text').fill(ARTICLE);
  await expect(page.getByText('Optional AI feature')).toHaveCount(1);
  await expect(page.getByText(/Cutting a card with AI needs your own Claude API key/)).toBeVisible();
  await expect(page.getByRole('button', { name: /with AI/ })).toHaveCount(0);
  await expectCalm(page);

  // The AI-only page is labelled in the menu and says what it needs, instead of offering a form that cannot work.
  await expect(page.getByRole('link', { name: /CX questions/ }).locator('.nav-tag')).toHaveText('AI');
  await page.getByRole('link', { name: /CX questions/ }).click();
  await expect(page.getByText(/Writing CX questions needs your own Claude API key/)).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expectCalm(page);

  // Topicality, blocks, practice, scouting, library: all open without complaint.
  for (const path of ['/topicality', '/topicality/plan', '/topicality/definitions', '/topicality/drills', '/blocks', '/practice', '/scouting', '/library', '/rounds', '/settings/ai', '/settings/backup']) {
    await page.goto(`${APP_URL}#${path}`);
    await page.locator('main h1, main h2').first().waitFor();
    await expectCalm(page);
    await expect(page.locator('.btn-ai')).toHaveCount(0);
  }
  await expect(page.getByText('No key saved. AI is optional: the rest of the app does not need one.')).toHaveCount(0); // we are on Backup now
  await page.goto(`${APP_URL}#/settings/ai`);
  await expect(page.getByText('No key saved. AI is optional: the rest of the app does not need one.')).toBeVisible();

  expect(seen.errors).toEqual([]);
  expect(seen.requests).toEqual([]);
});

test('"No AI" in the welcome hides every AI feature; Settings brings them back', async ({ page }) => {
  const seen = watch(page);
  await openApp(page, true);
  const dialog = page.getByRole('dialog');
  for (let i = 0; i < 4; i++) await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'No AI: hide those features' }).click();

  // The AI-only page is gone from the menu and from Home; the menu heading no longer mentions AI.
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /CX questions/ })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByText('Prep · AI allowed')).toHaveCount(0);
  await expect(page.getByText('AI features are hidden.')).toBeVisible();

  for (const path of ['/cutter', '/blocks', '/topicality', '/practice']) {
    await page.goto(`${APP_URL}#${path}`);
    await page.locator('main h1, main h2').first().waitFor();
    await expect(page.getByText('Optional AI feature')).toHaveCount(0);
    await expect(page.locator('.btn-ai')).toHaveCount(0);
  }
  await page.goto(`${APP_URL}#/topicality`);
  await expect(page.getByRole('radio', { name: /Is this plan topical/ })).toHaveCount(0);

  // Round Mode never had AI, with or without the switch.
  await startRound(page);
  await expect(page.getByText('Round Mode — AI off')).toBeVisible();
  await page.getByRole('button', { name: 'End round' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'End round' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible(); // back in Prep
  await expect(page.getByRole('button', { name: '← Rounds' })).toBeVisible();

  // Switch them back on.
  await page.goto(`${APP_URL}#/settings/ai`);
  await page.getByRole('checkbox', { name: 'Show AI features' }).check();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /CX questions/ })).toBeVisible();
  expect(seen.errors).toEqual([]);
  expect(seen.requests).toEqual([]);
});

test('with a key saved, the AI buttons appear', async ({ page }) => {
  await openApp(page);
  await page.goto(`${APP_URL}#/settings/ai`);
  await page.getByRole('textbox', { name: 'API key' }).fill('sk-ant-test-key');
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByText('A key is saved.')).toBeVisible();
  await page.goto(`${APP_URL}#/cutter`);
  await page.locator('textarea.source-text').fill(ARTICLE);
  await expect(page.getByRole('button', { name: /Cut a card with AI/ })).toBeVisible();
  await expect(page.getByText('Optional AI feature')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByText('Prep · AI allowed')).toBeVisible();
});
