import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { MIN_ZONE_H, MIN_ZONE_W } from "./studio-config";
import type { Corner, Point, Rect } from "./studio-types";

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function landmarkPoint(landmark: NormalizedLandmark): Point {
  return { x: 1 - landmark.x, y: landmark.y };
}

export function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function clampRect(rect: Rect): Rect {
  const w = clamp(rect.w, MIN_ZONE_W, 1);
  const h = clamp(rect.h, MIN_ZONE_H, 1);
  return {
    x: clamp(rect.x, 0, 1 - w),
    y: clamp(rect.y, 0, 1 - h),
    w,
    h,
  };
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function pointInRect(point: Point, rect: Rect, padding = 0) {
  return (
    point.x >= rect.x - padding &&
    point.x <= rect.x + rect.w + padding &&
    point.y >= rect.y - padding &&
    point.y <= rect.y + rect.h + padding
  );
}

export function cornersForRect(rect: Rect): Record<Corner, Point> {
  return {
    nw: { x: rect.x, y: rect.y },
    ne: { x: rect.x + rect.w, y: rect.y },
    se: { x: rect.x + rect.w, y: rect.y + rect.h },
    sw: { x: rect.x, y: rect.y + rect.h },
  };
}

export function oppositeCorner(rect: Rect, corner: Corner): Point {
  const corners = cornersForRect(rect);
  const opposite: Record<Corner, Corner> = {
    nw: "se",
    ne: "sw",
    se: "nw",
    sw: "ne",
  };
  return corners[opposite[corner]];
}
