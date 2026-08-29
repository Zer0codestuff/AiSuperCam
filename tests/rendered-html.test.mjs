import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const { startProdServer } = await import(
    "../node_modules/vinext/dist/server/prod-server.js"
  );
  const { server, port } = await startProdServer({
    host: "127.0.0.1",
    port: 0,
    outDir: fileURLToPath(new URL("../dist", import.meta.url)),
    silent: true,
  });

  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { accept: "text/html" },
    });
    return { response, html: await response.text() };
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("server-renders the AiSuperCam studio", async () => {
  const { response, html } = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  assert.match(html, /<html lang="en">/i);
  assert.match(html, /<title>AiSuperCam - hand-controlled webcam effects<\/title>/i);
  assert.match(html, /AiSuperCam/);
  assert.match(html, /Enable camera/);
  assert.doesNotMatch(html, /Try demo|Demo mode/i);
  assert.match(
    html,
    /<meta property="og:image" content="https?:\/\/[^"]+\/og\.png">/,
  );
  assert.doesNotMatch(html, /Starter Project|Building your site|react-loading-skeleton/i);
});

test("uses the live Railway deployment as the metadata fallback", async () => {
  const layout = await readFile(new URL("app/layout.tsx", projectRoot), "utf8");
  assert.match(layout, /https:\/\/aisupercam-production\.up\.railway\.app/);
  assert.doesNotMatch(layout, /aisupercam\.pages\.dev/);
});

test("ships local vision assets and no disposable starter preview", async () => {
  const assets = [
    "public/models/hand_landmarker.task",
    "public/models/face_landmarker.task",
    "public/models/pose_landmarker_lite.task",
    "public/wasm/vision_wasm_internal.wasm",
    "public/og.png",
  ];

  for (const asset of assets) {
    const info = await stat(new URL(asset, projectRoot));
    assert.ok(info.size > 10_000, `${asset} should be a real bundled asset`);
  }

  const studio = await readFile(
    new URL("app/_components/ai-super-cam-studio.tsx", projectRoot),
    "utf8",
  );
  const config = await readFile(
    new URL("app/_lib/studio-config.ts", projectRoot),
    "utf8",
  );
  const types = await readFile(
    new URL("app/_lib/studio-types.ts", projectRoot),
    "utf8",
  );
  const visionSession = await readFile(
    new URL("app/_hooks/use-vision-session.ts", projectRoot),
    "utf8",
  );
  const renderer = await readFile(
    new URL("app/_hooks/use-studio-renderer.ts", projectRoot),
    "utf8",
  );
  const readme = await readFile(new URL("README.md", projectRoot), "utf8");
  assert.match(visionSession, /import\("@mediapipe\/tasks-vision"\)/);
  assert.match(visionSession, /outputSegmentationMasks: true/);
  assert.match(renderer, /zone\.effect === "aura"/);
  assert.match(config, /MAX_ZONES = 4/);
  assert.match(
    types,
    /type EffectId = "mesh" \| "ascii" \| "thermal" \| "pixel" \| "aura"/,
  );
  assert.match(readme, /!\[Original AiSuperCam visual concept\]\(\.\/public\/og\.png\)/);
  assert.doesNotMatch(studio, /\bdemo\b/i);
  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});
