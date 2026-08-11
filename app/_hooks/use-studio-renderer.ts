"use client";

import type {
  FaceLandmarkerResult,
  HandLandmarkerResult,
  PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
  useEffect,
} from "react";
import {
  asciiGlyph,
  asciiInkColorInto,
  asciiTone,
} from "../ascii-effect.mjs";
import {
  BAYER_4X4,
  THERMAL_GAMMA_LUT,
  THERMAL_LUT,
  THERMAL_STOPS,
  adaptiveLuminanceRange,
  drawConnections,
  estimatedSkinWarmth,
  normalizeLuminance,
  paintMirroredSegmentationMask,
  rgbLuminance,
  roundedRectPath,
} from "../_lib/studio-canvas-utils";
import {
  clamp,
  cornersForRect,
  landmarkPoint,
  midpoint,
  rectCenter,
} from "../_lib/studio-geometry";
import { handDistance, isLShape } from "../_lib/studio-gesture-utils";
import type {
  AppStatus,
  CanvasBuffer,
  GestureOperation,
  GestureTrack,
  PinchMemory,
  Rect,
  StudioSettings,
  VisionModels,
  VisionRuntime,
  Zone,
  ZoneSampleBuffer,
} from "../_lib/studio-types";

type UseStudioRendererOptions = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  outputCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  modelsRef: MutableRefObject<VisionModels | null>;
  visionRuntimeRef: MutableRefObject<VisionRuntime | null>;
  handResultRef: MutableRefObject<HandLandmarkerResult | null>;
  faceResultRef: MutableRefObject<FaceLandmarkerResult | null>;
  poseResultRef: MutableRefObject<PoseLandmarkerResult | null>;
  zonesRef: MutableRefObject<Zone[]>;
  selectedIdRef: MutableRefObject<string | null>;
  settingsRef: MutableRefObject<StudioSettings>;
  renderRevisionRef: MutableRefObject<number>;
  gestureOperationRef: MutableRefObject<GestureOperation>;
  pinchMemoryRef: MutableRefObject<Map<string, PinchMemory>>;
  gestureTracksRef: MutableRefObject<GestureTrack[]>;
  creationPreviewRef: MutableRefObject<{ rect: Rect; progress: number } | null>;
  status: AppStatus;
  trackingReady: boolean;
  setTrackingReady: Dispatch<SetStateAction<boolean>>;
  setTrackingMessage: Dispatch<SetStateAction<string>>;
  applyGestureTracks: (
    tracks: GestureTrack[],
    now: number,
    canvasWidth: number,
    canvasHeight: number,
  ) => void;
};

