import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';

/** The built single-file app, addressed the way a double-click from a USB drive would open it. */
export const APP_URL = pathToFileURL(fileURLToPath(new URL('../../dist-html/policy-debate.html', import.meta.url))).toString();

/** Collects anything that should never happen: page errors, console errors, and network requests. */
export function watch(page: Page) {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('request', (r) => {
    if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) requests.push(r.url());
  });
  return { errors, requests };
}

/**
 * Open the app. On a first launch the welcome appears; most tests are not about
 * it, so it is skipped ("decide later" about AI) unless `keepWelcome` is set.
 */
export async function openApp(page: Page, keepWelcome = false) {
  await page.goto(APP_URL);
  await page.getByRole('heading', { name: 'Policy Debate', level: 1 }).waitFor();
  if (keepWelcome) return;
  const skip = page.getByRole('button', { name: 'Skip' });
  await skip
    .waitFor({ timeout: 1500 })
    .then(() => skip.click())
    .catch(() => {
      /* not a first launch */
    });
}

export async function startRound(page: Page, side: 'Affirmative' | 'Negative' = 'Negative') {
  await page.goto(`${APP_URL}#/round/new`);
  await page.getByRole('radio', { name: side }).click();
  await page.getByRole('button', { name: /Start round/ }).click();
  await page.getByText('Round Mode — AI off').waitFor();
}
