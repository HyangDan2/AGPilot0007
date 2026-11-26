import type { AdjustmentSettings, FilmId } from '../../types/film';
import type { ToneCurves } from '../../types/curves';
import type { ColorMixerSettings } from '../../types/colorMixer';
import type { SharpeningSettings } from '../../types/sharpening';
import type { CameraSettings } from '../../types/camera';

export type CompareMode = 'none' | 'original' | 'split';

/**
 * Persisted render inputs shared by the interactive preview and the exporter.
 * New editable feature groups must be added here so both paths receive them.
 */
export interface RenderSettings {
  filmId?: FilmId;
  adjustments: AdjustmentSettings;
  curves?: ToneCurves;
  colorMixer?: ColorMixerSettings;
  sharpening?: SharpeningSettings;
  camera?: CameraSettings;
}

/**
 * A single render call. Extends RenderSettings with preview-only flags that are
 * never persisted and never affect exported output when unset.
 */
export interface RenderRequest extends RenderSettings {
  compareMode: CompareMode;
  splitPos: number;
  seed?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  sharpeningMask?: boolean;
  sharpeningDraft?: boolean;
  mixerReference?: boolean;
  mixerVisualize?: string | null;
}
