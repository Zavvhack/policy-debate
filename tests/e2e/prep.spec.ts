import { expect, test, type Page } from '@playwright/test';
import { APP_URL, openApp, startRound } from './helpers';

const ARTICLE = `Why coverage gaps persist
By Dr. Maria Okafor, professor of health policy at Example University
January 28, 2026 — The Example Review

Roughly 26 million Americans remain uninsured. That number is not falling. Subsidies that expired in 2025 pushed premiums up in most states, and enrollment dropped.

A single-payer system would not eliminate every cost. It would, however, cut administrative spending by an estimated $500 billion a year.`;

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

/** Stand in for the Anthropic API. `answer` gets the request body and returns the text Claude would send. */
async function fakeClaude(page: Page, answer: (body: { system: string; messages: { content: string }[] }) => string) {
  const calls: { url: string; body: { system: string; messages: { content: string }[]; model: string } }[] = [];
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = req.postDataJSON();
    calls.push({ url: req.url(), body });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: CORS,
      body: JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: answer(body) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 300 } }),
    });
  });
  return calls;
}

async function saveKey(page: Page) {
  await page.goto(`${APP_URL}#/settings/ai`);
  await page.getByRole('textbox', { name: 'API key' }).fill('sk-ant-test-key');
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByText('A key is saved.')).toBeVisible();
}

/** The number the prompt gave to a word, e.g. Roughly‹18› -> 18. */
function wordNumber(prompt: string, word: string): number {
  const m = new RegExp(`${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}‹(\\d+)›`).exec(prompt);
  if (!m) throw new Error(`"${word}" not found in the prompt`);
  return Number(m[1]);
}

