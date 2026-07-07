# FlatBird Demo Task

Use this task to smoke-test the faster delivery roster after installing Agent Pipeline into a fresh static web repo.

## Goal

Build a polished, fast-loading FlatBird browser game as the first screen of the app.

## Scope

- Static frontend only: `index.html`, `styles.css`, and `game.js`.
- Canvas-based gameplay with `requestAnimationFrame`.
- Keyboard, pointer, and touch input.
- Pipes/obstacles, collision, scoring, high score persistence, pause/resume, restart, and a difficulty ramp.
- Responsive layout that works on desktop and mobile.
- A restrained, production-quality visual style: clear typography, crisp controls, no external assets, no network calls.
- A clean browser console, including no missing favicon request. Use an inline data URL favicon or local favicon file if needed.

## Out Of Scope

- Frameworks, bundlers, packages, backends, auth, analytics, external images, or remote font/CDN dependencies.
- Product code outside the three files listed above.

## Suggested Role Assignment

- `deepseek-4-flash`: first-pass implementation of `index.html`, `styles.css`, and `game.js` when Fugu can split file-disjoint work.
- `gpt-5.4-mini`: mandatory QA/spec critic build step. If the repo already has a deterministic checker, refine that checker in place instead of creating a second checker. It should not edit product gameplay files.
- `deepseek-v4-pro`: conditional repair/integration hardener only after QA failure or when Fugu sees concrete cross-file integration risk. Do not schedule it as an unconditional final polish pass.
- `gpt-4o-mini`: utility-only work such as copy/i18n variants or tiny transformations.

## Required Orchestration Shape

- Plan at least one `gpt-5.4-mini` QA/spec critic subtask that owns `scripts/check-flatbird.mjs` when that file exists, or otherwise owns one clearly named checker file. Do not create duplicate checkers for the same acceptance surface.
- Prefer `deepseek-4-flash` for product implementation subtasks.
- Use `deepseek-v4-pro` only for a minimal repair plan after failed QA or an explicit integration-risk finding from Fugu.

## Acceptance

- The game is playable immediately after opening `index.html` or serving the folder locally.
- No console errors during normal play.
- Scoring increases after passing obstacles and high score persists with `localStorage`.
- Pause/resume and restart flows are visible and functional.
- Collision with ground or pipe ends the run.
- The layout remains usable at mobile and desktop viewport sizes.
- No external network requests are required.
- Browser review should not show a missing favicon request or runtime console errors.