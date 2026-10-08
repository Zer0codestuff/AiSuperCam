import type {
  FaceLandmarker,
  FaceLandmarkerResult,
  HandLandmarker,
  HandLandmarkerResult,
  NormalizedLandmark,
  PoseLandmarker,
  PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { ComponentType } from "react";

export type EffectId = "mesh" | "ascii" | "thermal" | "pixel" | "aura";

export type AppStatus =
  | "idle"
  | "starting-camera"
  | "starting-ai"
  | "ready"
  | "denied"
  | "error";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Corner = "nw" | "ne" | "se" | "sw";

export type Zone = {
  id: string;
  effect: EffectId;
  rect: Rect;
};

export type CanvasBuffer = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
};

export type ZoneSampleBuffer = CanvasBuffer & {
  asciiLayer?: CanvasBuffer;
  auraMask?: CanvasBuffer;
  auraGlow?: CanvasBuffer;
  auraSubject?: CanvasBuffer;
};

export type EffectDefinition = {
  id: EffectId;
  label: string;
  shortLabel: string;
  description: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  settingLabel: string;
  min: number;
  max: number;
  step: number;
};

export type StudioSettings = Record<EffectId, number>;

export type VisionModels = {
  hand: HandLandmarker;
  face: FaceLandmarker;
  pose: PoseLandmarker;
};

export type VisionRuntime = typeof import("@mediapipe/tasks-vision");

export type VisionResults = {
  hand: HandLandmarkerResult | null;
  face: FaceLandmarkerResult | null;
  pose: PoseLandmarkerResult | null;
};

export type Connection = { start: number; end: number };

export type InputOwner =
  | { kind: "none" }
  | { kind: "pointer"; pointerId: number }
  | { kind: "hands" };

export type PointerOperation =
  | { kind: "create"; start: Point; current: Point }
  | {
      kind: "move";
      zoneId: string;
      startPointer: Point;
      startRect: Rect;
    }
  | {
      kind: "resize";
      zoneId: string;
      corner: Corner;
      fixed: Point;
    };

export type GestureTrack = {
  key: string;
  landmarks: NormalizedLandmark[];
  cursor: Point;
  lCorner: Point;
  isL: boolean;
  pinched: boolean;
  pinchIntent: boolean;
  pinchDown: boolean;
  pinchUp: boolean;
  seenAt: number;
};

export type PinchMemory = {
  down: boolean;
  downSince: number | null;
  upSince: number | null;
  smoothCursor: Point;
  smoothLCorner: Point;
  lActive: boolean;
  lCandidateSince: number | null;
  lReleaseSince: number | null;
  lastSeen: number;
};

export type GestureOperation =
  | { kind: "idle" }
  | {
      kind: "move";
      zoneId: string;
      handKey: string;
      startPointer: Point;
      startRect: Rect;
    }
  | {
      kind: "resize";
      zoneId: string;
      handKey: string;
      corner: Corner;
      fixed: Point;
    }
  | {
      kind: "two-scale";
      zoneId: string;
      handKeys: [string, string];
      startPoints: [Point, Point];
      startRect: Rect;
    };
