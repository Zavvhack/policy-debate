# Changelog

What changed in each version, newest first. Versions are numbered `major.minor.patch`:
a new first number means something you rely on changed, a new middle number means new features, and a new last number means fixes only.

## 1.0.0

The first public release.

### In a round (no AI)

- **Flow** with the keyboard: one column per speech, a sheet for each position, answers attached to the arguments they answer, extensions, turns, dropped-argument hints, undo and redo.
- **Timers** for every speech and cross-examination and for each team's prep, with a warning before time runs out and a full-screen clock. Presets for NSDA high school, college, and Boston Debate League times, or make your own.
- **Docs:** read the cards, blocks and topicality files you prepared, and collect them into a speech doc.
- **CX notes** for each cross-examination, and your own scouting notes on the opponent and judge.
- **Round Mode lock:** starting a round switches every AI feature off in the code itself. Only ending the round switches it back on.

### Before a round

- **Card cutter:** paste an article or open a PDF, Word file or saved web page (the desktop app can also fetch a web address). Mark what you will read. A card's words are copied from the source and checked against it, and cannot be edited.
- **Library:** search every card, block and topicality file. Export to Word (`.docx`, compatible with Verbatim) or copy into Google Docs with formatting.
- **Blocks** with eleven fill-in-the-blank templates, **topicality** shells and answers built on your own definition cards, timed **rebuttal practice**, and **scouting** notes for teams, judges and tournaments.
- **Topics:** the 2026-27 national health insurance resolution is built in. Add next year's in Settings.

### Optional AI (Prep only, with your own Claude API key)

- Suggest which words of an article to underline and highlight. The AI answers with word numbers only, so it cannot change the text.
- Draft block points, topicality shells and cross-examination questions, and give feedback on practice speeches. Everything it writes is labelled "AI draft".
- Cite details and quotes it gives are checked against your material and flagged or dropped if they are not there.
- **Without a key, nothing is missing or broken:** AI controls shrink to a one-line note, or can be hidden completely.

### Your files

- Everything stays on your computer. There is no account and no server.
- Saved automatically within a second, with recovery if the window closes mid-save.
- A trash for deleted items, automatic snapshots, and backup files you can move between computers.

### Two forms, one codebase

- **Desktop app** for Linux (`.rpm`, `.deb`, `.AppImage`), Windows 10 and 11, and macOS (Apple Silicon and Intel).
- **Browser version:** one `.html` file that works offline, including from a USB drive.

### Since the private 0.1.0 preview

- Fixed: with the app open in two browser tabs, the second tab could still offer AI after a round started in the first. Only one copy of the app now loads your files, and the lock is checked across windows.
- Fixed: undo on the flow could discard words typed after the step being undone. Undo now keeps your typing, and there is a redo (`Alt+Shift+Z`).
- Fixed: a bug while drawing one part of the screen could blank the whole window. That part now shows a message with "Try again".
- Fixed: damaged or older saved files are repaired when the app opens, instead of crashing a screen. Card text is never altered.
- Added: a first-launch welcome, the "Show AI features" switch, and a prompt before closing the browser tab during a round.
- Added: `Esc` leaves the flow grid, for keyboard users.
- Changed: the browser version's file is now always called `policy-debate.html`, so replacing the old file with a new one keeps your saved work.
