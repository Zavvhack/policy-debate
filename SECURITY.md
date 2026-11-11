# Security

## Reporting a problem

If you find a way to make the app do something it should not (for example: use AI during a round, change a card's text, read the saved API key, or send data somewhere), please report it **privately** first:

1. Open the repository's **Security** tab on GitHub.
2. Choose **Report a vulnerability**.

If that option is not there, open a normal issue that says only "I have a security report" and a maintainer will arrange a private way to share the details. Please do not post the details in public until there is a fix.

## What the app does to protect you

- **No server and no account.** Your files stay on your computer.
- **The API key** is optional. In the desktop app it is kept in the operating system's keychain and never enters the app window. In the browser version it is kept in that browser only, for the tab by default; Settings → AI explains the choice.
- **The desktop app's window has no network access.** Only two things can go out: AI requests you start (to `api.anthropic.com` only) and pages you ask it to fetch (never addresses on your own computer or network).
- **Builds are made by GitHub** from this repository's code. Each release lists SHA-256 checksums so you can check a download.

## Supported versions

Fixes go into the newest release. Please update before reporting.
