# Third-party software

Policy Debate is released under the MIT License (see `LICENSE`). The app you download also contains the open-source libraries below. Each remains under its own licence.

## In both versions (the browser file and the desktop app)

| Library | What it does here | Licence |
|---|---|---|
| [Preact](https://preactjs.com) and [@preact/signals](https://github.com/preactjs/signals) | Draws the screens | MIT |
| [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | Reads the text of PDF files | Apache-2.0 |
| [Readability](https://github.com/mozilla/readability) (`@mozilla/readability`) | Finds the article inside a saved web page | Apache-2.0 |
| [JSZip](https://stuk.github.io/jszip/) | Reads and writes `.docx` files (used under its MIT option) | MIT or GPL-3.0-or-later |
| [pako](https://github.com/nodeca/pako) | Compression, used by JSZip | MIT and Zlib |
| [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) (`@anthropic-ai/sdk`) | Sends optional AI requests, with your own key | Apache-2.0 |

## In the desktop app only

| Library | What it does here | Licence |
|---|---|---|
| [Tauri](https://tauri.app) | The desktop window and installer | MIT or Apache-2.0 |
| [reqwest](https://github.com/seanmonstar/reqwest), [tokio](https://tokio.rs), [serde](https://serde.rs) and other Rust crates | Networking, background work, data handling | MIT or Apache-2.0 (most); see below |
| [keyring](https://github.com/open-source-cooperative/keyring-rs) | Stores the API key in the system keychain | MIT or Apache-2.0 |

The exact versions are recorded in `package-lock.json` and `src-tauri/Cargo.lock`. The full licence text of every package is in its own folder after `npm ci` (under `node_modules/`), and for Rust crates on [crates.io](https://crates.io). To list every Rust crate with its licence, run `cargo install cargo-license` and then `cargo license --manifest-path src-tauri/Cargo.toml`.

Licences marked Apache-2.0 require that this notice travels with copies of the software. If you pass the app on, pass this file on with it.

## Not software

- The 2026-27 policy debate resolution and the novice case limits are published by the NFHS. Speech times are from the rulebooks named in Settings → Timers.
- The app is not affiliated with, or endorsed by, the NSDA, the NFHS, Anthropic, Tabroom, openCaselist, or Paperless Debate (Verbatim).
