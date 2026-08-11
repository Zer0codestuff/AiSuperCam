"use client";

import type {
  FaceLandmarkerResult,
  HandLandmarkerResult,
  PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  AppStatus,
  VisionModels,
  VisionRuntime,
  Zone,
} from "../_lib/studio-types";

type UseVisionSessionOptions = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  showToast: (message: string) => void;
  syncZones: (zones: Zone[]) => void;
  syncSelected: (zoneId: string | null) => void;
};

export function useVisionSession({
  canvasRef,
  videoRef,
  showToast,
  syncZones,
  syncSelected,
}: UseVisionSessionOptions) {
  const streamRef = useRef<MediaStream | null>(null);
  const modelsRef = useRef<VisionModels | null>(null);
  const visionRuntimeRef = useRef<VisionRuntime | null>(null);
  const handResultRef = useRef<HandLandmarkerResult | null>(null);
  const faceResultRef = useRef<FaceLandmarkerResult | null>(null);
  const poseResultRef = useRef<PoseLandmarkerResult | null>(null);
  const sessionGenerationRef = useRef(0);

  const [status, setStatus] = useState<AppStatus>("idle");
  const [trackingReady, setTrackingReady] = useState(false);
  const [trackingMessage, setTrackingMessage] = useState("Waiting");
  const [canvasAspect, setCanvasAspect] = useState(16 / 9);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [videoRef]);

  const closeModels = useCallback(() => {
    poseResultRef.current?.close();
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
        outputSegmentationMasks: true,
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

  const initialiseVision = useCallback(
    async (session: number) => {
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
    },
    [closeModels, createVisionModels],
  );

  const activateCamera = useCallback(async () => {
    const session = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = session;
    setStatus("starting-camera");
    setTrackingMessage("Starting camera");
    setTrackingReady(false);
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
      setCanvasAspect(sourceWidth / sourceHeight);
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
        name === "NotAllowedError" || name === "SecurityError"
          ? "denied"
          : "error",
      );
      setTrackingMessage("Camera unavailable");
    }
  }, [
    canvasRef,
    closeModels,
    initialiseVision,
    showToast,
    stopCamera,
    syncSelected,
    syncZones,
    videoRef,
  ]);

  useEffect(() => {
    return () => {
      sessionGenerationRef.current += 1;
      stopCamera();
      closeModels();
    };
  }, [closeModels, stopCamera]);

  return {
    activateCamera,
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
  };
}
