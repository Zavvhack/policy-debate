# Progress and self-review

This file is kept up to date after every stage, so a new session can pick up where the last one stopped.

## Where things stand

| Stage | What | Status |
|---|---|---|
| 0 | Project scaffold, tests, CI | Done |
| 1 | Round Mode: timers, flow, CX notes, AI lock, autosave, backups | Done |
| 2 | Library, card cutter, PDF/.docx/web import, .docx export/import, Google Docs copy, speech doc view | Done |
| 3 | AI prep tools: card cutting, blocks and templates, Topicality center, CX prep, rebuttal practice, scouting | Done |
| 4 | Desktop app (Tauri), release workflow, README, self-review | Done; see "Not verified" for what still needs a real-world check |

## Pre-launch review for 1.0.0

Each section of the review is recorded here as it is finished.

### 1. Safety and privacy

- **Secrets:** every line ever added or removed in the git history (17 commits) was searched for API keys, tokens, passwords, private keys and `.env` files. Nothing found. The only key-shaped string is the fake `sk-ant-test-key` typed into a test.
- **Personal information in the files:** none (no name, email, school or location). The example initials in the app and tests are `AB`.
- **Personal information in commit records:** the private development repository had commits made on github.com that carried the owner's personal email address. The public repository was therefore started fresh from the finished code, with one commit that carries no personal details. Future commits use GitHub's private "noreply" address.
- **Sample data:** there are no evidence files, backups or screenshots of real work in the repository. All test data is made up (`example.org`, "Maria Okafor", "Example University").
- **`.gitignore`** now also blocks secrets (`.env`, key files), app backups, and stray `.docx`/`.pdf` files.

### 2. Code review: what was found, and what was done

Listed from most to least serious. Everything marked **Fixed** has a test.

**Critical**

| # | Problem | Status |
|---|---|---|
| 1 | **Two windows of the app broke the "no AI in a round" rule.** A second browser tab that was already open kept offering AI after a round started in the first tab. | **Fixed.** The lock now reads the shared copy on every check, and the other tab switches to Round Mode at once. |
| 2 | **Two windows could overwrite each other's saves.** Each held its own copy of your files. | **Fixed.** Only one copy of the app loads your files; a second one shows "already open" (browser tabs and the desktop app). |
| 3 | **Undo on the flow could throw away typing, with no way back.** Alt+Z restored an old copy of the whole sheet, including the old words in every cell, and there was no redo. | **Fixed.** Undo now keeps the words in every cell, and Alt+Shift+Z is redo. |
| 4 | **One bug while drawing could blank the whole window**, including mid-round. | **Fixed.** A failed part of the screen is replaced by a message with "Try again"; in Round Mode the banner and timers keep running. |
| 5 | **A damaged or older saved file could crash a screen** (a round with no clock, a card with no highlight list). Only flows were being checked. | **Fixed.** Every saved item is checked and filled in when the app opens, when a backup is restored, and when something comes back from the trash. A card's words are never altered: a card with no text is left out. |
| 6 | **The crash journal could be wiped** if the window was closed while the app was still loading. | **Fixed.** |

**Important**

| # | Problem | Status |
|---|---|---|
| 7 | An older version of the app could write into files saved by a newer one. | **Fixed.** The files record their format; an older app refuses to open newer files and changes nothing. |
| 8 | The browser was never asked to keep the files permanently, so it could clear them when the disk filled up. | **Fixed.** The app asks at start-up, and Settings says whether the browser agreed. |
| 9 | Automatic snapshots are full copies; a large library stored 24 times over could fill storage and make saves fail. | **Fixed.** Snapshots are capped at about 150 MB in total (the newest three always stay). |
| 10 | Making a snapshot of a very large library could make the flow stutter mid-round. | **Fixed.** Large automatic snapshots wait for "End round". |
| 11 | Desktop: a web page could redirect "fetch this article" to an address on your own computer or network. | **Fixed.** Every redirect is checked. |
| 12 | Desktop: AI requests followed redirects, which could in theory carry the API key to another host. | **Fixed.** AI requests never follow redirects. |
| 13 | Desktop: a second running copy of the app did not know a round was on. | **Fixed.** The Rust core also checks the on-disk round marker before every AI request. |
| 14 | Closing the browser tab by accident mid-round (Ctrl+W) closed it without asking. | **Fixed.** The browser asks first during a round. (Nothing was lost either way.) |
| 15 | Keyboard users could not leave the flow grid, because Tab is used for flowing. | **Fixed.** Esc leaves the grid. |
| 16 | Saved settings were trusted as-is; a bad value could break a screen. | **Fixed.** Every setting is checked against its allowed range. |
| 17 | The Fedora install check hung for 15 minutes on the 0.1.0 release (a stalled download mirror), which cancelled that job. The release was still published. | **Fixed** with a time limit and three attempts. Passed on GitHub in 44 seconds. |

