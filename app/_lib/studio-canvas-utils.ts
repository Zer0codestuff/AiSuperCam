import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { clamp } from "./studio-geometry";
import type { Connection } from "./studio-types";

export const THERMAL_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [5, 1, 13],
  [36, 17, 79],
  [110, 27, 118],
  [198, 47, 101],
  [241, 90, 58],
  [253, 174, 50],
  [248, 241, 122],
  [255, 255, 255],
];

export const BAYER_4X4 = [
  0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5,
] as const;

function thermalColor(value: number): [number, number, number] {
  const position = clamp(value, 0, 1) * (THERMAL_STOPS.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(THERMAL_STOPS.length - 1, lower + 1);
  const amount = position - lower;
  return [
    Math.round(
      THERMAL_STOPS[lower][0] +
        (THERMAL_STOPS[upper][0] - THERMAL_STOPS[lower][0]) * amount,
    ),
    Math.round(
      THERMAL_STOPS[lower][1] +
        (THERMAL_STOPS[upper][1] - THERMAL_STOPS[lower][1]) * amount,
    ),
    Math.round(
      THERMAL_STOPS[lower][2] +
        (THERMAL_STOPS[upper][2] - THERMAL_STOPS[lower][2]) * amount,
    ),
  ];
}

export const THERMAL_LUT = (() => {
  const table = new Uint8ClampedArray(256 * 3);
  for (let index = 0; index < 256; index += 1) {
    const [red, green, blue] = thermalColor(index / 255);
    table[index * 3] = red;
    table[index * 3 + 1] = green;
    table[index * 3 + 2] = blue;
  }
  return table;
})();

export const THERMAL_GAMMA_LUT = (() => {
  const table = new Float32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    table[index] = Math.pow(index / (table.length - 1), 0.82);
  }
  return table;
})();

export function rgbLuminance(red: number, green: number, blue: number) {
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
}

export function adaptiveLuminanceRange(values: Float32Array, count: number) {
  const histogram = new Uint32Array(96);
  for (let index = 0; index < count; index += 1) {
    const bucket = Math.min(
      histogram.length - 1,
      Math.floor(clamp(values[index], 0, 1) * histogram.length),
    );
    histogram[bucket] += 1;
  }

  const percentile = (target: number) => {
    const threshold = count * target;
    let seen = 0;
    for (let index = 0; index < histogram.length; index += 1) {
      seen += histogram[index];
      if (seen >= threshold) return index / (histogram.length - 1);
    }
    return 1;
  };

  let low = percentile(0.04);
  let high = percentile(0.97);
  if (high - low < 0.16) {
    const middle = (low + high) / 2;
    low = clamp(middle - 0.08, 0, 0.84);
    high = clamp(middle + 0.08, 0.16, 1);
  }
  return { low, high };
}

export function normalizeLuminance(value: number, low: number, high: number) {
  return clamp((value - low) / Math.max(0.08, high - low), 0, 1);
}

export function estimatedSkinWarmth(red: number, green: number, blue: number) {
  const cb = 128 - red * 0.168736 - green * 0.331264 + blue * 0.5;
  const cr = 128 + red * 0.5 - green * 0.418688 - blue * 0.081312;
  const cbDistance = (cb - 108) / 24;
  const crDistance = (cr - 152) / 30;
  const chromaMatch = clamp(
    1 - (cbDistance * cbDistance + crDistance * crDistance) * 0.3,
    0,
    1,
  );
  const light = rgbLuminance(red, green, blue);
  return chromaMatch * clamp((light - 0.04) / 0.28, 0, 1);
}

export function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
}

export function drawConnections(
  context: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  connections: readonly Connection[],
  width: number,
  height: number,
  color: string,
  lineWidth: number,
  minVisibility = 0,
) {
  context.beginPath();
  for (const connection of connections) {
    const start = landmarks[connection.start];
    const end = landmarks[connection.end];
    if (!start || !end) continue;
    if (
      (start.visibility ?? 1) < minVisibility ||
      (end.visibility ?? 1) < minVisibility
    ) {
      continue;
    }
    context.moveTo((1 - start.x) * width, start.y * height);
    context.lineTo((1 - end.x) * width, end.y * height);
  }
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();
}

export function paintMirroredSegmentationMask(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  data: Float32Array,
  width: number,
  height: number,
) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const image = context.createImageData(width, height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const source = row * width + column;
      const target = (row * width + (width - column - 1)) * 4;
      const confidence = clamp((data[source] - 0.25) / 0.55, 0, 1);
      const alpha = confidence * confidence * (3 - 2 * confidence);
      image.data[target] = 255;
      image.data[target + 1] = 255;
      image.data[target + 2] = 255;
      image.data[target + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(image, 0, 0);
}
