# AiSuperCam

Un playground webcam locale controllato con le mani. Crea fino a quattro aree e applica, anche contemporaneamente, effetti Mesh, ASCII, Termico e Pixel.

## Avvio

Richiede Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Apri `http://localhost:3000`, attiva la fotocamera oppure scegli **Prova la demo**. Per verificare la build:

```bash
npm test
```

## Controlli

- Forma una **L con entrambe le mani** e mantienile ferme per creare un’area.
- Fai **pinch dentro l’area** per spostarla.
- Fai **pinch su un angolo** per ridimensionarla; due pinch sugli angoli opposti scalano l’area.
- Con mouse o touch: trascina sul video per creare, dentro l’area per spostare, dagli angoli per ridimensionare.
- Tastiera: `1–4` effetti, `C` nuova area, `R` reset, `Delete` elimina, frecce spostano, `+/-` ridimensionano.

Foto e registrazioni vengono scaricate dal browser senza bordi, maniglie o cursori. Webcam, rilevamento e rendering restano nel browser: nessun frame viene caricato su un server.

## Stack

- React 19 + vinext
- MediaPipe Tasks Vision, con modelli e runtime WASM serviti da `public/`
- Canvas 2D per compositing ed effetti
- Cloudflare Sites per la pubblicazione
