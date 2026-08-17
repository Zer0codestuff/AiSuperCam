"use client";

import { Camera, CameraOff, LoaderCircle, Sparkles } from "lucide-react";
import { memo } from "react";
import type { AppStatus } from "../_lib/studio-types";

type StudioOverlaysProps = {
  status: AppStatus;
  onActivateCamera: () => void;
};

export const StudioOverlays = memo(function StudioOverlays({
  status,
  onActivateCamera,
}: StudioOverlaysProps) {
  if (status === "idle") {
    return (
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
              onClick={onActivateCamera}
            >
              <Camera size={17} />
              Enable camera
            </button>
          </div>
          <small>Frames stay in this browser. MediaPipe usage metrics are blocked.</small>
        </div>
      </div>
    );
  }

  if (status === "starting-camera" || status === "starting-ai") {
    return (
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
              ? "Hand tracking loads on this device"
              : "Waiting for browser permission"}
          </span>
        </div>
      </div>
    );
  }

  if (status === "denied" || status === "error") {
    return (
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
              ? "Allow camera access in your browser settings, then try again."
              : "Connect a camera, then try again."}
          </p>
          <div className="start-actions">
            <button
              className="primary-button"
              type="button"
              onClick={onActivateCamera}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
});
