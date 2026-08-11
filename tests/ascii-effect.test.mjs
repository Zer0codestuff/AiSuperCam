import assert from "node:assert/strict";
import test from "node:test";

import {
  ASCII_RAMP,
  asciiGlyph,
  asciiInkColor,
  asciiInkColorInto,
  asciiTone,
} from "../app/ascii-effect.mjs";

test("ASCII density preserves empty shadows and spans the full ramp", () => {
  assert.equal(ASCII_RAMP, " .:-=+*#%@");
  assert.equal(asciiGlyph(0), " ");
  assert.equal(asciiGlyph(0.074), " ");
  assert.equal(asciiGlyph(0.08), ".");
  assert.equal(asciiGlyph(0.5), "+");
  assert.equal(asciiGlyph(1), "@");
  assert.ok(asciiTone(0.35, 0.1) > asciiTone(0.35, 0));
  assert.equal(asciiTone(0.35, 0.2), asciiTone(0.35, 0.12));
});

test("ASCII ink keeps source colors distinct at equal density", () => {
  const red = asciiInkColor(60, 0, 0, 0.5);
  const green = asciiInkColor(0, 18, 0, 0.5);
  const blue = asciiInkColor(0, 0, 177, 0.5);

  assert.ok(red[0] > red[1] && red[0] > red[2]);
  assert.ok(green[1] > green[0] && green[1] > green[2]);
  assert.ok(blue[2] > blue[0] && blue[2] > blue[1]);
  const perceivedLight = ([redChannel, greenChannel, blueChannel]) =>
    redChannel * 0.2126 + greenChannel * 0.7152 + blueChannel * 0.0722;
  [red, green, blue].forEach((color) => {
    assert.ok(perceivedLight(color) >= 170);
  });
  assert.equal(asciiGlyph(0.5), "+");
});

test("ASCII ink lifts neutrals, quantizes color and keeps valid channels", () => {
  const neutral = asciiInkColor(90, 90, 90, 0.45);
  assert.notEqual(neutral[0], neutral[2]);

  for (const input of [
    [0, 0, 0, 0],
    [255, 255, 255, 1],
    [210, 155, 120, 0.65],
    [20, 220, 245, 0.4],
  ]) {
    const color = asciiInkColor(...input);
    color.forEach((channel) => {
      assert.ok(Number.isInteger(channel));
      assert.ok(channel >= 0 && channel <= 255);
    });
    color.slice(0, 3).forEach((channel) => assert.equal(channel % 8, 0));
  }

  assert.ok(asciiInkColor(120, 80, 40, 0.9)[3] > neutral[3]);
});

test("realtime ASCII ink writes the same color without replacing its buffer", () => {
  const pixels = new Uint8ClampedArray([60, 0, 0, 255, 90, 90, 90, 255]);
  const identity = pixels.buffer;
  asciiInkColorInto(pixels, 0, 0.5);
  asciiInkColorInto(pixels, 4, 0.45);

  assert.equal(pixels.buffer, identity);
  assert.deepEqual([...pixels.slice(0, 4)], asciiInkColor(60, 0, 0, 0.5));
  assert.deepEqual([...pixels.slice(4, 8)], asciiInkColor(90, 90, 90, 0.45));
});