test('AI cuts a card by word number: the text comes from the article, invented cite details are dropped', async ({ page }) => {
  await openApp(page);
  const calls = await fakeClaude(page, (body) => {
    const prompt = body.messages[0].content;
    const start = wordNumber(prompt, 'Roughly');
    return JSON.stringify({
      start,
      end: wordNumber(prompt, 'dropped.'),
      spans: [
        { from: start, to: wordNumber(prompt, 'falling.'), level: 'u' },
        { from: start + 1, to: start + 5, level: 'h' },
      ],
      tag: 'Coverage gaps are [[not closing]]',
      // "Nobel laureate" is not in the article; the year and names are.
      cite: { first: 'Maria', last: 'Okafor', year: '2026', date: '1/28', quals: 'Nobel laureate in economics', title: 'Why coverage gaps persist', publication: 'The Example Review' },
      text: 'THE MODEL TRIES TO SMUGGLE IN ITS OWN WORDING', // ignored: there is no such field
    });
  });
  await saveKey(page);
  await page.goto(`${APP_URL}#/cutter`);
  await page.locator('textarea.source-text').fill(ARTICLE);
  await page.getByRole('textbox', { name: 'What should the card prove? (optional)' }).fill('coverage is not improving');
  await page.getByRole('button', { name: /Cut a card with AI/ }).click();

  const card = page.locator('.cardbox').first();
  await expect(card.getByText('✓ Matches source')).toBeVisible();
  await expect(card.locator('.ev-body-edit')).toHaveText('Roughly 26 million Americans remain uninsured. That number is not falling. Subsidies that expired in 2025 pushed premiums up in most states, and enrollment dropped.');
  await expect(card.locator('.lv2')).toHaveText('26 million Americans remain uninsured.');
  await expect(card.getByText('AI draft — check it')).toBeVisible();
  await expect(card.locator('.ev-cite')).toContainText('Maria Okafor, 2026');
  await expect(card.locator('.ev-cite')).not.toContainText('Nobel');
  await expect(page.getByText(/suggested a qualifications that is not in the article/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('SMUGGLE');
  await expect(card.getByText('AI chose this highlighting.')).toBeVisible();

  // What was sent: the exact resolution, numbered words, and the key only in the auth header.
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
  expect(calls[0].body.model).toBe('claude-haiku-5-5');
  expect(calls[0].body.system).toContain('Resolved: The United States federal government should establish national health insurance in the United States.');
  expect(calls[0].body.messages[0].content).toContain('coverage is not improving');

  // Confirming the tag clears the draft label.
  await card.getByRole('button', { name: 'I have checked this tag' }).click();
  await expect(card.getByText('AI draft — check it')).toHaveCount(0);
});

test('a bad AI answer is rejected and no card is created', async ({ page }) => {
  await openApp(page);
  const calls = await fakeClaude(page, () => JSON.stringify({ start: 900, end: 950, spans: [], tag: 'x', cite: { first: '', last: '', year: '', date: '', quals: '', title: '', publication: '' } }));
  await saveKey(page);
  await page.goto(`${APP_URL}#/cutter`);
  await page.locator('textarea.source-text').fill(ARTICLE);
  await page.getByRole('button', { name: /Cut a card with AI/ }).click();
  await expect(page.getByText(/could not produce a valid cut/)).toBeVisible();
  await expect(page.locator('.cardbox')).toHaveCount(0);
  expect(calls).toHaveLength(2); // one retry, then it gives up
});

test('blocks, templates and T files: write in Prep, read and fill by hand in Round Mode, with no AI in sight', async ({ page }) => {
  await openApp(page);

  // A block with two analytics.
  await page.goto(`${APP_URL}#/blocks`);
  await page.getByRole('button', { name: 'New block' }).click();
  await page.getByLabel('What it answers or extends').fill('Econ DA');
  await page.getByRole('textbox', { name: 'Point 1' }).fill('Non-unique: spending is already rising because of [reason].');
  await page.getByRole('button', { name: '+ Point' }).click();
  await page.getByRole('textbox', { name: 'Point 2' }).fill('No link: the plan is paid for.');
  await expect(page.locator('.library-list')).toContainText('Aff: Econ DA');

  // A template, filled in and saved as a block.
  await page.goto(`${APP_URL}#/blocks/templates`);
  await page.getByRole('button', { name: /Dropped argument/ }).click();
  await page.getByRole('textbox', { name: 'argument', exact: true }).fill('the link turn');
  await page.getByRole('button', { name: 'Save as a block' }).click();
  await expect(page.getByRole('textbox', { name: 'Point 1' })).toHaveValue('They dropped the link turn in the [speech].');

  // A T shell.
  await page.goto(`${APP_URL}#/topicality`);
  await page.getByRole('button', { name: 'New neg shell' }).click();
  await page.getByLabel('Word or phrase').fill('establish');
  await page.getByRole('textbox', { name: 'Interpretation', exact: true }).fill('Establish means to create something new.');
  await page.getByRole('textbox', { name: 'Violation', exact: true }).fill('The plan only expands Medicaid.');
  await expect(page.getByText('No definition card yet. An interpretation needs evidence behind it.')).toBeVisible();
  await page.goto(`${APP_URL}#/topicality/definitions`);
  for (const term of ['establish', 'national health insurance', 'The United States federal government']) await expect(page.getByRole('heading', { name: `“${term}”` })).toBeVisible();

  // With a key saved, Prep has AI buttons...
  await saveKey(page);
  await page.goto(`${APP_URL}#/cx`);
  await expect(page.locator('.btn-ai')).toHaveCount(1);

  // ...Round Mode has none, and Prep cannot be reached while it is on.
  await startRound(page, 'Affirmative');
  await expect(page.locator('.btn-ai')).toHaveCount(0);
  for (const path of ['/cx', '/cutter', '/blocks', '/topicality', '/practice', '/settings/ai', '/library']) {
    await page.goto(`${APP_URL}#${path}`);
    await expect(page.getByText('Round Mode — AI off')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    await expect(page.locator('.btn-ai')).toHaveCount(0);
  }
  await expect(page.locator('body')).not.toContainText('CX question prep');

  await page.getByRole('radio', { name: 'Docs' }).click();
  await page.getByRole('searchbox', { name: 'Search your prepared files' }).fill('econ');
  await page.getByRole('button', { name: /Aff: Econ DA/ }).click();
  const view = page.locator('.docs-view');
  await expect(view).toContainText('Non-unique: spending is already rising because of');
  // The blank is filled in by hand, and it is remembered for this round.
  await view.getByRole('textbox', { name: 'reason' }).fill('the budget deal');
  await page.getByRole('searchbox', { name: 'Search your prepared files' }).fill('establish');
  await page.getByRole('button', { name: /T: establish/ }).click();
  await expect(view).toContainText('Establish means to create something new.');
  await expect(view).toContainText('B. Violation');
  await page.getByRole('searchbox', { name: 'Search your prepared files' }).fill('dropped template');
  await page.getByRole('button', { name: /Template: Dropped argument/ }).click();
  await expect(view.getByRole('textbox', { name: 'speech' })).toBeVisible();
  await page.reload();
  await page.getByRole('radio', { name: 'Docs' }).click();
  await page.getByRole('searchbox', { name: 'Search your prepared files' }).fill('econ');
  await page.getByRole('button', { name: /Aff: Econ DA/ }).click();
  await expect(page.locator('.docs-view').getByRole('textbox', { name: 'reason' })).toHaveValue('the budget deal');
});

test('AI feedback flags quotes that are not in the material', async ({ page }) => {
  await openApp(page);
  await fakeClaude(page, () => 'Card 1 says "premiums up in most states" but also "taxes will triple by next year".\n\nTHREE QUESTIONS TO ASK FIRST\n1. Where is the data?');
  await saveKey(page);
  await page.goto(`${APP_URL}#/cx`);
  await page.getByRole('textbox', { name: /Their evidence/ }).fill(ARTICLE);
  await page.getByRole('button', { name: /Write CX questions/ }).click();
  await expect(page.getByText('1 quote below could not be found in the text the AI was given.')).toBeVisible();
  await expect(page.locator('.notice-danger li')).toHaveText('“taxes will triple by next year”');
  await expect(page.locator('.ai-output')).toContainText('THREE QUESTIONS TO ASK FIRST');
});

test('scouting notes link past rounds to opponents', async ({ page }) => {
  await openApp(page);
  await page.goto(`${APP_URL}#/round/new`);
  await page.getByLabel('Opponent').fill('Lincoln AB');
  await page.getByRole('button', { name: /Start round/ }).click();
  await page.getByText('Round Mode — AI off').waitFor();
  await page.getByRole('button', { name: 'End round' }).click();
  await page.getByRole('button', { name: 'End round' }).last().click();
  await expect(page).toHaveURL(/#\/rounds\//);
  await page.goto(`${APP_URL}#/scouting`);
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('textbox', { name: 'School' }).fill('Lincoln');
  await expect(page.getByRole('link', { name: /vs Lincoln AB/ })).toBeVisible();
});
