// Desktop smoke test: drives the REAL desktop app window (not a browser).
//
// It starts the built app through WebDriver (tauri-driver), then checks the
// things that only exist on desktop:
//   - the app opens and shows the topic
//   - the window cannot reach the network by itself (Content-Security-Policy)
//   - the Rust core refuses AI requests while a round is active, and only then
//   - the Rust core refuses AI requests to anywhere but the Anthropic API
//   - backups are written to disk; unsafe links and local URLs are refused
//
// Run (Linux):   node tests/desktop/smoke.mjs path/to/policy-debate
// Needs:         tauri-driver (cargo install tauri-driver --locked), WebKitWebDriver
//                (webkit2gtk-driver), and a display (use xvfb-run on a server).

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const app = resolve(process.argv[2] ?? 'src-tauri/target/debug/policy-debate');
if (!existsSync(app)) {
  console.error(`App binary not found: ${app}`);
  process.exit(2);
}

// A private home folder, so the test never touches real user data.
const home = mkdtempSync(join(tmpdir(), 'pd-desktop-test-'));
const env = { ...process.env, HOME: home, XDG_DATA_HOME: join(home, 'data'), XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), WEBKIT_DISABLE_COMPOSITING_MODE: '1', WEBKIT_DISABLE_DMABUF_RENDERER: '1' };

