"use client";

import {
  CircleHelp,
  CircleStop,
  Ellipsis,
  ImageDown,
  RotateCcw,
  Trash2,
  Video,
} from "lucide-react";
import { memo } from "react";
import { EFFECTS, MAX_ZONES, effectById } from "../_lib/studio-config";
import type {
  EffectId,
  StudioSettings,
} from "../_lib/studio-types";

type StudioToolbarProps = {
  contextualEffect: EffectId;
  settings: StudioSettings;
  zoneCount: number;
  hasSelectedZone: boolean;
  recording: boolean;
  trackingMessage: string;
  onChooseEffect: (effect: EffectId) => void;
  onSettingChange: (effect: EffectId, value: number) => void;
  onDeleteSelected: () => void;
  onToggleRecording: () => void;
  onCaptureSnapshot: () => void;
  onClearZones: () => void;
  onOpenHelp: () => void;
};

export const StudioToolbar = memo(function StudioToolbar({
  contextualEffect,
  settings,
  zoneCount,
  hasSelectedZone,
  recording,
  trackingMessage,
  onChooseEffect,
  onSettingChange,
  onDeleteSelected,
  onToggleRecording,
  onCaptureSnapshot,
  onClearZones,
  onOpenHelp,
}: StudioToolbarProps) {
  const contextualDefinition = effectById(contextualEffect);

  return (
    <div className="camera-toolbar">
      <span
        className="status-light is-live"
        role="status"
        aria-label={trackingMessage}
        title={trackingMessage}
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
              onClick={() => onChooseEffect(effect.id)}
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
          onChange={(event) =>
            onSettingChange(contextualEffect, Number(event.target.value))
          }
        />
      </label>

      <span
        className="zone-count"
        aria-live="polite"
        aria-label={`${zoneCount} of ${MAX_ZONES} areas`}
        title="Areas"
      >
        {zoneCount}/{MAX_ZONES}
      </span>

      {hasSelectedZone ? (
        <button
          className="toolbar-button is-danger"
          type="button"
          onClick={onDeleteSelected}
          aria-label="Delete selected area"
          title="Delete selected area"
        >
          <Trash2 size={17} />
        </button>
      ) : null}

      <button
        className={`toolbar-button record-button ${recording ? "is-recording" : ""}`}
        type="button"
        onClick={onToggleRecording}
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
          <label className="mobile-strength-control">
            <span>
              {contextualDefinition.settingLabel} · {settings[contextualEffect]}
            </span>
            <input
              type="range"
              min={contextualDefinition.min}
              max={contextualDefinition.max}
              step={contextualDefinition.step}
              value={settings[contextualEffect]}
              aria-label={`${contextualDefinition.label}: ${contextualDefinition.settingLabel}`}
              onChange={(event) =>
                onSettingChange(contextualEffect, Number(event.target.value))
              }
            />
          </label>
          <button type="button" onClick={onCaptureSnapshot}>
            <ImageDown size={17} />
            Save image
          </button>
          <button
            type="button"
            onClick={onClearZones}
            disabled={zoneCount === 0}
          >
            <RotateCcw size={17} />
            Clear areas
          </button>
          <button type="button" onClick={onOpenHelp}>
            <CircleHelp size={17} />
            Gesture guide
          </button>
        </div>
      </details>
    </div>
  );
});
