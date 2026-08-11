# AiSuperCam

A local, hand-controlled webcam playground. Create up to four areas and apply Mesh, ASCII, Thermal and Pixel effects at the same time.

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, then enable the camera. To validate the project:

```bash
npm test
npm run lint
npm run typecheck
```

## Controls

- Hold an **L with each hand** for half a second to create an area.
- **Pinch inside an area** to move it.
- **Pinch a corner** to resize it; two pinches on opposite corners scale it.
- Mouse and touch always work: drag to create, drag inside to move, and drag a corner to resize.
- Keyboard: `1–4` select effects, `C` creates an area, `R` clears all, `Delete` removes the selection, arrows move it, and `+/-` resize it.

Images and recordings download without area borders, handles, or gesture cursors. Webcam processing, hand tracking and rendering stay in the browser; no frame is uploaded to a server.

## Stack

- React 19 + vinext
- MediaPipe Tasks Vision, with models and WASM runtime served from `public/`
- Canvas 2D compositing and effects
- Railway hosting with Railpack

## Deploy to Railway

The repository includes `railway.json`, so Railway builds with `npm run build`, starts with `npm run start`, and checks `/` before marking the deployment healthy. The server reads Railway's `PORT` environment variable automatically.
