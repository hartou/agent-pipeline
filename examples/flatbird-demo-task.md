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

## Out Of Scope

- Frameworks, bundlers, packages, backends, auth, analytics, external images, or remote font/CDN dependencies.
- Product code outside the three files listed above.

## Suggested Role Assignment

- `deepseek-4-flash`: first-pass implementation of `index.html`, `styles.css`, and `game.js` when Fugu can split file-disjoint work.
- `gpt-5.4-mini`: QA/spec critic to write or refine checks and identify missing gameplay/UX requirements.
- `deepseek-v4-pro`: repair/integration hardener only after QA failure or when Fugu sees cross-file integration risk.
- `gpt-4o-mini`: utility-only work such as copy/i18n variants or tiny transformations.

## Acceptance

- The game is playable immediately after opening `index.html` or serving the folder locally.
- No console errors during normal play.
- Scoring increases after passing obstacles and high score persists with `localStorage`.
- Pause/resume and restart flows are visible and functional.
- Collision with ground or pipe ends the run.
- The layout remains usable at mobile and desktop viewport sizes.
- No external network requests are required.