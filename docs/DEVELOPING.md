# Developing Policy Debate

For people who want to build the app from its code or change it. To just use the app, see the [README](../README.md).

Read [CONTRIBUTING.md](../CONTRIBUTING.md) first: it lists three rules the code may never break.

## Building it yourself

You need [Node.js](https://nodejs.org) 22 or newer. For the desktop app you also need [Rust](https://rustup.rs) and your system's build tools.

```
git clone https://github.com/Zavvhack/policy-debate.git
cd policy-debate
npm ci
```

**The browser version** (any operating system):

```
npm run build:html
```

The file is `dist-html/policy-debate.html`.

**The desktop app:**

```
npm run tauri build
node scripts/collect-artifacts.mjs linux     # or: windows, macos
```

The installers end up in `release/`. First install what your system needs:

- **Fedora / Nobara:** `sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libxdo-devel librsvg2-devel rpm-build` and `sudo dnf group install c-development`
- **Ubuntu / Debian:** `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev librsvg2-dev patchelf rpm`
- **Arch:** `sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl xdotool librsvg rpm-tools`
- **Windows:** the "Desktop development with C++" tools from the [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/). Windows 11 already has WebView2.
- **macOS:** `xcode-select --install`. For a build that runs on both kinds of Mac: `rustup target add aarch64-apple-darwin x86_64-apple-darwin`, then `npm run tauri build -- --target universal-apple-darwin`.

While developing, `npm run dev` runs the app in a browser with live reload, and `npm run tauri dev` runs it in the desktop window.

### Tests

```
npm run check                 # type-check + unit tests
npm run build:html && npm run e2e    # drives the built file in a real browser
cargo test --manifest-path src-tauri/Cargo.toml    # the desktop core
node tests/desktop/smoke.mjs src-tauri/target/release/policy-debate   # drives the real desktop window (Linux; needs tauri-driver)
```

The tests that matter most:

| File | Checks |
|---|---|
| `tests/unit/verbatim.test.ts` | The verbatim check, word-number cutting, cite checking |
| `tests/unit/lockout.test.ts`, `ai-client.test.ts` | Round Mode switches AI off, and stays off through restarts and retries |
| `tests/unit/flow.test.ts`, `store.test.ts` | Flow logic, saving and loading, crash recovery, backups |
| `tests/unit/safety.test.ts` | Repairing old or damaged files, undo that keeps typing, the lock across two windows |
| `tests/e2e/nokey.spec.ts` | The app with no AI key: nothing broken, nothing sent |
| `tests/unit/timer.test.ts` | Timer accuracy |
| `tests/unit/docx.test.ts` | .docx export and import |
| `tests/desktop/smoke.mjs` | The desktop app's own locks |

### Getting installers from GitHub

`.github/workflows/release.yml` builds everything on GitHub's computers:

- **Push a tag** such as `v1.0.1` → installers for Linux, Windows and macOS plus the HTML file appear on the Releases page.
  No terminal needed: on GitHub open **Releases → Draft a new release → Choose a tag**, type `v1.0.1`, pick **Create new tag on publish**, and press **Publish release**. The files are added to that release when the build finishes (about 20 minutes).
- Or open **Actions → Release → Run workflow** and choose what to build; download the results from the run's page.

On a private repository GitHub Actions minutes are limited, and macOS and Windows minutes count for more than Linux ones. Building only when you tag a release keeps the cost down. Public repositories build for free.

---

## How the code is organised

```
src/
  core/         Pure logic, no screen code, heavily tested
    timer/        timers that cannot drift
    flow/         the flow as a tree of cells; layout; dropped arguments
    cards/        card text and marks, the verbatim check, cites
    docx/         reading and writing Word files
    import/       PDF and web page text
    blocks/       fill-in-the-blank templates
  ai/           The ONLY code that talks to the AI service
    lock.ts       the Round Mode lock
    client.ts     the single door to Claude
    tasks.ts      every prompt, and the checks on every answer
  data/         Saving and loading (IndexedDB), backups, the crash journal
  platform/     What differs between the browser and desktop versions
  features/     One folder per screen
    round/        Round Mode (never imports the AI client; a test enforces it)
  ui/, styles/  Shared building blocks and the stylesheet
src-tauri/      The desktop app's Rust core: keychain, URL fetching, backups, the second AI lock
tests/          unit/ (Vitest), e2e/ (Playwright), desktop/ (WebDriver)
docs/           This file, and the README's screenshots
scripts/        Release helpers, and screenshots.mjs (retakes the README screenshots)
legacy/         The original single-file card cutter, kept for reference (not part of the app)
```

Good places to start reading: `src/ai/lock.ts` (short, and the heart of the app), then `src/core/cards/verify.ts`, then `src/core/flow/model.ts`.

## Releasing a new version

1. Change the version in `package.json` and `src-tauri/Cargo.toml` (they must match), then run `npm install` and `cargo check --manifest-path src-tauri/Cargo.toml` so both lock files pick it up.
2. Add a section to `CHANGELOG.md`. The release notes on GitHub are taken from it.
3. Run every check listed under Tests.
4. Merge to `main`, then tag: `v` followed by the version, for example `v1.0.1`.

## Retaking the README screenshots

```
npm run build:html
node scripts/screenshots.mjs
```

The script uses the app the way a debater would, with a made-up article, and saves the pictures to `docs/screenshots/`.

## Data format

Saved documents are described in `src/data/schema.ts`. `SCHEMA_VERSION` is written into the database and into every backup file. If a change makes old data unreadable, raise it and teach `src/core/backup/repair.ts` to fill in or convert the old shape; an older app refuses to open newer files, so it cannot damage them.

