import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the AiSuperCam studio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="it">/i);
  assert.match(html, /<title>AiSuperCam — effetti webcam controllati con le mani<\/title>/i);
  assert.match(html, /AiSuperCam/);
  assert.match(html, /Attiva fotocamera/);
  assert.match(html, /Prova la demo/);
  assert.match(html, /http:\/\/localhost\/og\.png/);
  assert.doesNotMatch(html, /Starter Project|Building your site|react-loading-skeleton/i);
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

  const page = await readFile(new URL("app/page.tsx", projectRoot), "utf8");
  assert.match(page, /import\("@mediapipe\/tasks-vision"\)/);
  assert.match(page, /MAX_ZONES = 4/);
  assert.match(page, /type EffectId = "mesh" \| "ascii" \| "thermal" \| "pixel"/);
  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});
