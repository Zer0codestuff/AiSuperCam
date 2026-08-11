export const ASCII_RAMP = " .:-=+*#%@";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mix(first, second, amount) {
  return first + (second - first) * amount;
}

function quantizeInk(value) {
  return clamp(Math.round(clamp(value, 0, 248) / 8) * 8, 0, 248);
}

/**
 * Keeps glyph selection independent from color while preserving truly empty
 * cells in the deepest shadows.
 * @param {number} tone
 */
export function asciiGlyph(tone) {
  const normalized = clamp(tone, 0, 1);
  if (normalized < 0.075) return ASCII_RAMP[0];
  const index = Math.max(
    1,
    Math.round(normalized * (ASCII_RAMP.length - 1)),
  );
  return ASCII_RAMP[index];
}

/**
 * Expands midtones without changing the color-derived density decision.
 * @param {number} center
 * @param {number} edge
 */
export function asciiTone(center, edge = 0) {
  return clamp(
    Math.pow(clamp(center, 0, 1), 0.78) + clamp(edge, 0, 0.12),
    0,
    1,
  );
}

/**
 * Produces a bright, stable cell color while preserving the source channel
 * dominance. Near-neutral cells receive a subtle violet/cyan/warm accent.
 * @param {Uint8ClampedArray | number[]} data
 * @param {number} index
 * @param {number} tone
 */
export function asciiInkColorInto(data, index, tone) {
  const normalized = clamp(tone, 0, 1);
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  const sourceLight = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const targetLight = 148 + normalized * 86;
  const chromaBoost = 1.22;
  const liftedRed = targetLight + (red - sourceLight) * chromaBoost;
  const liftedGreen = targetLight + (green - sourceLight) * chromaBoost;
  const liftedBlue = targetLight + (blue - sourceLight) * chromaBoost;

  const sourceChroma = Math.max(red, green, blue) - Math.min(red, green, blue);
  const neutralMix = clamp((34 - sourceChroma) / 34, 0, 1) * 0.52;
  let accentRed;
  let accentGreen;
  let accentBlue;
  if (normalized <= 0.55) {
    const amount = normalized / 0.55;
    accentRed = mix(167, 103, amount);
    accentGreen = mix(139, 232, amount);
    accentBlue = mix(250, 249, amount);
  } else {
    const amount = (normalized - 0.55) / 0.45;
    accentRed = mix(103, 255, amount);
    accentGreen = mix(232, 247, amount);
    accentBlue = mix(249, 230, amount);
  }
  data[index] = quantizeInk(mix(liftedRed, accentRed, neutralMix));
  data[index + 1] = quantizeInk(mix(liftedGreen, accentGreen, neutralMix));
  data[index + 2] = quantizeInk(mix(liftedBlue, accentBlue, neutralMix));
  data[index + 3] = Math.round((0.76 + normalized * 0.24) * 255);
}

/**
 * Convenience wrapper for deterministic tests and non-realtime consumers.
 * The renderer uses asciiInkColorInto() to avoid per-cell allocations.
 * @param {number} red
 * @param {number} green
 * @param {number} blue
 * @param {number} tone
 * @returns {[number, number, number, number]}
 */
export function asciiInkColor(red, green, blue, tone) {
  /** @type {[number, number, number, number]} */
  const color = [red, green, blue, 255];
  asciiInkColorInto(color, 0, tone);
  return color;
}