export function useStudioRenderer({
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
}: UseStudioRendererOptions) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: false });
    if (!context) return;

    const source = document.createElement("canvas");
    const output = outputCanvasRef.current ?? document.createElement("canvas");
    outputCanvasRef.current = output;
    const sourceContext = source.getContext("2d");
    const outputContext = output.getContext("2d", { alpha: false });
    if (!sourceContext || !outputContext) return;

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
    let lastDetectionAt = 0;
    let detectionFrame = 0;
    let trackingFailed = false;
    let outputIsBlack = false;
    let effectLuminance = new Float32Array(0);
    let effectHeat = new Float32Array(0);
    let effectHeatSmooth = new Float32Array(0);
    const rangeMemory = new Map<string, { low: number; high: number }>();
    const hotspotMemory = new Map<
      string,
      { x: number; y: number; confidence: number }
    >();
    const sampleBuffers = new Map<string, ZoneSampleBuffer>();
    const segmentationCanvas = document.createElement("canvas");
    const segmentationContext = segmentationCanvas.getContext("2d");
    let hasSegmentationMask = false;
    let segmentationFailed = false;

    const getSampleBuffer = (zoneId: string) => {
      const existing = sampleBuffers.get(zoneId);
      if (existing) return existing;
      const sampleCanvas = document.createElement("canvas");
      const sampleContext = sampleCanvas.getContext("2d", {
        willReadFrequently: true,
      });
      if (!sampleContext) return null;
      const buffer = { canvas: sampleCanvas, context: sampleContext };
      sampleBuffers.set(zoneId, buffer);
      return buffer;
    };

    const getAsciiLayer = (buffer: ZoneSampleBuffer) => {
      if (buffer.asciiLayer) return buffer.asciiLayer;
      const layerCanvas = document.createElement("canvas");
      const layerContext = layerCanvas.getContext("2d");
      if (!layerContext) return null;
      buffer.asciiLayer = { canvas: layerCanvas, context: layerContext };
      return buffer.asciiLayer;
    };

    const getAuraLayer = (
      buffer: ZoneSampleBuffer,
      key: "auraMask" | "auraGlow" | "auraSubject",
    ): CanvasBuffer | null => {
      const existing = buffer[key];
      if (existing) return existing;
      const layerCanvas = document.createElement("canvas");
      const layerContext = layerCanvas.getContext("2d");
      if (!layerContext) return null;
      const layer = { canvas: layerCanvas, context: layerContext };
      buffer[key] = layer;
      return layer;
    };

    const updatePoseSegmentation = (result: PoseLandmarkerResult) => {
      if (!segmentationContext) return;
      const mask = result.segmentationMasks?.[0];
      if (!mask) {
        hasSegmentationMask = false;
        segmentationContext.clearRect(
          0,
          0,
          segmentationCanvas.width,
          segmentationCanvas.height,
        );
        return;
      }
      try {
        paintMirroredSegmentationMask(
          segmentationCanvas,
          segmentationContext,
          mask.getAsFloat32Array(),
          mask.width,
          mask.height,
        );
        hasSegmentationMask = true;
      } catch (error) {
        hasSegmentationMask = false;
        if (!segmentationFailed) {
          console.warn("Segmentation mask unavailable", error);
          segmentationFailed = true;
        }
      }
    };

    const ensureEffectBuffers = (count: number) => {
      if (effectLuminance.length < count) effectLuminance = new Float32Array(count);
      if (effectHeat.length < count) effectHeat = new Float32Array(count);
      if (effectHeatSmooth.length < count) effectHeatSmooth = new Float32Array(count);
    };

    const stabilizeRange = (
      key: string,
      current: { low: number; high: number },
      response = 0.2,
    ) => {
      const previous = rangeMemory.get(key);
      if (!previous) {
        rangeMemory.set(key, current);
        return current;
      }
      const next = {
        low: previous.low + (current.low - previous.low) * response,
        high: previous.high + (current.high - previous.high) * response,
      };
      rangeMemory.set(key, next);
      return next;
    };

    const drawZoneEffect = (zone: Zone) => {
      const sampleBuffer = getSampleBuffer(zone.id);
      if (!sampleBuffer) return;
      const sample = sampleBuffer.canvas;
      const sampleContext = sampleBuffer.context;
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

      if (zone.effect === "aura") {
        const maskLayer = getAuraLayer(sampleBuffer, "auraMask");
        const glowLayer = getAuraLayer(sampleBuffer, "auraGlow");
        const subjectLayer = getAuraLayer(sampleBuffer, "auraSubject");
        if (!maskLayer || !glowLayer || !subjectLayer) {
          context.restore();
          return;
        }

        resizeBuffer(maskLayer.canvas, zoneWidth, zoneHeight);
        resizeBuffer(glowLayer.canvas, zoneWidth, zoneHeight);
        resizeBuffer(subjectLayer.canvas, zoneWidth, zoneHeight);
        maskLayer.context.clearRect(0, 0, zoneWidth, zoneHeight);
        glowLayer.context.clearRect(0, 0, zoneWidth, zoneHeight);
        subjectLayer.context.clearRect(0, 0, zoneWidth, zoneHeight);

        context.fillStyle = "rgba(2, 5, 12, .56)";
        context.fillRect(x, y, zoneWidth, zoneHeight);

        if (hasSegmentationMask) {
          const maskX = zone.rect.x * segmentationCanvas.width;
          const maskY = zone.rect.y * segmentationCanvas.height;
          const maskWidth = zone.rect.w * segmentationCanvas.width;
          const maskHeight = zone.rect.h * segmentationCanvas.height;
          maskLayer.context.save();
          maskLayer.context.filter = "blur(1.2px)";
          maskLayer.context.drawImage(
            segmentationCanvas,
            maskX,
            maskY,
            maskWidth,
            maskHeight,
            0,
            0,
            zoneWidth,
            zoneHeight,
          );
          maskLayer.context.restore();

          subjectLayer.context.save();
          subjectLayer.context.filter = "saturate(1.16) contrast(1.06)";
          subjectLayer.context.drawImage(
            source,
            x,
            y,
            zoneWidth,
            zoneHeight,
            0,
            0,
            zoneWidth,
            zoneHeight,
          );
          subjectLayer.context.filter = "none";
          subjectLayer.context.globalCompositeOperation = "destination-in";
          subjectLayer.context.drawImage(maskLayer.canvas, 0, 0);
          subjectLayer.context.restore();

          const intensity = settingsRef.current.aura / 100;
          const gradient = glowLayer.context.createLinearGradient(
            0,
            zoneHeight,
            zoneWidth,
            0,
          );
          gradient.addColorStop(0, "#35ffe4");
          gradient.addColorStop(0.52, "#6f7dff");
          gradient.addColorStop(1, "#ff4fc4");
          const blurRadius = Math.max(
            5,
            Math.min(28, zoneWidth / 42 + intensity * 18),
          );

          glowLayer.context.save();
          glowLayer.context.filter = `blur(${blurRadius}px)`;
          glowLayer.context.drawImage(maskLayer.canvas, 0, 0);
          glowLayer.context.filter = "none";
          glowLayer.context.globalCompositeOperation = "source-in";
          glowLayer.context.fillStyle = gradient;
          glowLayer.context.fillRect(0, 0, zoneWidth, zoneHeight);
          glowLayer.context.globalCompositeOperation = "destination-out";
          glowLayer.context.drawImage(maskLayer.canvas, 0, 0);
          glowLayer.context.restore();

          context.save();
          context.globalCompositeOperation = "screen";
          context.globalAlpha = 0.58 + intensity * 0.34;
          context.drawImage(glowLayer.canvas, x, y);
          context.restore();

          context.save();
          context.globalAlpha = 0.94;
          context.drawImage(subjectLayer.canvas, x, y);
          context.restore();

          glowLayer.context.clearRect(0, 0, zoneWidth, zoneHeight);
          glowLayer.context.drawImage(maskLayer.canvas, 0, 0);
          glowLayer.context.globalCompositeOperation = "source-in";
          glowLayer.context.fillStyle = gradient;
          glowLayer.context.fillRect(0, 0, zoneWidth, zoneHeight);
          glowLayer.context.globalCompositeOperation = "source-over";

          context.save();
          context.globalCompositeOperation = "screen";
          context.globalAlpha = 0.1 + intensity * 0.17;
          context.shadowColor = "rgba(72, 255, 231, .95)";
          context.shadowBlur = 5 + intensity * 9;
          context.drawImage(glowLayer.canvas, x, y);
          context.restore();
        }
      }

      if (zone.effect === "thermal") {
        const targetWidth = Math.max(48, Math.min(200, Math.round(zoneWidth / 3)));
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
        const pixelCount = targetWidth * targetHeight;
        ensureEffectBuffers(pixelCount);

        for (let pixel = 0; pixel < pixelCount; pixel += 1) {
          const dataIndex = pixel * 4;
          effectLuminance[pixel] = rgbLuminance(
            image.data[dataIndex],
            image.data[dataIndex + 1],
            image.data[dataIndex + 2],
          );
        }

        const range = stabilizeRange(
          `${zone.id}:thermal`,
          adaptiveLuminanceRange(effectLuminance, pixelCount),
          0.18,
        );
        const contrast = 0.82 + (settingsRef.current.thermal / 100) * 0.82;

        for (let pixel = 0; pixel < pixelCount; pixel += 1) {
          const dataIndex = pixel * 4;
          const normalized = normalizeLuminance(
            effectLuminance[pixel],
            range.low,
            range.high,
          );
          const contrasted = clamp((normalized - 0.5) * contrast + 0.5, 0, 1);
          const lifted = THERMAL_GAMMA_LUT[Math.round(contrasted * 255)];
          const skinWarmth = estimatedSkinWarmth(
            image.data[dataIndex],
            image.data[dataIndex + 1],
            image.data[dataIndex + 2],
          );
          effectHeat[pixel] = clamp(lifted * 0.88 + skinWarmth * 0.12, 0, 1);
        }

        for (let row = 0; row < targetHeight; row += 1) {
          const above = Math.max(0, row - 1);
          const below = Math.min(targetHeight - 1, row + 1);
          for (let column = 0; column < targetWidth; column += 1) {
            const left = Math.max(0, column - 1);
            const right = Math.min(targetWidth - 1, column + 1);
            const center = row * targetWidth + column;
            effectHeatSmooth[center] =
              (effectHeat[above * targetWidth + left] +
                effectHeat[above * targetWidth + column] * 2 +
                effectHeat[above * targetWidth + right] +
                effectHeat[row * targetWidth + left] * 2 +
                effectHeat[center] * 4 +
                effectHeat[row * targetWidth + right] * 2 +
                effectHeat[below * targetWidth + left] +
                effectHeat[below * targetWidth + column] * 2 +
                effectHeat[below * targetWidth + right]) /
              16;
          }
        }

        let hottestValue = 0;
        let hotspotWeight = 0;
        let hotspotColumn = 0;
        let hotspotRow = 0;
        for (let row = 0; row < targetHeight; row += 1) {
          const above = Math.max(0, row - 1);
          const below = Math.min(targetHeight - 1, row + 1);
          for (let column = 0; column < targetWidth; column += 1) {
            const left = Math.max(0, column - 1);
            const right = Math.min(targetWidth - 1, column + 1);
            const pixel = row * targetWidth + column;
            const dataIndex = pixel * 4;
            const heat = clamp(
              effectHeat[pixel] * 0.38 + effectHeatSmooth[pixel] * 0.62,
              0,
              1,
            );
            if (heat > hottestValue) {
              hottestValue = heat;
            }
            const hotspotContribution = Math.max(0, heat - 0.86);
            hotspotWeight += hotspotContribution;
            hotspotColumn += (column + 0.5) * hotspotContribution;
            hotspotRow += (row + 0.5) * hotspotContribution;

            const horizontal =
              effectHeatSmooth[row * targetWidth + right] -
              effectHeatSmooth[row * targetWidth + left];
            const vertical =
              effectHeatSmooth[below * targetWidth + column] -
              effectHeatSmooth[above * targetWidth + column];
            const edge = clamp(
              (Math.abs(horizontal) + Math.abs(vertical) - 0.025) * 2.1,
              0,
              0.3,
            );
            const isolineDistance = Math.abs(heat * 11 - Math.round(heat * 11));
            const isoline = clamp((0.052 - isolineDistance) / 0.052, 0, 1);
            const dither =
              (((BAYER_4X4[(row % 4) * 4 + (column % 4)] + 0.5) / 16) - 0.5) /
              31;
            const quantized = Math.round(clamp(heat + dither, 0, 1) * 31) / 31;
            const paletteIndex = Math.round(quantized * 255) * 3;
            const hotAmount = clamp((heat - 0.8) / 0.2, 0, 1);
            const hotGlow = hotAmount * hotAmount * 0.3;
            const shade = 1 - edge * 0.78 - isoline * 0.24;

            image.data[dataIndex] = Math.round(
              (THERMAL_LUT[paletteIndex] * (1 - hotGlow) + 255 * hotGlow) * shade,
            );
            image.data[dataIndex + 1] = Math.round(
              (THERMAL_LUT[paletteIndex + 1] * (1 - hotGlow) + 255 * hotGlow) * shade,
            );
            image.data[dataIndex + 2] = Math.round(
              (THERMAL_LUT[paletteIndex + 2] * (1 - hotGlow) + 255 * hotGlow) * shade,
            );
            image.data[dataIndex + 3] = 255;
          }
        }
        sampleContext.putImageData(image, 0, 0);
        context.imageSmoothingEnabled = true;
        context.drawImage(sample, 0, 0, targetWidth, targetHeight, x, y, zoneWidth, zoneHeight);

        if (zoneWidth > 130 && zoneHeight > 92) {
          const legendWidth = Math.max(6, Math.min(10, zoneWidth / 65));
          const legendHeight = Math.min(zoneHeight * 0.58, 150);
          const legendInset = Math.max(8, Math.min(14, zoneWidth / 38));
          const legendX = x + zoneWidth - legendInset - legendWidth;
          const legendY = y + (zoneHeight - legendHeight) / 2;
          const legend = context.createLinearGradient(
            0,
            legendY + legendHeight,
            0,
            legendY,
          );
          THERMAL_STOPS.forEach(([red, green, blue], index) => {
            legend.addColorStop(
              index / (THERMAL_STOPS.length - 1),
              `rgb(${red} ${green} ${blue})`,
            );
          });
          context.save();
          context.fillStyle = "rgba(0,0,0,.46)";
          context.fillRect(
            legendX - 3,
            legendY - 3,
            legendWidth + 6,
            legendHeight + 6,
          );
          context.fillStyle = legend;
          context.fillRect(legendX, legendY, legendWidth, legendHeight);
          context.strokeStyle = "rgba(255,255,255,.58)";
          context.lineWidth = Math.max(0.8, width / 1600);
          context.strokeRect(legendX, legendY, legendWidth, legendHeight);
          context.restore();
        }

        const previousHotspot = hotspotMemory.get(zone.id);
        const hotspotEvidence = clamp(
          (hotspotWeight / pixelCount - 0.0008) / 0.006,
          0,
          1,
        );
        const rawHotX =
          hotspotWeight > 0 ? hotspotColumn / hotspotWeight / targetWidth : 0.5;
        const rawHotY =
          hotspotWeight > 0 ? hotspotRow / hotspotWeight / targetHeight : 0.5;
        const hotspot = {
          x: previousHotspot
            ? previousHotspot.x + (rawHotX - previousHotspot.x) * 0.2
            : rawHotX,
          y: previousHotspot
            ? previousHotspot.y + (rawHotY - previousHotspot.y) * 0.2
            : rawHotY,
          confidence:
            (previousHotspot?.confidence ?? 0) * 0.78 + hotspotEvidence * 0.22,
        };
        hotspotMemory.set(zone.id, hotspot);

        if (
          hottestValue > 0.82 &&
          hotspot.confidence > 0.24 &&
          zoneWidth > 110 &&
          zoneHeight > 76
        ) {
          const hotX = x + hotspot.x * zoneWidth;
          const hotY = y + hotspot.y * zoneHeight;
          const radius = Math.max(6, Math.min(14, zoneWidth / 45));
          context.save();
          context.beginPath();
          context.arc(hotX, hotY, radius, 0, Math.PI * 2);
          context.moveTo(hotX - radius * 1.5, hotY);
          context.lineTo(hotX - radius * 0.55, hotY);
          context.moveTo(hotX + radius * 0.55, hotY);
          context.lineTo(hotX + radius * 1.5, hotY);
          context.moveTo(hotX, hotY - radius * 1.5);
          context.lineTo(hotX, hotY - radius * 0.55);
          context.moveTo(hotX, hotY + radius * 0.55);
          context.lineTo(hotX, hotY + radius * 1.5);
          context.strokeStyle = "rgba(0,0,0,.72)";
          context.lineWidth = Math.max(3, width / 360);
          context.stroke();
          context.strokeStyle = "rgba(255,255,255,.88)";
          context.lineWidth = Math.max(1.2, width / 960);
          context.stroke();
          context.restore();
        }
      }

      if (zone.effect === "ascii") {
        const asciiLayer = getAsciiLayer(sampleBuffer);
        if (!asciiLayer) {
          context.restore();
          return;
        }
        const backingToCss = width / Math.max(1, canvas.clientWidth || width);
        const cellSize = settingsRef.current.ascii * backingToCss;
        const columns = Math.max(4, Math.min(120, Math.floor(zoneWidth / cellSize)));
        const rows = Math.max(
          3,
          Math.min(80, Math.floor(zoneHeight / (cellSize * 1.08))),
        );
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
        const pixelCount = columns * rows;
        ensureEffectBuffers(pixelCount);
        for (let pixel = 0; pixel < pixelCount; pixel += 1) {
          const dataIndex = pixel * 4;
          effectLuminance[pixel] = rgbLuminance(
            image.data[dataIndex],
            image.data[dataIndex + 1],
            image.data[dataIndex + 2],
          );
        }
        const range = stabilizeRange(
          `${zone.id}:ascii`,
          adaptiveLuminanceRange(effectLuminance, pixelCount),
          0.24,
        );

        context.fillStyle = "rgba(3,7,8,.79)";
        context.fillRect(x, y, zoneWidth, zoneHeight);
        const charWidth = zoneWidth / columns;
        const charHeight = zoneHeight / rows;
        resizeBuffer(asciiLayer.canvas, zoneWidth, zoneHeight);
        asciiLayer.context.clearRect(0, 0, zoneWidth, zoneHeight);
        asciiLayer.context.font = `${Math.ceil(charHeight * 1.04)}px "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;
        asciiLayer.context.textAlign = "left";
        asciiLayer.context.textBaseline = "middle";
        asciiLayer.context.fillStyle = "#fff";
        const measuredGlyph = Math.max(
          1,
          asciiLayer.context.measureText("M").width,
        );
        const horizontalScale = charWidth / measuredGlyph;

        asciiLayer.context.save();
        asciiLayer.context.scale(horizontalScale, 1);
        for (let row = 0; row < rows; row += 1) {
          let line = "";
          for (let column = 0; column < columns; column += 1) {
            const pixel = row * columns + column;
            const dataIndex = pixel * 4;
            const center = normalizeLuminance(
              effectLuminance[pixel],
              range.low,
              range.high,
            );
            const left = normalizeLuminance(
              effectLuminance[row * columns + Math.max(0, column - 1)],
              range.low,
              range.high,
            );
            const right = normalizeLuminance(
              effectLuminance[row * columns + Math.min(columns - 1, column + 1)],
              range.low,
              range.high,
            );
            const above = normalizeLuminance(
              effectLuminance[Math.max(0, row - 1) * columns + column],
              range.low,
              range.high,
            );
            const below = normalizeLuminance(
              effectLuminance[Math.min(rows - 1, row + 1) * columns + column],
              range.low,
              range.high,
            );
            const edge = clamp(
              Math.hypot(right - left, below - above) * 0.18,
              0,
              0.12,
            );
            const tone = asciiTone(center, edge);
            const glyph = asciiGlyph(tone);
            line += glyph;

            if (glyph === " ") image.data[dataIndex + 3] = 0;
            else asciiInkColorInto(image.data, dataIndex, tone);
          }
          asciiLayer.context.fillText(line, 0, (row + 0.52) * charHeight);
        }
        asciiLayer.context.restore();

        sampleContext.putImageData(image, 0, 0);
        asciiLayer.context.save();
        asciiLayer.context.globalCompositeOperation = "source-in";
        asciiLayer.context.imageSmoothingEnabled = false;
        asciiLayer.context.drawImage(
          sample,
          0,
          0,
          columns,
          rows,
          0,
          0,
          zoneWidth,
          zoneHeight,
        );
        asciiLayer.context.restore();

        context.save();
        context.shadowColor = "rgba(0,0,0,.72)";
        context.shadowBlur =
          charHeight / backingToCss >= 10 ? Math.max(1, charHeight * 0.07) : 0;
        context.drawImage(asciiLayer.canvas, x, y);
        context.restore();
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
          const needsAura = zonesRef.current.some((zone) => zone.effect === "aura");
          if (needsAura) {
            if (detectionFrame % 2 === 0) {
              const nextPose = models.pose.detectForVideo(video, timestamp);
              poseResultRef.current?.close();
              poseResultRef.current = nextPose;
              updatePoseSegmentation(nextPose);
            } else if (needsMesh) {
              faceResultRef.current = models.face.detectForVideo(video, timestamp);
            }
          } else if (needsMesh && detectionFrame % 3 === 0) {
            faceResultRef.current = models.face.detectForVideo(video, timestamp);
          } else if (needsMesh && detectionFrame % 4 === 1) {
            const nextPose = models.pose.detectForVideo(video, timestamp);
            poseResultRef.current?.close();
            poseResultRef.current = nextPose;
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

      const needsComposite =
        output.width !== width ||
        output.height !== height ||
        lastCompositeRevision !== renderRevisionRef.current ||
        (canDrawVideo && video.currentTime !== lastCompositedVideoTime);

      if (!canDrawVideo) {
        const shouldRefreshBlack =
          !outputIsBlack ||
          output.width !== width ||
          output.height !== height ||
          status === "ready";
        if (shouldRefreshBlack) {
          context.clearRect(0, 0, width, height);
          context.fillStyle = "#000";
          context.fillRect(0, 0, width, height);
          resizeBuffer(output, width, height);
          outputContext.fillStyle = "#000";
          outputContext.fillRect(0, 0, width, height);
          lastCompositeRevision = renderRevisionRef.current;
          lastCompositedVideoTime = -1;
          outputIsBlack = true;
        }
      } else {
        context.clearRect(0, 0, width, height);
        if (needsComposite) {
          context.save();
          context.translate(width, 0);
          context.scale(-1, 1);
          context.drawImage(video, 0, 0, width, height);
          context.restore();
          resizeBuffer(source, width, height);
          sourceContext.drawImage(canvas, 0, 0, width, height);
          zonesRef.current.forEach((zone) => drawZoneEffect(zone));
          const liveZoneIds = new Set(zonesRef.current.map((zone) => zone.id));
          const liveThermalIds = new Set(
            zonesRef.current
              .filter((zone) => zone.effect === "thermal")
              .map((zone) => zone.id),
          );
          const liveRangeKeys = new Set(
            zonesRef.current.map((zone) => `${zone.id}:${zone.effect}`),
          );
          for (const zoneId of sampleBuffers.keys()) {
            if (!liveZoneIds.has(zoneId)) sampleBuffers.delete(zoneId);
          }
          for (const zoneId of hotspotMemory.keys()) {
            if (!liveThermalIds.has(zoneId)) hotspotMemory.delete(zoneId);
          }
          for (const key of rangeMemory.keys()) {
            if (!liveRangeKeys.has(key)) rangeMemory.delete(key);
          }
          resizeBuffer(output, width, height);
          outputContext.drawImage(canvas, 0, 0, width, height);
          lastCompositeRevision = renderRevisionRef.current;
          lastCompositedVideoTime = video.currentTime;
        } else {
          context.drawImage(output, 0, 0, width, height);
        }
        outputIsBlack = false;
      }

      if (status === "ready") {
        zonesRef.current.forEach((zone) => drawZoneChrome(zone));
        drawCreationPreview();
        drawGestureCursors();
      }
      animationFrame = requestAnimationFrame(render);
    };

    animationFrame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrame);
  }, [
    applyGestureTracks,
    canvasRef,
    creationPreviewRef,
    faceResultRef,
    gestureOperationRef,
    gestureTracksRef,
    handResultRef,
    modelsRef,
    outputCanvasRef,
    pinchMemoryRef,
    poseResultRef,
    renderRevisionRef,
    selectedIdRef,
    setTrackingMessage,
    setTrackingReady,
    settingsRef,
    status,
    trackingReady,
    videoRef,
    visionRuntimeRef,
    zonesRef,
  ]);
}
