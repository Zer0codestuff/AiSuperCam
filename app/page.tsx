"use client";

import {
  Binary,
  Camera,
  CameraOff,
  CircleHelp,
  CircleStop,
  Ellipsis,
  Grid2X2,
  Hand,
  ImageDown,
  LoaderCircle,
  Maximize2,
  MousePointer2,
  RotateCcw,
  ScanFace,
  Sparkles,
  Thermometer,
  Trash2,
  Video,
  X,
} from "lucide-react";
import type {
  FaceLandmarker,
  FaceLandmarkerResult,
  HandLandmarker,
  HandLandmarkerResult,
  NormalizedLandmark,
  PoseLandmarker,
  PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type EffectId = "mesh" | "ascii" | "thermal" | "pixel";
type AppStatus =
  | "idle"
  | "starting-camera"
  | "starting-ai"
  | "ready"
  | "denied"
  | "error"
  | "demo";

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Corner = "nw" | "ne" | "se" | "sw";

type Zone = {
  id: string;
  effect: EffectId;
  rect: Rect;
};

type EffectDefinition = {
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

type VisionModels = {
  hand: HandLandmarker;
  face: FaceLandmarker;
  pose: PoseLandmarker;
};

type VisionRuntime = typeof import("@mediapipe/tasks-vision");

type Connection = { start: number; end: number };

type PointerOperation =
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

type GestureTrack = {
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

type PinchMemory = {
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

type GestureOperation =
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

const EFFECTS: EffectDefinition[] = [
  {
    id: "mesh",
    label: "Mesh",
    shortLabel: "Mesh",
    description: "Face, pose and hands",
    icon: ScanFace,
    settingLabel: "Detail",
    min: 30,
    max: 100,
    step: 1,
  },
  {
    id: "ascii",
    label: "ASCII",
    shortLabel: "Aa",
    description: "Characters from light",
    icon: Binary,
    settingLabel: "Character size",
    min: 7,
    max: 24,
    step: 1,
  },
  {
    id: "thermal",
    label: "Thermal",
    shortLabel: "Heat",
    description: "False color and contours",
    icon: Thermometer,
    settingLabel: "Contrast",
    min: 20,
    max: 100,
    step: 1,
  },
  {
    id: "pixel",
    label: "Pixel",
    shortLabel: "Pixel",
    description: "Adjustable mosaic",
    icon: Grid2X2,
    settingLabel: "Pixel size",
    min: 5,
    max: 38,
    step: 1,
  },
];

const DEFAULT_SETTINGS: Record<EffectId, number> = {
  mesh: 72,
  ascii: 13,
  thermal: 68,
  pixel: 16,
};

const MAX_ZONES = 4;
const MIN_ZONE_W = 0.08;
const MIN_ZONE_H = 0.08;
const ASCII_RAMP = " .·:+*#%@";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function landmarkPoint(landmark: NormalizedLandmark): Point {
  return { x: 1 - landmark.x, y: landmark.y };
}

function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function clampRect(rect: Rect): Rect {
  const w = clamp(rect.w, MIN_ZONE_W, 1);
  const h = clamp(rect.h, MIN_ZONE_H, 1);
  return {
    x: clamp(rect.x, 0, 1 - w),
    y: clamp(rect.y, 0, 1 - h),
    w,
    h,
  };
}

function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function pointInRect(point: Point, rect: Rect, padding = 0) {
  return (
    point.x >= rect.x - padding &&
    point.x <= rect.x + rect.w + padding &&
    point.y >= rect.y - padding &&
    point.y <= rect.y + rect.h + padding
  );
}

function cornersForRect(rect: Rect): Record<Corner, Point> {
  return {
    nw: { x: rect.x, y: rect.y },
    ne: { x: rect.x + rect.w, y: rect.y },
    se: { x: rect.x + rect.w, y: rect.y + rect.h },
    sw: { x: rect.x, y: rect.y + rect.h },
  };
}

function oppositeCorner(rect: Rect, corner: Corner): Point {
  const corners = cornersForRect(rect);
  const opposite: Record<Corner, Corner> = {
    nw: "se",
    ne: "sw",
    se: "nw",
    sw: "ne",
  };
  return corners[opposite[corner]];
}

function effectById(id: EffectId) {
  return EFFECTS.find((effect) => effect.id === id) ?? EFFECTS[0];
}

function handDistance(
  landmarks: NormalizedLandmark[],
  first: number,
  second: number,
) {
  return Math.hypot(
    landmarks[first].x - landmarks[second].x,
    landmarks[first].y - landmarks[second].y,
    landmarks[first].z - landmarks[second].z,
  );
}

function fingerExtended(
  landmarks: NormalizedLandmark[],
  tip: number,
  pip: number,
) {
  return handDistance(landmarks, tip, 0) > handDistance(landmarks, pip, 0) * 1.1;
}

function isLShape(landmarks: NormalizedLandmark[]) {
  if (landmarks.length < 21) return false;

  const indexExtended = fingerExtended(landmarks, 8, 6);
  const middleFolded = !fingerExtended(landmarks, 12, 10);
  const ringFolded = !fingerExtended(landmarks, 16, 14);
  const pinkyFolded = !fingerExtended(landmarks, 20, 18);
  const thumbExtended =
    handDistance(landmarks, 4, 5) > handDistance(landmarks, 3, 5) * 1.18;

  const indexVector = {
    x: landmarks[8].x - landmarks[5].x,
    y: landmarks[8].y - landmarks[5].y,
  };
  const thumbVector = {
    x: landmarks[4].x - landmarks[2].x,
    y: landmarks[4].y - landmarks[2].y,
  };
  const dot = indexVector.x * thumbVector.x + indexVector.y * thumbVector.y;
  const magnitude =
    Math.hypot(indexVector.x, indexVector.y) *
      Math.hypot(thumbVector.x, thumbVector.y) || 1;
  const cosine = Math.abs(dot / magnitude);

  return (
    indexExtended &&
    thumbExtended &&
    middleFolded &&
    ringFolded &&
    pinkyFolded &&
    cosine < 0.67
  );
}

function thermalColor(value: number): [number, number, number] {
  const stops: Array<[number, number, number]> = [
    [8, 5, 25],
    [45, 12, 95],
    [124, 18, 145],
    [225, 36, 116],
    [255, 112, 58],
    [255, 220, 92],
    [215, 255, 224],
  ];
  const position = clamp(value, 0, 1) * (stops.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(stops.length - 1, lower + 1);
  const amount = position - lower;
  return [
    Math.round(stops[lower][0] + (stops[upper][0] - stops[lower][0]) * amount),
    Math.round(stops[lower][1] + (stops[upper][1] - stops[lower][1]) * amount),
    Math.round(stops[lower][2] + (stops[upper][2] - stops[lower][2]) * amount),
  ];
}

function roundedRectPath(
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

function drawConnections(
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

function drawDemoCamera(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
) {
  const drift = Math.sin(time / 1800) * width * 0.018;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#15212a");
  gradient.addColorStop(0.45, "#11171d");
  gradient.addColorStop(1, "#090b0e");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "rgba(255, 255, 255, 0.025)";
  for (let x = 0; x < width; x += 48) context.fillRect(x, 0, 1, height);
  for (let y = 0; y < height; y += 48) context.fillRect(0, y, width, 1);

  context.save();
  context.translate(drift, 0);
  const centerX = width * 0.52;
  const headY = height * 0.26;
  const headRadius = height * 0.095;
  const bodyGradient = context.createLinearGradient(
    centerX,
    headY,
    centerX,
    height * 0.95,
  );
  bodyGradient.addColorStop(0, "#c9d0d2");
  bodyGradient.addColorStop(1, "#5b6269");
  context.fillStyle = bodyGradient;
  context.beginPath();
  context.ellipse(centerX, headY, headRadius * 0.78, headRadius, 0, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.roundRect(
    centerX - width * 0.105,
    height * 0.36,
    width * 0.21,
    height * 0.43,
    height * 0.09,
  );
  context.fill();

  context.strokeStyle = "#9ca5aa";
  context.lineWidth = height * 0.065;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(centerX - width * 0.08, height * 0.43);
  context.lineTo(width * 0.28, height * 0.62);
  context.lineTo(width * 0.2, height * 0.48);
  context.moveTo(centerX + width * 0.08, height * 0.43);
  context.lineTo(width * 0.75, height * 0.58);
  context.lineTo(width * 0.82, height * 0.4);
  context.stroke();

  context.fillStyle = "#171c21";
  context.beginPath();
  context.arc(centerX - headRadius * 0.28, headY - 5, 4, 0, Math.PI * 2);
  context.arc(centerX + headRadius * 0.28, headY - 5, 4, 0, Math.PI * 2);
  context.fill();
  context.restore();

  const vignette = context.createRadialGradient(
    width / 2,
    height / 2,
    height * 0.2,
    width / 2,
    height / 2,
    width * 0.72,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,.62)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);
}

function drawDemoMesh(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
) {
  const drift = Math.sin(time / 1800) * width * 0.018;
  const cx = width * 0.52 + drift;
  const faceY = height * 0.26;
  const faceRx = height * 0.074;
  const faceRy = height * 0.095;

  context.strokeStyle = "rgba(99,243,211,.82)";
  context.fillStyle = "rgba(218,255,248,.94)";
  context.lineWidth = Math.max(1, width / 780);
  for (let row = -4; row <= 4; row += 1) {
    const normalizedY = row / 4;
    const rowWidth = faceRx * Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY));
    context.beginPath();
    context.ellipse(cx, faceY + normalizedY * faceRy, rowWidth, faceRy * 0.11, 0, 0, Math.PI * 2);
    context.stroke();
  }
  for (let column = -4; column <= 4; column += 1) {
    context.beginPath();
    context.moveTo(cx + (column / 4) * faceRx * 0.35, faceY - faceRy);
    context.quadraticCurveTo(
      cx + (column / 4) * faceRx * 1.4,
      faceY,
      cx + (column / 4) * faceRx * 0.35,
      faceY + faceRy,
    );
    context.stroke();
  }

  const joints: Point[] = [
    { x: cx / width, y: 0.39 },
    { x: 0.44 + drift / width, y: 0.43 },
    { x: 0.29, y: 0.61 },
    { x: 0.2, y: 0.48 },
    { x: 0.6 + drift / width, y: 0.43 },
    { x: 0.75, y: 0.58 },
    { x: 0.82, y: 0.4 },
    { x: 0.47 + drift / width, y: 0.78 },
    { x: 0.42 + drift / width, y: 0.95 },
    { x: 0.57 + drift / width, y: 0.78 },
    { x: 0.62 + drift / width, y: 0.95 },
  ];
  const links = [
    [0, 1],
    [1, 2],
    [2, 3],
    [0, 4],
    [4, 5],
    [5, 6],
    [1, 7],
    [4, 9],
    [7, 8],
    [9, 10],
  ];
  context.lineWidth = Math.max(2, width / 460);
  context.beginPath();
  for (const [start, end] of links) {
    context.moveTo(joints[start].x * width, joints[start].y * height);
    context.lineTo(joints[end].x * width, joints[end].y * height);
  }
  context.stroke();
  for (const joint of joints) {
    context.beginPath();
    context.arc(joint.x * width, joint.y * height, Math.max(2.5, width / 360), 0, Math.PI * 2);
    context.fill();
  }
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelsRef = useRef<VisionModels | null>(null);
  const visionRuntimeRef = useRef<VisionRuntime | null>(null);
  const handResultRef = useRef<HandLandmarkerResult | null>(null);
  const faceResultRef = useRef<FaceLandmarkerResult | null>(null);
  const poseResultRef = useRef<PoseLandmarkerResult | null>(null);
  const zonesRef = useRef<Zone[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const settingsRef = useRef({ ...DEFAULT_SETTINGS });
  const activeEffectRef = useRef<EffectId>("mesh");
  const renderRevisionRef = useRef(0);
  const zoneStateFrameRef = useRef<number | null>(null);
  const sessionGenerationRef = useRef(0);
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
  const zoneSequenceRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const gestureLabelRef = useRef("Two Ls to create");
  const helpModalRef = useRef<HTMLElement>(null);

  const [status, setStatus] = useState<AppStatus>("idle");
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeEffect, setActiveEffect] = useState<EffectId>("mesh");
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS }));
  const [trackingReady, setTrackingReady] = useState(false);
  const [trackingMessage, setTrackingMessage] = useState("Waiting");
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [canvasAspect, setCanvasAspect] = useState("16 / 9");

  const syncZones = useCallback((nextZones: Zone[]) => {
    zonesRef.current = nextZones;
    renderRevisionRef.current += 1;
    if (zoneStateFrameRef.current === null) {
      zoneStateFrameRef.current = requestAnimationFrame(() => {
        zoneStateFrameRef.current = null;
        setZones(zonesRef.current);
      });
    }
  }, []);

  const syncSelected = useCallback((nextId: string | null) => {
    selectedIdRef.current = nextId;
    setSelectedId(nextId);
  }, []);

  const syncGestureLabel = useCallback((message: string) => {
    if (gestureLabelRef.current === message) return;
    gestureLabelRef.current = message;
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const makeZone = useCallback((effect: EffectId, rect: Rect): Zone => {
    zoneSequenceRef.current += 1;
    return {
      id: `zone-${zoneSequenceRef.current}`,
      effect,
      rect: clampRect(rect),
    };
  }, []);

  const addZone = useCallback(
    (effect: EffectId, rect: Rect) => {
      if (zonesRef.current.length >= MAX_ZONES) {
        showToast("Up to 4 areas");
        return null;
      }
      const zone = makeZone(effect, rect);
      syncZones([...zonesRef.current, zone]);
      syncSelected(zone.id);
      return zone;
    },
    [makeZone, showToast, syncSelected, syncZones],
  );

  const updateZone = useCallback(
    (zoneId: string, updater: (zone: Zone) => Zone) => {
      const nextZones = zonesRef.current.map((zone) =>
        zone.id === zoneId ? updater(zone) : zone,
      );
      syncZones(nextZones);
    },
    [syncZones],
  );

  const deleteSelected = useCallback(() => {
    const target = selectedIdRef.current;
    if (!target) return;
    syncZones(zonesRef.current.filter((zone) => zone.id !== target));
    syncSelected(null);
    showToast("Area deleted");
  }, [showToast, syncSelected, syncZones]);

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

  const clearZones = useCallback(() => {
    syncZones([]);
    syncSelected(null);
    resetGestureState();
    showToast("Areas cleared");
  }, [resetGestureState, showToast, syncSelected, syncZones]);

  const createCenteredZone = useCallback(() => {
    addZone(activeEffectRef.current, { x: 0.28, y: 0.22, w: 0.44, h: 0.54 });
  }, [addZone]);

  const chooseEffect = useCallback(
    (effect: EffectId) => {
      activeEffectRef.current = effect;
      setActiveEffect(effect);
      const target = selectedIdRef.current;
      if (target) {
        updateZone(target, (zone) => ({ ...zone, effect }));
        showToast(`Area set to ${effectById(effect).label}`);
      }
    },
    [showToast, updateZone],
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const closeModels = useCallback(() => {
    modelsRef.current?.hand.close();
    modelsRef.current?.face.close();
    modelsRef.current?.pose.close();
    modelsRef.current = null;
    handResultRef.current = null;
    faceResultRef.current = null;
    poseResultRef.current = null;
    visionRuntimeRef.current = null;
  }, []);

  const createVisionModels = useCallback(async (delegate: "GPU" | "CPU") => {
    const vision = await import("@mediapipe/tasks-vision");
    visionRuntimeRef.current = vision;
    const files = await vision.FilesetResolver.forVisionTasks("/wasm");
    const createCanvas = () =>
      delegate === "GPU" ? document.createElement("canvas") : undefined;

    const [handResult, faceResult, poseResult] = await Promise.allSettled([
      vision.HandLandmarker.createFromOptions(files, {
          baseOptions: {
            modelAssetPath: "/models/hand_landmarker.task",
            delegate,
          },
          canvas: createCanvas(),
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.58,
          minHandPresenceConfidence: 0.58,
          minTrackingConfidence: 0.54,
        }),
      vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: {
            modelAssetPath: "/models/face_landmarker.task",
            delegate,
          },
          canvas: createCanvas(),
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }),
      vision.PoseLandmarker.createFromOptions(files, {
          baseOptions: {
            modelAssetPath: "/models/pose_landmarker_lite.task",
            delegate,
          },
          canvas: createCanvas(),
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.48,
          minPosePresenceConfidence: 0.48,
          minTrackingConfidence: 0.5,
          outputSegmentationMasks: false,
        }),
    ]);

    if (
      handResult.status === "rejected" ||
      faceResult.status === "rejected" ||
      poseResult.status === "rejected"
    ) {
      if (handResult.status === "fulfilled") handResult.value.close();
      if (faceResult.status === "fulfilled") faceResult.value.close();
      if (poseResult.status === "fulfilled") poseResult.value.close();
      const failed = [handResult, faceResult, poseResult].find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      throw failed?.reason ?? new Error("Vision models incomplete");
    }

    return {
      hand: handResult.value,
      face: faceResult.value,
      pose: poseResult.value,
    };
  }, []);

  const initialiseVision = useCallback(async (session: number) => {
    closeModels();
    let models: VisionModels;
    let message = "Hand tracking on";
    try {
      models = await createVisionModels("GPU");
    } catch {
      if (session !== sessionGenerationRef.current) return false;
      models = await createVisionModels("CPU");
      message = "Hand tracking on · CPU";
    }
    if (session !== sessionGenerationRef.current) {
      models.hand.close();
      models.face.close();
      models.pose.close();
      return false;
    }
    modelsRef.current = models;
    setTrackingMessage(message);
    setTrackingReady(true);
    return true;
  }, [closeModels, createVisionModels]);

  const activateCamera = useCallback(async () => {
    const session = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = session;
    setStatus("starting-camera");
    setTrackingMessage("Starting camera");
    setTrackingReady(false);
    resetGestureState();
    stopCamera();
    closeModels();

    try {
      const compact = window.matchMedia("(max-width: 700px)").matches;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: compact ? 640 : 1280 },
          height: { ideal: compact ? 480 : 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      if (session !== sessionGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Video element unavailable");
      video.srcObject = stream;
      await video.play();
      if (session !== sessionGenerationRef.current) return;

      const sourceWidth = video.videoWidth || (compact ? 640 : 1280);
      const sourceHeight = video.videoHeight || (compact ? 480 : 720);
      const maximumWidth = compact ? 640 : 960;
      const width = Math.min(sourceWidth, maximumWidth);
      const height = Math.round((width * sourceHeight) / sourceWidth);
      if (canvasRef.current) {
        canvasRef.current.width = width;
        canvasRef.current.height = height;
      }
      setCanvasAspect(`${sourceWidth} / ${sourceHeight}`);
      setStatus("starting-ai");
      setTrackingMessage("Loading hand tracking");

      try {
        await initialiseVision(session);
      } catch (error) {
        if (session !== sessionGenerationRef.current) return;
        console.error("Vision initialisation failed", error);
        setTrackingReady(false);
        setTrackingMessage("Mouse control");
        showToast("Hand tracking unavailable — use mouse or touch");
      }
      if (session !== sessionGenerationRef.current) return;
      syncZones([]);
      syncSelected(null);
      setStatus("ready");
      if (modelsRef.current) {
        showToast("Hold two Ls to create · pinch to edit");
      }
    } catch (error) {
      if (session !== sessionGenerationRef.current) return;
      console.error("Camera access failed", error);
      const name = error instanceof DOMException ? error.name : "";
      setStatus(
        name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error",
      );
      setTrackingMessage("Camera unavailable");
    }
  }, [closeModels, initialiseVision, resetGestureState, showToast, stopCamera, syncSelected, syncZones]);

  const startDemo = useCallback(() => {
    sessionGenerationRef.current += 1;
    stopCamera();
    closeModels();
    resetGestureState();
    setTrackingReady(false);
    setTrackingMessage("Demo mode");
    setCanvasAspect("16 / 9");
    if (canvasRef.current) {
      canvasRef.current.width = 1280;
      canvasRef.current.height = 720;
    }
    const mesh = makeZone("mesh", { x: 0.17, y: 0.12, w: 0.42, h: 0.72 });
    const thermal = makeZone("thermal", {
      x: 0.62,
      y: 0.23,
      w: 0.25,
      h: 0.39,
    });
    syncZones([mesh, thermal]);
    syncSelected(mesh.id);
    setStatus("demo");
    showToast("Drag on the video to create another area");
  }, [closeModels, makeZone, resetGestureState, showToast, stopCamera, syncSelected, syncZones]);

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

  const findTopZone = useCallback((point: Point) => {
    return [...zonesRef.current].reverse().find((zone) => pointInRect(point, zone.rect));
  }, []);

  const onCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (status === "idle" || status.startsWith("starting") || status === "denied") {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      gestureOperationRef.current = { kind: "idle" };
      lStableRef.current = null;
      const point = pointFromPointer(event);
      const selected = zonesRef.current.find(
        (zone) => zone.id === selectedIdRef.current,
      );
      const ordered = selected
        ? [selected, ...zonesRef.current.filter((zone) => zone.id !== selected.id).reverse()]
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
      pointerOperationRef.current = { kind: "create", start: point, current: point };
    },
    [findTopZone, hitCorner, pointFromPointer, status, syncSelected, syncZones],
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
  }, [addZone]);

  const findGestureTarget = useCallback(
    (point: Point, canvasWidth: number, canvasHeight: number) => {
      const handleRadius = 28;
      const selected = zonesRef.current.find(
        (zone) => zone.id === selectedIdRef.current,
      );
      const ordered = selected
        ? [selected, ...zonesRef.current.filter((zone) => zone.id !== selected.id).reverse()]
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
    [],
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
          const startCenter = midpoint(operation.startPoints[0], operation.startPoints[1]);
          const currentCenter = midpoint(first.cursor, second.cursor);
          const startDistance = Math.max(
            Math.hypot(
              (operation.startPoints[0].x - operation.startPoints[1].x) * canvasWidth,
              (operation.startPoints[0].y - operation.startPoints[1].y) * canvasHeight,
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
        const second = pinchedTracks.find((track) => track.key !== operation.handKey);
        const targetZone = zonesRef.current.find((zone) => zone.id === operation.zoneId);
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
      const movement = previous && samePair
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
      addZone,
      findGestureTarget,
      finishGestureOperation,
      syncGestureLabel,
      syncSelected,
      syncZones,
      updateZone,
    ],
  );

  useEffect(() => {
    settingsRef.current = settings;
    renderRevisionRef.current += 1;
  }, [settings]);

  useEffect(() => {
    activeEffectRef.current = activeEffect;
  }, [activeEffect]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: false });
    if (!context) return;

    const source = document.createElement("canvas");
    const sample = document.createElement("canvas");
    const output = outputCanvasRef.current ?? document.createElement("canvas");
    outputCanvasRef.current = output;
    const sourceContext = source.getContext("2d", { willReadFrequently: true });
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    const outputContext = output.getContext("2d", { alpha: false });
    if (!sourceContext || !sampleContext || !outputContext) return;

    const resizeBuffer = (
      target: HTMLCanvasElement,
      width: number,
      height: number,
    ) => {
      if (target.width !== width) target.width = width;
      if (target.height !== height) target.height = height;
    };

    let animationFrame = 0;
    let lastTrackedVideoTime = -1;
    let lastCompositedVideoTime = -1;
    let lastCompositeRevision = -1;
    let lastSyntheticFrameAt = 0;
    let lastDetectionAt = 0;
    let detectionFrame = 0;
    let trackingFailed = false;

    const drawZoneEffect = (zone: Zone, now: number) => {
      const width = canvas.width;
      const height = canvas.height;
      const x = Math.round(zone.rect.x * width);
      const y = Math.round(zone.rect.y * height);
      const zoneWidth = Math.max(1, Math.round(zone.rect.w * width));
      const zoneHeight = Math.max(1, Math.round(zone.rect.h * height));

      context.save();
      roundedRectPath(context, x, y, zoneWidth, zoneHeight, Math.max(10, width / 90));
      context.clip();

      if (zone.effect === "pixel") {
        const size = settingsRef.current.pixel;
        const columns = Math.max(2, Math.round(zoneWidth / size));
        const rows = Math.max(2, Math.round(zoneHeight / size));
        resizeBuffer(sample, columns, rows);
        sampleContext.imageSmoothingEnabled = true;
        sampleContext.drawImage(
          source,
          x,
          y,
          zoneWidth,
          zoneHeight,
          0,
          0,
          columns,
          rows,
        );
        context.imageSmoothingEnabled = false;
        context.drawImage(sample, 0, 0, columns, rows, x, y, zoneWidth, zoneHeight);
        context.imageSmoothingEnabled = true;
      }

      if (zone.effect === "thermal") {
        const targetWidth = Math.max(48, Math.min(280, Math.round(zoneWidth / 2.4)));
        const targetHeight = Math.max(
          32,
          Math.round((targetWidth * zoneHeight) / zoneWidth),
        );
        resizeBuffer(sample, targetWidth, targetHeight);
        sampleContext.drawImage(
          source,
          x,
          y,
          zoneWidth,
          zoneHeight,
          0,
          0,
          targetWidth,
          targetHeight,
        );
        const image = sampleContext.getImageData(0, 0, targetWidth, targetHeight);
        const contrast = settingsRef.current.thermal / 50;
        for (let index = 0; index < image.data.length; index += 4) {
          const luminance =
            (image.data[index] * 0.2126 +
              image.data[index + 1] * 0.7152 +
              image.data[index + 2] * 0.0722) /
            255;
          const adjusted = clamp((luminance - 0.5) * contrast + 0.5, 0, 1);
          const [red, green, blue] = thermalColor(adjusted);
          image.data[index] = red;
          image.data[index + 1] = green;
          image.data[index + 2] = blue;
        }
        sampleContext.putImageData(image, 0, 0);
        context.imageSmoothingEnabled = true;
        context.drawImage(sample, 0, 0, targetWidth, targetHeight, x, y, zoneWidth, zoneHeight);
        context.globalCompositeOperation = "screen";
        context.globalAlpha = 0.24;
        context.drawImage(source, x, y, zoneWidth, zoneHeight, x, y, zoneWidth, zoneHeight);
        context.globalAlpha = 1;
        context.globalCompositeOperation = "source-over";
      }

      if (zone.effect === "ascii") {
        const cellSize = settingsRef.current.ascii;
        const columns = Math.max(4, Math.floor(zoneWidth / cellSize));
        const rows = Math.max(3, Math.floor(zoneHeight / (cellSize * 1.08)));
        resizeBuffer(sample, columns, rows);
        sampleContext.drawImage(
          source,
          x,
          y,
          zoneWidth,
          zoneHeight,
          0,
          0,
          columns,
          rows,
        );
        const image = sampleContext.getImageData(0, 0, columns, rows);
        context.fillStyle = "rgba(4,8,9,.91)";
        context.fillRect(x, y, zoneWidth, zoneHeight);
        const charWidth = zoneWidth / columns;
        const charHeight = zoneHeight / rows;
        context.font = `${Math.ceil(charHeight * 1.02)}px var(--font-geist-mono), monospace`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        for (let row = 0; row < rows; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            const index = (row * columns + column) * 4;
            const luminance =
              (image.data[index] * 0.2126 +
                image.data[index + 1] * 0.7152 +
                image.data[index + 2] * 0.0722) /
              255;
            const character =
              ASCII_RAMP[Math.min(ASCII_RAMP.length - 1, Math.floor(luminance * ASCII_RAMP.length))];
            context.fillStyle = `rgba(${Math.max(80, image.data[index])}, ${Math.max(
              150,
              image.data[index + 1],
            )}, ${Math.max(145, image.data[index + 2])}, ${0.42 + luminance * 0.58})`;
            context.fillText(
              character,
              x + (column + 0.5) * charWidth,
              y + (row + 0.52) * charHeight,
            );
          }
        }
      }

      if (zone.effect === "mesh") {
        context.fillStyle = "rgba(4,12,14,.17)";
        context.fillRect(x, y, zoneWidth, zoneHeight);
        const detail = settingsRef.current.mesh / 100;
        const vision = visionRuntimeRef.current;
        const face = faceResultRef.current?.faceLandmarks[0];
        const pose = poseResultRef.current?.landmarks[0];
        const hands = handResultRef.current?.landmarks ?? [];
        if (face && vision) {
          context.globalAlpha = 0.26 + detail * 0.28;
          drawConnections(
            context,
            face,
            vision.FaceLandmarker.FACE_LANDMARKS_TESSELATION,
            width,
            height,
            "#63f3d3",
            Math.max(0.5, width / 1450),
          );
          context.globalAlpha = 0.92;
          drawConnections(
            context,
            face,
            vision.FaceLandmarker.FACE_LANDMARKS_CONTOURS,
            width,
            height,
            "#d9fff6",
            Math.max(1, width / 760),
          );
        }
        if (pose && vision) {
          context.globalAlpha = 0.84;
          drawConnections(
            context,
            pose,
            vision.PoseLandmarker.POSE_CONNECTIONS,
            width,
            height,
            "#63f3d3",
            Math.max(1.5, width / 560),
            0.45,
          );
          context.fillStyle = "#dcfff8";
          for (const point of pose) {
            if ((point.visibility ?? 1) < 0.55) continue;
            context.beginPath();
            context.arc(
              (1 - point.x) * width,
              point.y * height,
              Math.max(2, width / 380),
              0,
              Math.PI * 2,
            );
            context.fill();
          }
        }
        if (vision) {
          for (const hand of hands) {
            context.globalAlpha = 0.95;
            drawConnections(
              context,
              hand,
              vision.HandLandmarker.HAND_CONNECTIONS,
              width,
              height,
              "#f3fffc",
              Math.max(1.4, width / 640),
            );
          }
        }
        if (status === "demo") drawDemoMesh(context, width, height, now);
        context.globalAlpha = 1;
      }

      context.restore();
    };

    const drawZoneChrome = (zone: Zone) => {
      const width = canvas.width;
      const height = canvas.height;
      const x = zone.rect.x * width;
      const y = zone.rect.y * height;
      const zoneWidth = zone.rect.w * width;
      const zoneHeight = zone.rect.h * height;
      const selected = zone.id === selectedIdRef.current;
      const accent = selected ? "rgba(255,255,255,.94)" : "rgba(255,255,255,.28)";

      context.save();
      roundedRectPath(context, x, y, zoneWidth, zoneHeight, Math.max(10, width / 90));
      context.strokeStyle = accent;
      context.lineWidth = selected ? Math.max(2, width / 650) : Math.max(1, width / 1000);
      context.setLineDash(selected ? [] : [8, 8]);
      context.stroke();
      context.setLineDash([]);

      if (selected) {
        context.fillStyle = "#ffffff";
        context.strokeStyle = "rgba(0,0,0,.72)";
        context.lineWidth = 2;
        for (const point of Object.values(cornersForRect(zone.rect))) {
          context.beginPath();
          context.arc(point.x * width, point.y * height, Math.max(5, width / 190), 0, Math.PI * 2);
          context.fill();
          context.stroke();
        }
      }
      context.restore();
    };

    const drawCreationPreview = () => {
      const preview = creationPreviewRef.current;
      if (!preview) return;
      const width = canvas.width;
      const height = canvas.height;
      const x = preview.rect.x * width;
      const y = preview.rect.y * height;
      const zoneWidth = preview.rect.w * width;
      const zoneHeight = preview.rect.h * height;
      const bracket = Math.min(38, zoneWidth * 0.2, zoneHeight * 0.2);
      context.save();
      context.fillStyle = "rgba(255,255,255,.045)";
      context.fillRect(x, y, zoneWidth, zoneHeight);
      context.strokeStyle = "rgba(255,255,255,.96)";
      context.lineWidth = Math.max(2.5, width / 520);
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(x, y + bracket);
      context.lineTo(x, y);
      context.lineTo(x + bracket, y);
      context.moveTo(x + zoneWidth - bracket, y);
      context.lineTo(x + zoneWidth, y);
      context.lineTo(x + zoneWidth, y + bracket);
      context.moveTo(x + zoneWidth, y + zoneHeight - bracket);
      context.lineTo(x + zoneWidth, y + zoneHeight);
      context.lineTo(x + zoneWidth - bracket, y + zoneHeight);
      context.moveTo(x + bracket, y + zoneHeight);
      context.lineTo(x, y + zoneHeight);
      context.lineTo(x, y + zoneHeight - bracket);
      context.stroke();

      const center = rectCenter(preview.rect);
      context.beginPath();
      context.arc(center.x * width, center.y * height, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * preview.progress);
      context.strokeStyle = "#ffffff";
      context.lineWidth = 4;
      context.stroke();
      context.restore();
    };

    const drawGestureCursors = () => {
      if (!trackingReady) return;
      const width = canvas.width;
      const height = canvas.height;
      context.save();
      for (const track of gestureTracksRef.current) {
        const x = track.cursor.x * width;
        const y = track.cursor.y * height;
        context.beginPath();
        context.arc(x, y, track.pinched ? 13 : 8, 0, Math.PI * 2);
        context.strokeStyle = track.pinched ? "#ffffff" : "rgba(255,255,255,.68)";
        context.lineWidth = track.pinched ? 3 : 2;
        context.stroke();
        if (track.isL) {
          const cornerX = track.lCorner.x * width;
          const cornerY = track.lCorner.y * height;
          context.fillStyle = "#ffffff";
          context.beginPath();
          context.arc(cornerX, cornerY, 5, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.restore();
    };

    const processHandResults = (result: HandLandmarkerResult, now: number) => {
      const tracks: GestureTrack[] = [];
      const seenKeys = new Set<string>();
      result.landmarks.forEach((landmarks, index) => {
        const handedness = result.handedness[index]?.[0]?.categoryName ?? `Hand-${index}`;
        const key = seenKeys.has(handedness) ? `${handedness}-2` : handedness;
        seenKeys.add(key);
        const rawCursor = midpoint(landmarkPoint(landmarks[4]), landmarkPoint(landmarks[8]));
        const indexBase = landmarkPoint(landmarks[5]);
        const thumbBase = landmarkPoint(landmarks[2]);
        const rawLCorner = {
          x: indexBase.x + (thumbBase.x - indexBase.x) * 0.35,
          y: indexBase.y + (thumbBase.y - indexBase.y) * 0.35,
        };
        const memory = pinchMemoryRef.current.get(key) ?? {
          down: false,
          downSince: null,
          upSince: null,
          smoothCursor: rawCursor,
          smoothLCorner: rawLCorner,
          lActive: false,
          lCandidateSince: null,
          lReleaseSince: null,
          lastSeen: now,
        };
        memory.smoothCursor = {
          x: memory.smoothCursor.x + (rawCursor.x - memory.smoothCursor.x) * 0.42,
          y: memory.smoothCursor.y + (rawCursor.y - memory.smoothCursor.y) * 0.42,
        };
        memory.smoothLCorner = {
          x: memory.smoothLCorner.x + (rawLCorner.x - memory.smoothLCorner.x) * 0.3,
          y: memory.smoothLCorner.y + (rawLCorner.y - memory.smoothLCorner.y) * 0.3,
        };
        memory.lastSeen = now;
        const palmSize =
          (handDistance(landmarks, 0, 9) + handDistance(landmarks, 5, 17)) * 0.5 ||
          0.1;
        const pinchRatio = handDistance(landmarks, 4, 8) / palmSize;
        let pinchDown = false;
        let pinchUp = false;

        if (!memory.down) {
          if (pinchRatio < 0.28) {
            memory.downSince ??= now;
            if (now - memory.downSince > 78) {
              memory.down = true;
              memory.upSince = null;
              pinchDown = true;
            }
          } else {
            memory.downSince = null;
          }
        } else if (pinchRatio > 0.42) {
          memory.upSince ??= now;
          if (now - memory.upSince > 92) {
            memory.down = false;
            memory.downSince = null;
            pinchUp = true;
          }
        } else {
          memory.upSince = null;
        }

        if (isLShape(landmarks)) {
          memory.lReleaseSince = null;
          if (!memory.lActive) {
            memory.lCandidateSince ??= now;
            if (now - memory.lCandidateSince >= 150) {
              memory.lActive = true;
              memory.lCandidateSince = null;
            }
          }
        } else {
          memory.lCandidateSince = null;
          if (memory.lActive) {
            memory.lReleaseSince ??= now;
            if (now - memory.lReleaseSince >= 120) {
              memory.lActive = false;
              memory.lReleaseSince = null;
            }
          }
        }

        pinchMemoryRef.current.set(key, memory);
        tracks.push({
          key,
          landmarks,
          cursor: memory.smoothCursor,
          lCorner: memory.smoothLCorner,
          isL: memory.lActive,
          pinched: memory.down,
          pinchIntent: pinchRatio < 0.55,
          pinchDown,
          pinchUp,
          seenAt: now,
        });
      });

      for (const [key, memory] of pinchMemoryRef.current) {
        if (!seenKeys.has(key) && now - memory.lastSeen > 500) {
          pinchMemoryRef.current.delete(key);
        }
      }

      const bounds = canvas.getBoundingClientRect();
      applyGestureTracks(
        tracks,
        now,
        bounds.width || canvas.width,
        bounds.height || canvas.height,
      );
    };

    const render = (now: number) => {
      const width = canvas.width;
      const height = canvas.height;
      const canDrawVideo =
        (status === "ready" || status === "starting-ai") &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;

      if (
        status === "ready" &&
        trackingReady &&
        !trackingFailed &&
        modelsRef.current &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.currentTime !== lastTrackedVideoTime &&
        now - lastDetectionAt >= 54
      ) {
        try {
          const timestamp = Math.max(now, lastDetectionAt + 1);
          const models = modelsRef.current;
          handResultRef.current = models.hand.detectForVideo(video, timestamp);
          processHandResults(handResultRef.current, now);
          const needsMesh = zonesRef.current.some((zone) => zone.effect === "mesh");
          if (needsMesh && detectionFrame % 3 === 0) {
            faceResultRef.current = models.face.detectForVideo(video, timestamp);
          } else if (needsMesh && detectionFrame % 4 === 1) {
            poseResultRef.current = models.pose.detectForVideo(video, timestamp);
          }
          detectionFrame += 1;
          lastDetectionAt = timestamp;
          lastTrackedVideoTime = video.currentTime;
        } catch (error) {
          if (!trackingFailed) {
            console.error("Tracking frame failed", error);
            trackingFailed = true;
            lastDetectionAt = now;
            lastTrackedVideoTime = video.currentTime;
            gestureTracksRef.current = [];
            gestureOperationRef.current = { kind: "idle" };
            setTrackingReady(false);
            setTrackingMessage("Mouse control");
          }
        }
      }

      const syntheticFrameDue = !canDrawVideo && now - lastSyntheticFrameAt >= 34;
      const needsComposite =
        output.width !== width ||
        output.height !== height ||
        lastCompositeRevision !== renderRevisionRef.current ||
        (canDrawVideo && video.currentTime !== lastCompositedVideoTime) ||
        syntheticFrameDue;

      context.clearRect(0, 0, width, height);
      if (needsComposite) {
        if (canDrawVideo) {
          context.save();
          context.translate(width, 0);
          context.scale(-1, 1);
          context.drawImage(video, 0, 0, width, height);
          context.restore();
        } else {
          drawDemoCamera(context, width, height, now);
          lastSyntheticFrameAt = now;
        }

        resizeBuffer(source, width, height);
        sourceContext.drawImage(canvas, 0, 0, width, height);
        zonesRef.current.forEach((zone) => drawZoneEffect(zone, now));
        resizeBuffer(output, width, height);
        outputContext.drawImage(canvas, 0, 0, width, height);
        lastCompositeRevision = renderRevisionRef.current;
        lastCompositedVideoTime = canDrawVideo ? video.currentTime : -1;
      } else {
        context.drawImage(output, 0, 0, width, height);
      }

      zonesRef.current.forEach((zone) => drawZoneChrome(zone));
      drawCreationPreview();
      drawGestureCursors();
      animationFrame = requestAnimationFrame(render);
    };

    animationFrame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrame);
  }, [applyGestureTracks, status, trackingReady]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (helpOpen) setHelpOpen(false);
        else syncSelected(null);
        return;
      }

      if (helpOpen || (status !== "ready" && status !== "demo")) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "button, input, textarea, select, a, [contenteditable='true'], [role='dialog']",
        )
      ) {
        return;
      }

      const effect = EFFECTS[Number(event.key) - 1];
      if (effect) {
        event.preventDefault();
        chooseEffect(effect.id);
        return;
      }
      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        createCenteredZone();
        return;
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        clearZones();
        return;
      }
      if (event.key === "Delete") {
        event.preventDefault();
        deleteSelected();
        return;
      }

      const selected = selectedIdRef.current;
      if (!selected) return;
      const amount = event.shiftKey ? 0.025 : 0.008;
      const movement: Record<string, Point> = {
        ArrowLeft: { x: -amount, y: 0 },
        ArrowRight: { x: amount, y: 0 },
        ArrowUp: { x: 0, y: -amount },
        ArrowDown: { x: 0, y: amount },
      };
      if (movement[event.key]) {
        event.preventDefault();
        const delta = movement[event.key];
        updateZone(selected, (zone) => ({
          ...zone,
          rect: clampRect({
            ...zone.rect,
            x: zone.rect.x + delta.x,
            y: zone.rect.y + delta.y,
          }),
        }));
      }
      if (event.key === "+" || event.key === "=" || event.key === "-") {
        event.preventDefault();
        const delta = event.key === "-" ? -0.025 : 0.025;
        updateZone(selected, (zone) => ({
          ...zone,
          rect: clampRect({
            x: zone.rect.x - delta / 2,
            y: zone.rect.y - delta / 2,
            w: zone.rect.w + delta,
            h: zone.rect.h + delta,
          }),
        }));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    chooseEffect,
    clearZones,
    createCenteredZone,
    deleteSelected,
    helpOpen,
    status,
    syncSelected,
    updateZone,
  ]);

  useEffect(() => {
    if (!helpOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const modal = helpModalRef.current;
    const focusable = modal?.querySelectorAll<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    const first = focusable?.[0] ?? modal;
    const last = focusable?.[focusable.length - 1] ?? modal;
    const focusFrame = requestAnimationFrame(() => first?.focus());

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", trapFocus);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", trapFocus);
      previousFocus?.focus();
    };
  }, [helpOpen]);

  useEffect(() => {
    return () => {
      sessionGenerationRef.current += 1;
      stopCamera();
      closeModels();
      if (zoneStateFrameRef.current !== null) {
        cancelAnimationFrame(zoneStateFrameRef.current);
      }
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [closeModels, stopCamera]);

  const captureSnapshot = useCallback(() => {
    const canvas = outputCanvasRef.current ?? canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `aisupercam-${Date.now()}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast("Image saved");
    }, "image/png");
  }, [showToast]);

  const toggleRecording = useCallback(() => {
    const canvas = outputCanvasRef.current ?? canvasRef.current;
    if (
      !canvas ||
      typeof MediaRecorder === "undefined" ||
      typeof canvas.captureStream !== "function"
    ) {
      showToast("Recording is not supported in this browser");
      return;
    }
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      setRecording(false);
      return;
    }
    const canvasStream = canvas.captureStream(30);
    const mimeType = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4",
    ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(
        canvasStream,
        mimeType ? { mimeType } : undefined,
      );
    } catch {
      canvasStream.getTracks().forEach((track) => track.stop());
      showToast("Recording is not supported in this browser");
      return;
    }
    recordingChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordingChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const outputType = recorder.mimeType || mimeType || "video/webm";
      const extension = outputType.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(recordingChunksRef.current, { type: outputType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `aisupercam-${Date.now()}.${extension}`;
      anchor.click();
      URL.revokeObjectURL(url);
      canvasStream.getTracks().forEach((track) => track.stop());
      showToast("Video saved");
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    showToast("Recording started");
  }, [showToast]);

  const selectedZone = zones.find((zone) => zone.id === selectedId) ?? null;
  const contextualEffect = selectedZone?.effect ?? activeEffect;
  const contextualDefinition = effectById(contextualEffect);
  const isStudioActive = status === "ready" || status === "demo";

  return (
    <main className="app-shell">
      <video
        ref={videoRef}
        className="source-video"
        muted
        playsInline
        aria-hidden="true"
      />

      <section className="camera-panel" aria-label="AiSuperCam studio">
        <div className="camera-stage" style={{ aspectRatio: canvasAspect }}>
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            className="camera-canvas"
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
            tabIndex={0}
            aria-label="Interactive webcam. Drag to create an area, drag inside an area to move it, or drag a corner to resize it."
          />

          {isStudioActive && (
            <div className="camera-toolbar">
              <span
                className={`status-light ${status === "ready" ? "is-live" : ""}`}
                role="status"
                aria-label={status === "ready" ? trackingMessage : "Demo mode"}
                title={status === "ready" ? trackingMessage : "Demo mode"}
              />

              <nav className="effect-list" aria-label="Choose an effect">
                {EFFECTS.map((effect, index) => {
                  const Icon = effect.icon;
                  const pressed = contextualEffect === effect.id;
                  return (
                    <button
                      key={effect.id}
                      className={`effect-button effect-${effect.id} ${pressed ? "is-active" : ""}`}
                      type="button"
                      onClick={() => chooseEffect(effect.id)}
                      aria-pressed={pressed}
                      aria-label={effect.label}
                      title={`${effect.label} · key ${index + 1}`}
                    >
                      <Icon size={19} strokeWidth={1.8} />
                      <span className="visually-hidden">{effect.label}</span>
                    </button>
                  );
                })}
              </nav>

              <span className="toolbar-divider" aria-hidden="true" />

              <label className="strength-control">
                <span className="visually-hidden">
                  {contextualDefinition.label}: {contextualDefinition.settingLabel}
                </span>
                <input
                  type="range"
                  min={contextualDefinition.min}
                  max={contextualDefinition.max}
                  step={contextualDefinition.step}
                  value={settings[contextualEffect]}
                  aria-label={`${contextualDefinition.label}: ${contextualDefinition.settingLabel}`}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setSettings((current) => ({
                      ...current,
                      [contextualEffect]: value,
                    }));
                  }}
                />
              </label>

              <span
                className="zone-count"
                aria-label={`${zones.length} of ${MAX_ZONES} areas`}
                title="Areas"
              >
                {zones.length}/{MAX_ZONES}
              </span>

              {selectedZone && (
                <button
                  className="toolbar-button is-danger"
                  type="button"
                  onClick={deleteSelected}
                  aria-label="Delete selected area"
                  title="Delete selected area"
                >
                  <Trash2 size={17} />
                </button>
              )}

              <button
                className={`toolbar-button record-button ${recording ? "is-recording" : ""}`}
                type="button"
                onClick={toggleRecording}
                aria-label={recording ? "Stop recording" : "Record video"}
                title={recording ? "Stop recording" : "Record video"}
              >
                {recording ? <CircleStop size={18} /> : <Video size={18} />}
              </button>

              <details className="toolbar-more">
                <summary aria-label="More actions" title="More actions">
                  <Ellipsis size={20} />
                </summary>
                <div className="toolbar-menu">
                  <button type="button" onClick={captureSnapshot}>
                    <ImageDown size={17} />
                    Save image
                  </button>
                  <button
                    type="button"
                    onClick={clearZones}
                    disabled={zones.length === 0}
                  >
                    <RotateCcw size={17} />
                    Clear areas
                  </button>
                  <button type="button" onClick={() => setHelpOpen(true)}>
                    <CircleHelp size={17} />
                    Gesture guide
                  </button>
                </div>
              </details>
            </div>
          )}

          {status === "idle" && (
            <div className="start-overlay">
              <div className="start-card">
                <div className="start-brand">
                  <Sparkles size={17} />
                  <span>AiSuperCam</span>
                </div>
                <h1>Draw an area with two L-shaped hands.</h1>
                <div className="start-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={activateCamera}
                  >
                    <Camera size={17} />
                    Enable camera
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={startDemo}
                  >
                    Try demo
                  </button>
                </div>
                <small>Processed on this device.</small>
              </div>
            </div>
          )}

          {(status === "starting-camera" || status === "starting-ai") && (
            <div className="loading-overlay" aria-live="polite">
              <LoaderCircle className="spinner" size={21} />
              <div>
                <strong>
                  {status === "starting-camera"
                    ? "Starting camera"
                    : "Loading hand tracking"}
                </strong>
                <span>
                  {status === "starting-ai"
                    ? "Face, pose and hands stay on this device"
                    : "Waiting for browser permission"}
                </span>
              </div>
            </div>
          )}

          {(status === "denied" || status === "error") && (
            <div className="start-overlay">
              <div className="start-card error-card">
                <CameraOff size={23} />
                <h1>
                  {status === "denied"
                    ? "Camera access is blocked."
                    : "No camera was found."}
                </h1>
                <p>
                  {status === "denied"
                    ? "Allow camera access in your browser settings, or continue in demo mode."
                    : "Connect a camera, or continue in demo mode."}
                </p>
                <div className="start-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={activateCamera}
                  >
                    Try again
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={startDemo}
                  >
                    Try demo
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {helpOpen && (
        <div className="modal-backdrop">
          <button
            className="modal-scrim"
            type="button"
            tabIndex={-1}
            aria-label="Close guide"
            onClick={() => setHelpOpen(false)}
          />
          <section
            ref={helpModalRef}
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            tabIndex={-1}
          >
            <button
              className="modal-close"
              type="button"
              onClick={() => setHelpOpen(false)}
              aria-label="Close guide"
            >
              <X size={19} />
            </button>
            <span className="eyebrow">GESTURES</span>
            <h2 id="help-title">Two gestures. That’s it.</h2>
            <div className="help-grid">
              <article>
                <span>01</span>
                <Hand size={21} />
                <h3>Create</h3>
                <p>Hold an L with each hand for half a second.</p>
              </article>
              <article>
                <span>02</span>
                <MousePointer2 size={21} />
                <h3>Move</h3>
                <p>Pinch inside an area, then move your hand.</p>
              </article>
              <article>
                <span>03</span>
                <Maximize2 size={21} />
                <h3>Resize</h3>
                <p>Pinch a corner, or pinch two opposite corners.</p>
              </article>
            </div>
            <div className="fallback-note">
              <MousePointer2 size={17} />
              <p>
                Mouse and touch always work: drag to create, drag inside to move,
                and drag a corner to resize.
              </p>
            </div>
          </section>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
