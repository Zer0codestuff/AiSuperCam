"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_SETTINGS,
  EFFECTS,
  MAX_ZONES,
  effectById,
} from "../_lib/studio-config";
import { clampRect } from "../_lib/studio-geometry";
import type {
  EffectId,
  Point,
  Rect,
  Zone,
} from "../_lib/studio-types";
import { GestureGuide } from "./gesture-guide";
import { StudioOverlays } from "./studio-overlays";
import { StudioToolbar } from "./studio-toolbar";
import { useStudioGestures } from "../_hooks/use-studio-gestures";
import { useStudioRenderer } from "../_hooks/use-studio-renderer";
import { useVisionSession } from "../_hooks/use-vision-session";

export function AiSuperCamStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const zonesRef = useRef<Zone[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const settingsRef = useRef({ ...DEFAULT_SETTINGS });
  const activeEffectRef = useRef<EffectId>("mesh");
  const renderRevisionRef = useRef(0);
  const zoneStateFrameRef = useRef<number | null>(null);
  const zoneSequenceRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const helpModalRef = useRef<HTMLElement>(null);

  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeEffect, setActiveEffect] = useState<EffectId>("mesh");
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS }));
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

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

  const {
    activateCamera: startCamera,
    canvasAspect,
    faceResultRef,
    handResultRef,
    modelsRef,
    poseResultRef,
    setTrackingMessage,
    setTrackingReady,
    status,
    trackingMessage,
    trackingReady,
    visionRuntimeRef,
  } = useVisionSession({
    canvasRef,
    videoRef,
    showToast,
    syncZones,
    syncSelected,
  });

  const {
    applyGestureTracks,
    creationPreviewRef,
    gestureOperationRef,
    gestureTracksRef,
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    pinchMemoryRef,
    resetGestureState,
  } = useStudioGestures({
    status,
    zonesRef,
    selectedIdRef,
    activeEffectRef,
    addZone,
    updateZone,
    syncZones,
    syncSelected,
  });

  const activateCamera = useCallback(() => {
    resetGestureState();
    void startCamera();
  }, [resetGestureState, startCamera]);

  const deleteSelected = useCallback(() => {
    const target = selectedIdRef.current;
    if (!target) return;
    syncZones(zonesRef.current.filter((zone) => zone.id !== target));
    syncSelected(null);
    showToast("Area deleted");
  }, [showToast, syncSelected, syncZones]);

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

  useEffect(() => {
    settingsRef.current = settings;
    renderRevisionRef.current += 1;
  }, [settings]);

  useEffect(() => {
    activeEffectRef.current = activeEffect;
  }, [activeEffect]);

  useStudioRenderer({
    canvasRef,
    videoRef,
    outputCanvasRef,
    modelsRef,
    visionRuntimeRef,
    handResultRef,
    faceResultRef,
    poseResultRef,
    zonesRef,
    selectedIdRef,
    settingsRef,
    renderRevisionRef,
    gestureOperationRef,
    pinchMemoryRef,
    gestureTracksRef,
    creationPreviewRef,
    status,
    trackingReady,
    setTrackingReady,
    setTrackingMessage,
    applyGestureTracks,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (helpOpen) setHelpOpen(false);
        else syncSelected(null);
        return;
      }

      if (helpOpen || status !== "ready") return;
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
      if (zoneStateFrameRef.current !== null) {
        cancelAnimationFrame(zoneStateFrameRef.current);
      }
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

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

  const updateEffectSetting = useCallback((effect: EffectId, value: number) => {
    setSettings((current) => ({ ...current, [effect]: value }));
  }, []);

  const openHelp = useCallback(() => setHelpOpen(true), []);

  const selectedZone = zones.find((zone) => zone.id === selectedId) ?? null;
  const contextualEffect = selectedZone?.effect ?? activeEffect;
  const isStudioActive = status === "ready";

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
        <div
          className="camera-stage"
          style={
            {
              aspectRatio: canvasAspect,
              "--camera-aspect": canvasAspect,
            } as CSSProperties
          }
        >
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
            aria-label="Interactive webcam. Drag to create an area, drag inside to move it, or drag a corner to resize it. Keyboard: C creates an area, keys 1 through 5 choose effects, arrows move the selection, plus and minus resize it, and Delete removes it."
          />

          {isStudioActive ? (
            <StudioToolbar
              contextualEffect={contextualEffect}
              settings={settings}
              zoneCount={zones.length}
              hasSelectedZone={selectedZone !== null}
              recording={recording}
              trackingMessage={trackingMessage}
              onChooseEffect={chooseEffect}
              onSettingChange={updateEffectSetting}
              onDeleteSelected={deleteSelected}
              onToggleRecording={toggleRecording}
              onCaptureSnapshot={captureSnapshot}
              onClearZones={clearZones}
              onOpenHelp={openHelp}
            />
          ) : null}

          <StudioOverlays
            status={status}
            onActivateCamera={activateCamera}
          />
        </div>
      </section>

      {helpOpen && (
        <GestureGuide
          modalRef={helpModalRef}
          onClose={() => setHelpOpen(false)}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
