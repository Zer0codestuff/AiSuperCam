import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_METRICS_HOST,
  isGoogleMetricsUrl,
} from "../app/_lib/google-metrics-url.mjs";

test("blocks the MediaPipe usage log host and nothing else", () => {
  assert.equal(GOOGLE_METRICS_HOST, "odml.pa.googleapis.com");
  assert.equal(
    isGoogleMetricsUrl("https://odml.pa.googleapis.com/v1/log"),
    true,
  );
  assert.equal(
    isGoogleMetricsUrl("https://odml.pa.googleapis.com.evil.example/v1/log"),
    false,
  );
  assert.equal(isGoogleMetricsUrl("https://example.com/odml.pa.googleapis.com"), false);
  assert.equal(isGoogleMetricsUrl("/wasm/vision_wasm_internal.wasm"), false);
  assert.equal(isGoogleMetricsUrl("not a url"), false);
});
