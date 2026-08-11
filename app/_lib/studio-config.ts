import {
  Binary,
  Grid2X2,
  PersonStanding,
  ScanFace,
  Thermometer,
} from "lucide-react";
import type {
  EffectDefinition,
  EffectId,
  StudioSettings,
} from "./studio-types";

export const EFFECTS: EffectDefinition[] = [
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
    description: "Adaptive light characters",
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
    description: "Adaptive heat map and contours",
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
  {
    id: "aura",
    label: "Aura",
    shortLabel: "Aura",
    description: "Person silhouette and neon glow",
    icon: PersonStanding,
    settingLabel: "Glow",
    min: 20,
    max: 100,
    step: 1,
  },
];

export const DEFAULT_SETTINGS: StudioSettings = {
  mesh: 72,
  ascii: 13,
  thermal: 68,
  pixel: 16,
  aura: 72,
};

export const MAX_ZONES = 4;
export const MIN_ZONE_W = 0.08;
export const MIN_ZONE_H = 0.08;

export function effectById(id: EffectId) {
  return EFFECTS.find((effect) => effect.id === id) ?? EFFECTS[0];
}
