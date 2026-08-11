"use client";

import {
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
} from "react";
import { MAX_ZONES, MIN_ZONE_H, MIN_ZONE_W } from "../_lib/studio-config";
import {
  clamp,
  clampRect,
  cornersForRect,
  midpoint,
  oppositeCorner,
  pointInRect,
  rectBetween,
  rectCenter,
} from "../_lib/studio-geometry";
import type {
  AppStatus,
  Corner,
  EffectId,
  GestureOperation,
  GestureTrack,
  PinchMemory,
  Point,
  PointerOperation,
  Rect,
  Zone,
} from "../_lib/studio-types";

type UseStudioGesturesOptions = {
  status: AppStatus;
  zonesRef: MutableRefObject<Zone[]>;
  selectedIdRef: MutableRefObject<string | null>;
  activeEffectRef: MutableRefObject<EffectId>;
  addZone: (effect: EffectId, rect: Rect) => Zone | null;
  updateZone: (zoneId: string, updater: (zone: Zone) => Zone) => void;
  syncZones: (zones: Zone[]) => void;
  syncSelected: (zoneId: string | null) => void;
};

export function useStudioGestures({
  status,
  zonesRef,
  selectedIdRef,
  activeEffectRef,
  addZone,
  updateZone,
  syncZones,
  syncSelected,
}: UseStudioGesturesOptions) {
  const pointerOperationRef = useRef<PointerOperation | null>(null);
  const gestureOperationRef = useRef<GestureOperation>({ kind: "idle" });
  const pinchMemoryRef = useRef<Map<string, PinchMemory>>(new Map());
  const gestureTracksRef = useRef<GestureTrack[]>([]);
  const creationPreviewRef = useRef<{ rect: Rect; progress: number } | null>(null);
  const lStableRef = useRef<{
    rect: Rect;
    pairKey: string;
    stableSince: number;
    lastAt: number;
  } | null>(null);
  const lLatchedRef = useRef(false);
  const lReleaseSinceRef = useRef<number | null>(null);
  const gestureCooldownRef = useRef(0);
  const gestureLabelRef = useRef("Two Ls to create");

  const syncGestureLabel = useCallback((message: string) => {
    if (gestureLabelRef.current === message) return;
    gestureLabelRef.current = message;
  }, []);

  const resetGestureState = useCallback(() => {
    pointerOperationRef.current = null;
    gestureOperationRef.current = { kind: "idle" };
    pinchMemoryRef.current.clear();
    gestureTracksRef.current = [];
    creationPreviewRef.current = null;
    lStableRef.current = null;
    lLatchedRef.current = false;
    lReleaseSinceRef.current = null;
    gestureCooldownRef.current = 0;
    syncGestureLabel("Two Ls to create");
  }, [syncGestureLabel]);

  const pointFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
      const bounds = event.currentTarget.getBoundingClientRect();
      return {
        x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
        y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
      };
    },
    [],
  );

  const hitCorner = useCallback(
    (point: Point, zone: Zone, canvas: HTMLCanvasElement) => {
      const bounds = canvas.getBoundingClientRect();
      const radius = 28;
      for (const [corner, cornerPoint] of Object.entries(
        cornersForRect(zone.rect),
      ) as Array<[Corner, Point]>) {
        const pixelDistance = Math.hypot(
          (point.x - cornerPoint.x) * bounds.width,
          (point.y - cornerPoint.y) * bounds.height,
        );
        if (pixelDistance <= radius) return corner;
      }
      return null;
    },
    [],
  );

  const findTopZone = useCallback(
    (point: Point) =>
      [...zonesRef.current]
        .reverse()
        .find((zone) => pointInRect(point, zone.rect)),
    [zonesRef],
  );

  const onCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (status !== "ready") return;
      event.currentTarget.setPointerCapture(event.pointerId);
      gestureOperationRef.current = { kind: "idle" };
      lStableRef.current = null;
      const point = pointFromPointer(event);
      const selected = zonesRef.current.find(
        (zone) => zone.id === selectedIdRef.current,
      );
      const ordered = selected
        ? [
            selected,
            ...zonesRef.current
              .filter((zone) => zone.id !== selected.id)
              .reverse(),
          ]
        : [...zonesRef.current].reverse();

      for (const zone of ordered) {
        const corner = hitCorner(point, zone, event.currentTarget);
        if (corner) {
          syncSelected(zone.id);
          pointerOperationRef.current = {
            kind: "resize",
            zoneId: zone.id,
            corner,
            fixed: oppositeCorner(zone.rect, corner),
          };
          return;
        }
      }

      const hit = findTopZone(point);
      if (hit) {
        syncZones([
          ...zonesRef.current.filter((zone) => zone.id !== hit.id),
          hit,
        ]);
        syncSelected(hit.id);
        pointerOperationRef.current = {
          kind: "move",
          zoneId: hit.id,
          startPointer: point,
          startRect: hit.rect,
        };
        return;
      }

      syncSelected(null);
      pointerOperationRef.current = {
        kind: "create",
        start: point,
        current: point,
      };
    },
    [
      findTopZone,
      hitCorner,
      pointFromPointer,
      selectedIdRef,
      status,
      syncSelected,
      syncZones,
      zonesRef,
    ],
  );

  const onCanvasPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const operation = pointerOperationRef.current;
      if (!operation) return;
      const point = pointFromPointer(event);

      if (operation.kind === "create") {
        pointerOperationRef.current = { ...operation, current: point };
        creationPreviewRef.current = {
          rect: rectBetween(operation.start, point),
          progress: 0.34,
        };
        return;
      }

      if (operation.kind === "move") {
        const deltaX = point.x - operation.startPointer.x;
        const deltaY = point.y - operation.startPointer.y;
        updateZone(operation.zoneId, (zone) => ({
          ...zone,
          rect: clampRect({
            ...operation.startRect,
            x: operation.startRect.x + deltaX,
            y: operation.startRect.y + deltaY,
          }),
        }));
        return;
      }

      updateZone(operation.zoneId, (zone) => ({
        ...zone,
        rect: clampRect(rectBetween(operation.fixed, point)),
      }));
    },
    [pointFromPointer, updateZone],
  );

  const onCanvasPointerUp = useCallback(() => {
    const operation = pointerOperationRef.current;
    pointerOperationRef.current = null;
    creationPreviewRef.current = null;
    if (!operation || operation.kind !== "create") return;
    const rect = rectBetween(operation.start, operation.current);
    if (rect.w >= MIN_ZONE_W && rect.h >= MIN_ZONE_H) {
      addZone(activeEffectRef.current, rect);
    }
  }, [activeEffectRef, addZone]);

  const findGestureTarget = useCallback(
    (point: Point, canvasWidth: number, canvasHeight: number) => {
      const handleRadius = 28;
      const selected = zonesRef.current.find(
        (zone) => zone.id === selectedIdRef.current,
      );
      const ordered = selected
        ? [
            selected,
            ...zonesRef.current
              .filter((zone) => zone.id !== selected.id)
              .reverse(),
          ]
        : [...zonesRef.current].reverse();
      for (const zone of ordered) {
        for (const [corner, cornerPoint] of Object.entries(
          cornersForRect(zone.rect),
        ) as Array<[Corner, Point]>) {
          if (
            Math.hypot(
              (point.x - cornerPoint.x) * canvasWidth,
              (point.y - cornerPoint.y) * canvasHeight,
            ) <= handleRadius
          ) {
            return { zone, corner };
          }
        }
      }
      const zone = [...zonesRef.current]
        .reverse()
        .find((candidate) => pointInRect(point, candidate.rect));
      return zone ? { zone, corner: null } : null;
    },
    [selectedIdRef, zonesRef],
  );

  const finishGestureOperation = useCallback(() => {
    gestureOperationRef.current = { kind: "idle" };
    gestureCooldownRef.current = performance.now() + 350;
    syncGestureLabel("Two Ls to create");
  }, [syncGestureLabel]);

  const applyGestureTracks = useCallback(
    (
      tracks: GestureTrack[],
      now: number,
      canvasWidth: number,
      canvasHeight: number,
    ) => {
      gestureTracksRef.current = tracks;
      const operation = gestureOperationRef.current;
      const pinchedTracks = tracks.filter((track) => track.pinched);

      if (operation.kind === "two-scale") {
        const first = tracks.find((track) => track.key === operation.handKeys[0]);
        const second = tracks.find((track) => track.key === operation.handKeys[1]);
        if (!first?.pinched || !second?.pinched) {
          finishGestureOperation();
        } else {
          const startCenter = midpoint(
            operation.startPoints[0],
            operation.startPoints[1],
          );
          const currentCenter = midpoint(first.cursor, second.cursor);
          const startDistance = Math.max(
            Math.hypot(
              (operation.startPoints[0].x - operation.startPoints[1].x) *
                canvasWidth,
              (operation.startPoints[0].y - operation.startPoints[1].y) *
                canvasHeight,
            ),
            48,
          );
          const currentDistance = Math.hypot(
            (first.cursor.x - second.cursor.x) * canvasWidth,
            (first.cursor.y - second.cursor.y) * canvasHeight,
          );
          const scale = clamp(currentDistance / startDistance, 0.35, 2.8);
          const width = operation.startRect.w * scale;
          const height = operation.startRect.h * scale;
          updateZone(operation.zoneId, (zone) => ({
            ...zone,
            rect: clampRect({
              x:
                rectCenter(operation.startRect).x +
                (currentCenter.x - startCenter.x) -
                width / 2,
              y:
                rectCenter(operation.startRect).y +
                (currentCenter.y - startCenter.y) -
                height / 2,
              w: width,
              h: height,
            }),
          }));
        }
        return;
      }

      if (operation.kind === "move" || operation.kind === "resize") {
        const primary = tracks.find((track) => track.key === operation.handKey);
        const second = pinchedTracks.find(
          (track) => track.key !== operation.handKey,
        );
        const targetZone = zonesRef.current.find(
          (zone) => zone.id === operation.zoneId,
        );
        const secondAtOppositeCorner =
          operation.kind === "resize" &&
          second &&
          Math.hypot(
            (second.cursor.x - operation.fixed.x) * canvasWidth,
            (second.cursor.y - operation.fixed.y) * canvasHeight,
          ) <= 48;

        if (primary?.pinched && second && targetZone && secondAtOppositeCorner) {
          gestureOperationRef.current = {
            kind: "two-scale",
            zoneId: operation.zoneId,
            handKeys: [primary.key, second.key],
            startPoints: [primary.cursor, second.cursor],
            startRect: targetZone.rect,
          };
          syncGestureLabel("Two pinches · resize");
          return;
        }

        if (!primary || primary.pinchUp || !primary.pinched) {
          const memory = pinchMemoryRef.current.get(operation.handKey);
          if (!memory || now - memory.lastSeen > 150 || primary?.pinchUp) {
            finishGestureOperation();
          }
          return;
        }

        if (operation.kind === "move") {
          const deltaX = primary.cursor.x - operation.startPointer.x;
          const deltaY = primary.cursor.y - operation.startPointer.y;
          updateZone(operation.zoneId, (zone) => ({
            ...zone,
            rect: clampRect({
              ...operation.startRect,
              x: operation.startRect.x + deltaX,
              y: operation.startRect.y + deltaY,
            }),
          }));
          syncGestureLabel("Pinch · move");
        } else {
          updateZone(operation.zoneId, (zone) => ({
            ...zone,
            rect: clampRect(rectBetween(operation.fixed, primary.cursor)),
          }));
          syncGestureLabel("Pinch · resize");
        }
        return;
      }

      for (const track of tracks.filter((candidate) => candidate.pinchDown)) {
        const target = findGestureTarget(track.cursor, canvasWidth, canvasHeight);
        if (!target) {
          syncSelected(null);
          continue;
        }
        syncZones([
          ...zonesRef.current.filter((zone) => zone.id !== target.zone.id),
          target.zone,
        ]);
        syncSelected(target.zone.id);
        if (target.corner) {
          gestureOperationRef.current = {
            kind: "resize",
            zoneId: target.zone.id,
            handKey: track.key,
            corner: target.corner,
            fixed: oppositeCorner(target.zone.rect, target.corner),
          };
          syncGestureLabel("Pinch · resize");
        } else {
          gestureOperationRef.current = {
            kind: "move",
            zoneId: target.zone.id,
            handKey: track.key,
            startPointer: track.cursor,
            startRect: target.zone.rect,
          };
          syncGestureLabel("Pinch · move");
        }
        creationPreviewRef.current = null;
        lStableRef.current = null;
        return;
      }

      const hasPinchIntent = tracks.some((track) => track.pinchIntent);
      if (hasPinchIntent || now < gestureCooldownRef.current) {
        creationPreviewRef.current = null;
        lStableRef.current = null;
        return;
      }

      const lTracks = tracks.filter((track) => track.isL);
      if (lLatchedRef.current) {
        if (lTracks.length < 2) {
          lReleaseSinceRef.current ??= now;
          if (now - lReleaseSinceRef.current > 260) {
            lLatchedRef.current = false;
            lReleaseSinceRef.current = null;
          }
        } else {
          lReleaseSinceRef.current = null;
        }
        creationPreviewRef.current = null;
        return;
      }

      if (lTracks.length < 2) {
        creationPreviewRef.current = null;
        lStableRef.current = null;
        if (tracks.length > 0) syncGestureLabel("Make two Ls");
        else syncGestureLabel("Two Ls to create");
        return;
      }

      const rect = rectBetween(lTracks[0].lCorner, lTracks[1].lCorner);
      const pairKey = lTracks
        .slice(0, 2)
        .map((track) => track.key)
        .sort()
        .join("|");
      if (
        rect.w * canvasWidth < 96 ||
        rect.h * canvasHeight < 72 ||
        zonesRef.current.length >= MAX_ZONES
      ) {
        creationPreviewRef.current = { rect, progress: 0 };
        lStableRef.current = null;
        syncGestureLabel(
          zonesRef.current.length >= MAX_ZONES
            ? "Up to 4 areas"
            : "Move the Ls apart",
        );
        return;
      }

      const previous = lStableRef.current;
      const samePair = previous?.pairKey === pairKey;
      const movement =
        previous && samePair
          ? Math.hypot(
              (rectCenter(rect).x - rectCenter(previous.rect).x) * canvasWidth,
              (rectCenter(rect).y - rectCenter(previous.rect).y) * canvasHeight,
            ) +
            Math.abs(rect.w - previous.rect.w) * canvasWidth +
            Math.abs(rect.h - previous.rect.h) * canvasHeight
          : Number.POSITIVE_INFINITY;
      const delta = previous && samePair ? Math.max(now - previous.lastAt, 1) : 16;
      const speed = (movement / delta) * 1000;
      const stableSince =
        previous && samePair && speed < 180 ? previous.stableSince : now;
      lStableRef.current = { rect, pairKey, stableSince, lastAt: now };
      const progress = clamp((now - stableSince) / 560, 0, 1);
      creationPreviewRef.current = { rect, progress };
      syncGestureLabel(progress > 0.1 ? "Hold the Ls" : "Area preview");

      if (progress >= 1) {
        const zone = addZone(activeEffectRef.current, rect);
        if (zone) {
          lLatchedRef.current = true;
          creationPreviewRef.current = null;
          lStableRef.current = null;
          syncGestureLabel("Area created");
          gestureCooldownRef.current = now + 400;
        }
      }
    },
    [
      activeEffectRef,
      addZone,
      findGestureTarget,
      finishGestureOperation,
      syncGestureLabel,
      syncSelected,
      syncZones,
      updateZone,
      zonesRef,
    ],
  );

  return {
    applyGestureTracks,
    creationPreviewRef,
    gestureOperationRef,
    gestureTracksRef,
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    pinchMemoryRef,
    resetGestureState,
  };
}