const PORT = 4444;
const driver = spawn(process.env.TAURI_DRIVER ?? 'tauri-driver', ['--port', String(PORT)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let driverLog = '';
driver.stdout.on('data', (d) => (driverLog += d));
driver.stderr.on('data', (d) => (driverLog += d));

const base = `http://127.0.0.1:${PORT}`;
let session = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wd(method, path, body) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WebDriver ${method} ${path} failed: ${JSON.stringify(json.value ?? json).slice(0, 400)}`);
  return json.value;
}

/** Run JavaScript inside the app window and return its (awaited) result. */
function run(fn, ...args) {
  const script = `const done = arguments[arguments.length - 1]; Promise.resolve((${fn.toString()})(...Array.prototype.slice.call(arguments, 0, -1))).then((v) => done({ ok: v }), (e) => done({ err: String((e && e.message) || e) }));`;
  return wd('POST', `/session/${session}/execute/async`, { script, args });
}

async function waitFor(what, fn, ...args) {
  for (let i = 0; i < 80; i++) {
    const r = await run(fn, ...args);
    if (r.ok) return r.ok;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for: ${what}`);
}

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `\n      ${detail}`}`);
}

/** Click a button by its visible text. */
const clickButton = (text) =>
  run((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(t));
    if (!b) throw new Error(`no button "${t}"`);
    b.click();
    return true;
  }, text);

const invoke = (cmd, args) => run((c, a) => window.__TAURI_INTERNALS__.invoke(c, a), cmd, args ?? {});

try {
  // Wait for the driver to listen.
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`${base}/status`);
      break;
    } catch {
      await sleep(250);
    }
  }
  const created = await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: app }, browserName: 'wry' } } });
  session = created.sessionId;
  await wd('POST', `/session/${session}/timeouts`, { script: 30000 });

  // --- the app opens ---------------------------------------------------------
  const resolution = await waitFor('the home screen', () => document.querySelector('.resolution')?.textContent ?? '');
  check('opens and shows the active topic', resolution === 'Resolved: The United States federal government should establish national health insurance in the United States.', resolution);
  check('knows it is the desktop app', (await run(() => document.body.textContent.includes('desktop app'))).ok === true);
  const noErrors = await run(() => !document.body.textContent.includes('could not open its'));
  check('database opened', noErrors.ok === true);
  const alone = await invoke('claim_instance');
  check('this is the only running copy of the app', alone.ok === true, JSON.stringify(alone));

  // --- first launch: the welcome, and the app without an AI key ----------------
  const welcome = await waitFor('the first-launch welcome', () => document.querySelector('.dialog .dialog-title')?.textContent ?? '');
  check('first launch shows the welcome', welcome === 'Welcome to Policy Debate', welcome);
  await clickButton('Skip');
  await waitFor('the welcome to close', () => !document.querySelector('.dialog'));
  await run(() => {
    location.hash = '/cutter';
    return true;
  });
  await waitFor('the card cutter', () => !!document.querySelector('textarea.source-text'));
  const noKey = await waitFor('the no-key note', () => document.querySelector('.ai-optional')?.textContent ?? '');
  const calm = await run(() => !document.querySelector('.notice-danger') && !document.querySelector('.btn-ai') && !document.querySelector('.crash'));
  check('with no AI key, the cutter shows a quiet note, not an error or a dead button', /Optional AI feature/.test(noKey) && calm.ok === true, noKey);

  // --- the window has no network access of its own ---------------------------
  const direct = await run(() => fetch('https://api.anthropic.com/v1/models').then(() => 'reached the network', () => 'blocked'));
  check('the window cannot reach the AI service directly (CSP)', direct.ok === 'blocked', JSON.stringify(direct));
  const other = await run(() => fetch('https://example.com/').then(() => 'reached the network', () => 'blocked'));
  check('the window cannot reach any website directly (CSP)', other.ok === 'blocked', JSON.stringify(other));

  // --- AI requests outside a round reach the key check, not the lock ---------
  const aiArgs = { url: 'https://api.anthropic.com/v1/messages', method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'smuggled' }, body: '{}' };
  const before = await invoke('ai_request', aiArgs);
  check('outside a round, AI requests get as far as the key check', !!before.err && !/Round Mode/.test(before.err) && /key/i.test(before.err), JSON.stringify(before));
  const wrongHost = await invoke('ai_request', { ...aiArgs, url: 'https://example.com/v1/messages' });
  check('AI requests to any other host are refused', /only go to api\.anthropic\.com/.test(wrongHost.err ?? ''), JSON.stringify(wrongHost));
  const plainHttp = await invoke('ai_request', { ...aiArgs, url: 'http://api.anthropic.com/v1/messages' });
  check('AI requests over plain http are refused', /only go to api\.anthropic\.com/.test(plainHttp.err ?? ''), JSON.stringify(plainHttp));

  // --- start a round through the real UI -------------------------------------
  await run(() => {
    location.hash = '/round/new';
    return true;
  });
  await waitFor('the start-round form', () => !!document.querySelector('form.card'));
  await clickButton('Start round');
  await waitFor('the Round Mode banner', () => !!document.querySelector('.lock-banner'));
  check('Round Mode banner is shown', (await run(() => document.querySelector('.lock-title').textContent.trim())).ok === 'Round Mode — AI off');

  const during = await invoke('ai_request', aiArgs);
  check('RUST refuses AI requests during a round', /Round Mode is on/.test(during.err ?? ''), JSON.stringify(during));
  check('the round lock is written to disk', existsSync(join(env.XDG_DATA_HOME, 'org.policydebate.app', 'round-active.lock')));

  // Flow a cell with the keyboard path the UI uses, to prove the webview handles input.
  await run(() => {
    document.querySelector('button.flow-add').click();
    return true;
  });
  await waitFor('a new flow cell', () => !!document.querySelector('textarea.fc-text'));
  const typed = await run(() => {
    const cell = document.querySelector('textarea.fc-text');
    if (!cell) throw new Error('no flow cell');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(cell, 'Adv 1: coverage');
    cell.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    return true;
  });
  check('a flow cell can be created and typed in', typed.ok === true, JSON.stringify(typed));
  await sleep(1200);

  // --- reload mid-round: still locked, flow still there ----------------------
  await wd('POST', `/session/${session}/refresh`, {});
  await waitFor('Round Mode after a reload', () => !!document.querySelector('.lock-banner'));
  const cellText = await waitFor('the saved flow cell', () => document.querySelector('textarea.fc-text')?.value ?? '');
  check('reload mid-round: still in Round Mode with the flow intact', cellText === 'Adv 1: coverage', cellText);
  const afterReload = await invoke('ai_request', aiArgs);
  check('RUST still refuses AI after the reload', /Round Mode is on/.test(afterReload.err ?? ''), JSON.stringify(afterReload));

  // --- end the round ----------------------------------------------------------
  await clickButton('End round');
  await waitFor('the confirmation', () => !!document.querySelector('.dialog'));
  await run(() => {
    [...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === 'End round').click();
    return true;
  });
  await waitFor('Prep to come back', () => !document.querySelector('.lock-banner') && !!document.querySelector('.sidebar'));
  const after = await invoke('ai_request', aiArgs);
  check('after ending the round, AI requests are allowed again (key check)', !!after.err && !/Round Mode/.test(after.err), JSON.stringify(after));
  check('the round lock file is removed', !existsSync(join(env.XDG_DATA_HOME, 'org.policydebate.app', 'round-active.lock')));

  // --- backups on disk --------------------------------------------------------
  const folder = (await invoke('backup_folder')).ok;
  await sleep(1500); // the post-round backup is written as the round ends
  const files = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith('.json')) : [];
  check('a backup file was written to disk when the round ended', files.length >= 1, `${folder}: ${files.join(', ')}`);
  const sneaky = await invoke('write_backup', { name: '../../escape', json: '{}' });
  check('backup names cannot escape the backup folder', sneaky.err === undefined && !existsSync(join(folder, '..', '..', 'escape.json')) && existsSync(join(folder, '_.._escape.json')), JSON.stringify(sneaky));

  // --- PDF import works inside the desktop window (its engine loads on demand) --
  await run(() => {
    location.hash = '/cutter';
    return true;
  });
  await waitFor('the card cutter', () => !!document.querySelector('textarea.source-text'));
  await run((pdfText) => {
    const input = document.querySelector('input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(new File([pdfText], 'sample.pdf', { type: 'application/pdf' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, tinyPdf('Roughly 26 million Americans remain uninsured and the number is not falling.'));
  const pdfText = await waitFor('the PDF text', () => document.querySelector('textarea.source-text').value);
  check('a PDF can be imported in the desktop app', pdfText.includes('Roughly 26 million Americans remain uninsured'), pdfText.slice(0, 200));

  // --- other guards -----------------------------------------------------------
  const local = await invoke('fetch_url', { url: 'http://127.0.0.1:1/' });
  check('fetching local addresses is refused', /local network/.test(local.err ?? ''), JSON.stringify(local));
  const file = await invoke('fetch_url', { url: 'file:///etc/passwd' });
  check('fetching file: addresses is refused', /Only http and https/.test(file.err ?? ''), JSON.stringify(file));
  const badLink = await invoke('open_external', { url: 'file:///etc/passwd' });
  check('opening non-web links is refused', /Only web links/.test(badLink.err ?? ''), JSON.stringify(badLink));
  const key = await invoke('has_api_key');
  check('the keychain check answers without crashing', key.ok === false || key.ok === true || typeof key.err === 'string', JSON.stringify(key));
} catch (err) {
  check('the smoke test ran to the end', false, `${err.stack || err}\n--- driver log ---\n${driverLog.slice(-1500)}`);
} finally {
  if (session) await wd('DELETE', `/session/${session}`).catch(() => {});
  driver.kill();
  await sleep(300);
  rmSync(home, { recursive: true, force: true });
}

/** A minimal one-page PDF containing one line of text. */
function tinyPdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
