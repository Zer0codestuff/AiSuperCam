# Project guidance

## Purpose and architecture

AiSuperCam is a local-first webcam effects studio built with React, vinext, MediaPipe Tasks Vision, and Canvas 2D. The App Router UI lives in `app/`. Vision models and WASM files live in `public/`. The Railway deployment uses `railway.json`.

## Run, build, and test

- Install dependencies with `npm ci`.
- Start development with `npm run dev`.
- Run production checks with `npm test`, `npm run lint`, and `npm run typecheck`.

## Current status

The public app is deployed on Railway. Camera processing, hand tracking, rendering, image export, and recording run in the browser.

## Recent changes

- Pointed metadata fallback URLs to the live Railway deployment.
- Added a regression check for stale deployment origins.
- Documented the repository workflow and constraints.

## Project constraints

- Keep UI copy, code, comments, and documentation in English.
- Preserve local-only webcam processing and graceful mouse or touch fallback.
- Keep exported images and recordings free of editor controls.
- Bundle the required vision models and WASM assets locally.

## Known issues and next steps

- Dependency auditing currently reports transitive vulnerabilities that need a separate compatibility review.
- Browser verification requires camera permission and supported hardware.

## Do not

- Do not upload webcam frames to a server.
- Do not restore demo mode or disposable starter UI.
- Do not replace the Railway production URL with the retired Pages URL.
- Do not change the visual effects or interaction model without browser comparison.
