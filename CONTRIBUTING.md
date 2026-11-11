# Contributing

Thanks for wanting to help. You do not need to be a programmer to contribute.

## Ways to help

- **Report a bug** or **suggest a feature:** open the [Issues page](https://github.com/Zavvhack/policy-debate/issues/new/choose) and pick a form. Short and specific is perfect.
- **Check a debate fact.** If a speech time, a rule or a resolution in the app is wrong for your league, say so in an issue and link the rulebook.
- **Try it on your computer** and tell us what happened, especially on Windows and macOS, which get the least testing.
- **Change the code.** See below.

## Three rules the code may never break

1. **No AI during a round, ever.** Nothing under `src/features/round/` may reach the AI client, and only `src/ai/client.ts` may contact the AI service. Tests enforce both.
2. **Evidence is never reworded.** A card's text comes from its source and must match it exactly. AI may only mark spans of the original text. There is deliberately no way to edit a card's body.
3. **Nothing leaves the computer** except AI requests the user starts (to `api.anthropic.com` only) and, in the desktop app, pages the user asks it to fetch. No analytics, no accounts, no server.

A change that weakens any of these will not be merged, however useful it is otherwise.

## Changing the code

1. Fork the repository and make a branch.
2. Set up: `npm ci` (you need [Node.js](https://nodejs.org) 22 or newer). [docs/DEVELOPING.md](docs/DEVELOPING.md) has the details, including the desktop app.
3. Make your change, with a test for it. Keep comments plain: the code is meant to be readable by a student.
4. Run the checks:

   ```
   npm run check
   npm run build:html && npm run e2e
   ```

5. Open a pull request that says what changed and why. Screenshots help for anything visible.

## Please do not

- Add scraping of Tabroom or openCaselist. The app links to them and nothing more.
- Add anything that phones home, or a dependency that does.
- Paste real evidence files, real names of students, or API keys into issues, tests or screenshots. Test data should be made up.

## Conduct

Be kind and assume good intent. Many people here are students.