**Minor**

| # | Problem | Status |
|---|---|---|
| 18 | Typing with an input method (accents, Chinese, Japanese) could trigger flow shortcuts. | **Fixed.** |
| 19 | Screen readers heard every flow cell as "Flow cell". | **Fixed.** Cells now say which speech they are in. |
| 20 | Imported cards lose "bold but not highlighted" emphasis; PDFs with two columns can come out in the wrong order. | Not fixed. Documented under Known limitations. |
| 21 | No drag-and-drop on the flow; undo does not cover typing inside a cell (the text box's own Ctrl+Z does). | Not fixed. By design for now. |
| 22 | Web addresses that resolve to a private network address by DNS are not blocked by the desktop fetcher (only literal local addresses and redirects are). | Not fixed. Low risk: the user pastes the address themselves. |

### 3. Using the app without an AI key

- **AI controls never look broken.** With no key saved, each AI panel shrinks to one line: "Optional AI feature … needs your own Claude API key", with links to set it up or hide AI features. There are no buttons that lead to an error.
- **"Show AI features" switch** (Settings → AI, and the last step of the welcome). Off: every AI control and the one AI-only page (CX questions) disappear.
- **The menu** marks the AI-only page with an "AI" tag, and only says "Prep · AI allowed" when a key is saved.
- **First-launch welcome:** five short steps (what the app is, in a round, before a round, where your files live, AI is optional). Shown once; "Show the welcome again" is on the Home page.
- **Checked in a real browser with no key:** the cutter, library, blocks, templates, topicality, practice, scouting, rounds and settings all open with no error boxes, no dead AI buttons, no console errors and no network requests. The existing tests already cut a card by hand, flow a round, use templates and T files, and export a .docx without a key.
- The desktop app was rebuilt and driven through WebDriver: 26 checks pass, including the welcome and the no-key cutter.

### 4. Public-repository files

- `LICENSE` (MIT) and `THIRD-PARTY-NOTICES.md` (the libraries inside the app and their licences).
- `README.md` rewritten for debaters: what the app is, screenshots, downloads and install steps for Windows, macOS, Linux and the browser version (including the unsigned-app warnings), getting started, "Using AI responsibly", privacy, and how to report a bug.
- Screenshots in `docs/screenshots/`, taken from the real app by `scripts/screenshots.mjs` with made-up data.
- `CHANGELOG.md` starting at 1.0.0, `CONTRIBUTING.md`, `SECURITY.md`, and issue forms for bugs and ideas written for non-programmers.
- Build and code notes moved to `docs/DEVELOPING.md`. `legacy/` has a note saying it is not part of the app.

### 5. Version 1.0.0 and the release

- Version is **1.0.0** in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`. The desktop app reads its version from `package.json`.
- Release notes are now taken from `CHANGELOG.md` (the section for the tag's version), after a "Which file do I want?" table. Checked locally by running the step on a sample.
- The browser version's file is now always `policy-debate.html` (it used to include the version number). Some browsers tie saved work to the file's exact name, so a new version must be able to replace the old file under the same name. The README and Settings → Backup say to back up first and save the new file over the old one.
- A release with no HTML file now says so in its notes, like a missing platform.

**GitHub build of the 1.0.0 code** (Release run 13, from this branch): tests, the HTML file, and installers for Windows, macOS and Linux all built; the Linux build passed 26 checks in the real desktop window; the packages installed and opened on Fedora, Ubuntu 24.04, Debian 12 and Arch. The step that publishes a release only runs for a tag, so it has not run for 1.0.0 yet.

**Speed on a slow computer** (the browser version, processor slowed to a quarter of its speed, 3,000 cards and 300 articles, a 9 MB backup):

| What | Time |
|---|---|
| Restore the backup | 0.9 s |
| Open the app | 1.3 s |
| Open the library | 0.2 s |
| Search 3,000 cards | 0.2 s |
| Typing in a 400-cell flow | 20 ms per key |
| New flow cell | 0.1 s |
| End round (save and full snapshot) | 0.4 s |

## How to check it still works

```
npm ci
npm run check                        # type-check + 220 unit tests
npm run build:html && npm run e2e    # 20 tests in a real browser, against the built single file
cargo test --manifest-path src-tauri/Cargo.toml          # 8 Rust tests
npm run tauri build -- --debug --no-bundle
xvfb-run -a node tests/desktop/smoke.mjs src-tauri/target/debug/policy-debate   # 26 checks in the real desktop window
```

---

## Self-review

### What was verified, and how

| Claim | How it was checked |
|---|---|
| A card's text always matches its source | 57 unit tests: 14 kinds of tampering are each rejected (changed word, removed "not", fixed typo, straightened quote, look-alike letter, invisible character, spliced sentences...); 400 random highlight edits leave the text unchanged; AI answers carrying their own text are ignored; bad word numbers are rejected. Also checked in a real browser with a simulated AI. |
| AI cannot invent cite details | Every cite field is looked up in the article; tests cover an invented author, year, date, qualification, title and publication. |
| No AI during a round | The lock fails closed before it loads, survives restarts and a cleared localStorage, cancels in-flight requests, discards late answers, and blocks SDK retries. A test follows every import reachable from Round Mode and fails if the AI client or the AI tasks appear. On desktop, WebDriver tests show the Rust core refuses requests during a round and that the window has no network access of its own. |
| Flows save and load exactly | Round-trip through a real IndexedDB implementation, including a restart mid-typing, a damaged saved flow, and a write cut off half-way. |
| Timers are accurate | Irregular ticks, a 90-second gap, 500 pause/resume cycles, a clock set backwards, and a restart mid-run all give the exact remaining time. |
| .docx export is correct | The generated XML is checked run by run against the card format; the file is re-read by the app's own importer and gives back the same text, marks, tag and cite. |
| The single-file app works offline | Playwright opens the built file from `file://` and fails the test if any network request is made. |
| Linux desktop build | Built on GitHub (Ubuntu 22.04 runner) with all 23 desktop checks passing there too. The packages were then installed and started in clean containers: **Fedora 45 (.rpm), Ubuntu 24.04 (.deb), Debian 12 (.deb) and Arch (AppImage)**. Each opened a real 1280x800 "Policy Debate" window. |
| Debate facts | Resolution and novice limits from NFHS; times, evidence and AI rules from the NSDA 2026-27 Unified Manual (v2027.1.2); BDL times from its Speech Order Guide; college times from the NDT Standing Rules. Each timer preset stores its source. |
| Windows and macOS builds | Built on GitHub: Windows `.msi` and `-setup.exe`; one universal macOS `.dmg` (Apple Silicon + Intel). `macos-latest` never got a runner in testing, so the workflow uses `macos-15`. |
| Readability | Every text/background pair in both themes meets WCAG AA (4.5:1); black text on both highlight colours is above 10:1. |

### Not verified (please check these)

1. **Real AI requests.** No API key was available, so nothing was ever sent to Anthropic. The request shape was written from the current SDK (1.7.0) and its documentation, and tested against a simulated API. The first real "Cut with AI" is the true test. If it fails, the error message on screen says why.
2. **Windows and macOS.** Both build on GitHub, but neither app has ever been opened. There is no automated launch check on those systems, unlike Linux.
3. **Nobara / KDE Plasma specifically.** The `.rpm` installs and opens on Fedora 45 (the base Nobara is built on), but only on a virtual display. Wayland, KWallet and the file dialog on a real Plasma desktop are untested.
4. **The OS keychain.** The code path runs, but the test machine has no keyring service, so storing and reading a real key was not exercised.
5. **Fetching a URL in the desktop app.** The guards were tested; a successful fetch of a live article was not (the test sandbox's network proxy blocks it). Many news sites also block automated fetching, so expect some "paste it instead" messages.
6. **Word and Verbatim themselves.** The .docx was validated structurally and by re-import, not opened in Microsoft Word, Google Docs or Verbatim. The Verbatim style names (`Style13ptBold`, `StyleUnderline`, `Emphasis`) are from memory of Verbatim-made files.
7. **A full round at speed.** The flow was tested for correctness, not by a debater flowing a real 2NC.
8. **Debate facts I could not confirm:**
   - NFHS says there are *four* novice case limits but lists three. Three are included.
   - No state could be confirmed as still using 8-4 times (Missouri's manual says 8-3-5), so there is no 8-4 preset.
   - "5 minutes of prep in some leagues" was not confirmed from a rulebook, so there is no such preset; copy a preset and change it.
   - Whether your own league bans AI in rounds: check its rules. The app assumes the strictest answer.
   - The "debate circuit" tools site was not identified. `circuitdebater.org` exists but is a wiki, and was returning an error.

### Known limitations

- **PDFs:** text is rebuilt from page positions. Scans have no text; two-column layouts and footnotes can come out in the wrong order. The app says so every time.
- **Imported cards** keep their cite as one line of text, and "bold + underlined but not highlighted" becomes plain underline.
- **No Flatpak.** AppImage, .deb and .rpm only.
- **Unsigned builds:** Windows and macOS show a warning on first launch (README explains).
- **Windows 10** needs internet once, at install, to fetch Microsoft's WebView2.
- **AI answers do not stream:** you see a "Working…" message until the whole answer arrives.
- **Browser version:** data lives in that browser on that computer, not on the USB drive. Backups are manual.
- **One device at a time.** There is no sync or partner sharing.
- **Flow:** no drag-and-drop (keyboard and buttons only); undo covers adding, deleting and moving cells, not typing across cells.
- **Dropped-argument hints** look only at whether something is attached to a cell, not at what the answer says.
- **GitHub Actions cost:** the repository is private, so build minutes are metered and macOS/Windows count for more.

### Top next improvements

1. Use it in a real practice round and fix whatever slows the flow down.
2. Open an exported .docx in Word with Verbatim installed, and adjust style names if Verbatim's tools do not recognise them.
3. Streamed AI answers, and a per-month spending total.
4. A "portable mode" for the browser version that saves to a file on the USB drive (possible in Chromium browsers).
5. Flow export to .xlsx or .docx for sharing with a coach.
6. Partner sharing of files (a shared folder, not a server).
7. Flatpak, and code signing if the app is ever shared widely.
8. Optional OCR for scanned PDFs.

---

## Decisions made without asking (the owner was asleep)

Each is easy to change later.

1. **Stack:** Tauri 2 + TypeScript + Preact + Vite. One codebase, two builds.
2. **Storage:** IndexedDB in both versions; the desktop app also writes every automatic backup to disk.
3. **Flow columns:** separate 2NC and 1NR columns by default (as the brief says), with a per-round switch to merge them into one "Block" column.
4. **Flow model:** cells form a tree (an answer is attached to the argument it answers); the grid is computed from that.
5. **Dropped arguments:** the app only suggests ("no answer?"). You confirm with Ctrl+D.
6. **Practice rounds lock AI too.**
7. **Timer presets:** only formats confirmed from a rulebook are built in.
8. **Novice case limits:** the three NFHS lists, with a note about "four".
9. **Old card cutter** moved to `legacy/card-cutter.html`, unchanged.
10. **Licence:** MIT, added in the 1.0.0 review as the owner asked.
11. **No Flatpak** in the first version.
12. **Card text is immutable.** There is deliberately no way to edit a card's body.
13. **Imported cards keep their cite as written** and are labelled "not checked against a source".
14. **Cite checking** applies to hand-typed cites as well as AI suggestions (flag, not block).
15. **Autosave:** written within 0.8 s even during non-stop typing; anything unconfirmed when the window closes goes to a crash journal.
16. **Desktop AI requests go through Rust**, which holds the key and refuses during a round. The window has no network access.
17. **AI models:** Claude Haiku 5.5 for formatting and Claude Opus 5.5 for strategy by default; both can be changed in Settings.
18. **AI cutting is word-level only.** AI cannot highlight part of a word; you can, by hand, and the app warns when you do.
19. **Topics:** cards, blocks and T files belong to a topic; templates and judges are shared across topics.
20. **Scouting never reads from Tabroom or openCaselist.** It links out. Tabroom has no public API.
21. **Browser API key:** kept for the tab only unless you tick "Remember".
22. **The branch was merged with `main`** (not rebased) after pull request #1 was merged, because rewriting pushed history was blocked.

## Things only the owner can do

- **Keep "Keep my email addresses private" switched on** (github.com → Settings → Emails), so no future commit carries a personal address.
- **Merge the 1.0.0 work into `main`, then create the `v1.0.0` tag** from GitHub's Releases page. This session cannot push tags.
- **Make the repository public** (Settings → General → Danger Zone → Change visibility). Public repositories also build for free.
- Paste in the repository description and topics.
- Try the app on your Nobara laptop, and on a Windows and a Mac computer if you can borrow them, and report what breaks.
- Put a real API key in and try one AI cut.
