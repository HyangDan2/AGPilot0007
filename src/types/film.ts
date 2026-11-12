import {SharpeningSettings} from './sharpening';
import type { ColorMixerSettings } from './colorMixer';
import type { ToneCurves } from './curves';
import type { CameraSettings, CameraEffect } from './camera';
export type FilmId =
  | 'identity'
  | 'FS-001'
  | 'FS-002'
  | 'FS-003'
  | 'FS-004'
  | 'FS-005'
  | 'FS-006'
  | 'FS-007'
  | 'FS-008'
  | 'FS-009'
  | 'FS-010';

export interface FilmProfile {
  cameraEffects?: readonly CameraEffect[];
  id: FilmId;
  code: string;
  name: string;
  style: string;
  description: string;
  technicalTarget: string;
  lutFile: string;
  lutSize: number;
  version: string;
  defaultAdjustments: Partial<AdjustmentSettings>;
  grain: {
    amount: number;
    size: number;
    roughness: number;
  };
  provenance: {
    source: string;
    license: string;
    methodology: string;
  };
}

export interface AdjustmentSettings {
  whites?: number;
  blacks?: number;
  exposure: number;       // -3.0 to +3.0 EV
  temperature: number;    // -100 to +100
  tint: number;           // -100 to +100
  highlights: number;     // -100 to +100
  shadows: number;        // -100 to +100
  contrast: number;       // -100 to +100
  saturation: number;     // -100 to +100
  grain: number;          // 0 to 100
  sharpness: number;      // 0 to 100
  vignette: number;       // 0 to 100
  filmStrength: number;   // 0 to 100
}

export const DEFAULT_ADJUSTMENTS: AdjustmentSettings = {
  whites: 0,
  blacks: 0,
  exposure: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  contrast: 0,
  saturation: 0,
  grain: 0,
  sharpness: 0,
  vignette: 0,
  filmStrength: 100,
};

export interface CustomRecipe {
  sharpening?:SharpeningSettings;
  colorMixer?: ColorMixerSettings;
  curves?: ToneCurves;
  camera?: CameraSettings;
  presetId?: string;
  presetVersion?: string;
  id: string;
  name: string;
  baseFilmId: FilmId;
  profileVersion: string;
  adjustments: AdjustmentSettings;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
}
