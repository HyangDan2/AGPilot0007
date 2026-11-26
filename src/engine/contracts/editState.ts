import { ADJUSTMENT_DEFINITIONS } from '../../types/adjustments';
import { DEFAULT_ADJUSTMENTS, type AdjustmentSettings, type FilmId } from '../../types/film';
import { defaultCurves, normalizeCurves, type ToneCurves } from '../../types/curves';
import { normalizeCamera, type CameraSettings } from '../../types/camera';
import { defaultColorMixer, normalizeColorMixer, type ColorMixerSettings } from '../../types/colorMixer';
import { DEFAULT_SHARPENING, normalizeSharpening, type SharpeningSettings } from '../../types/sharpening';
import { FILM_PROFILES } from '../../films/registry';
import { normalizeGeometry, type GeometryTransform } from './geometry';

/**
 * Canonical per-photo edit state. Geometry is part of v8; local masks are a
 * contract-only type and are deliberately not stored here yet.
 */
export interface EditState {
  activeFilmId: FilmId;
  activePresetId: string | null;
  adjustments: AdjustmentSettings;
  curves: ToneCurves;
  camera: CameraSettings;
  colorMixer: ColorMixerSettings;
  sharpening: SharpeningSettings;
  geometry: GeometryTransform;
}

export const HISTORY_LIMIT = 50;

export function createEditState(input: Partial<EditState> = {}, legacySharpness = 0): EditState {
  const adjustments: AdjustmentSettings = { ...DEFAULT_ADJUSTMENTS };
  for (const def of ADJUSTMENT_DEFINITIONS) {
    const value = input.adjustments?.[def.key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      adjustments[def.key] = Math.min(def.max, Math.max(def.min, value));
    }
  }
  const activeFilmId =
    input.activeFilmId && Object.hasOwn(FILM_PROFILES, input.activeFilmId) ? input.activeFilmId : 'FS-001';
  return {
    activeFilmId,
    activePresetId:
      typeof input.activePresetId === 'string' && input.activePresetId.length > 0 ? input.activePresetId : null,
    adjustments,
    curves: input.curves ? normalizeCurves(input.curves) : defaultCurves(),
    camera: normalizeCamera(input.camera),
    colorMixer: input.colorMixer ? normalizeColorMixer(input.colorMixer) : defaultColorMixer(),
    sharpening:
      input.sharpening || legacySharpness > 0
        ? normalizeSharpening(input.sharpening, legacySharpness)
        : { ...DEFAULT_SHARPENING },
    geometry: normalizeGeometry(input.geometry),
  };
}
