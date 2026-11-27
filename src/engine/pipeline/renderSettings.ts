import type { AdjustmentSettings, FilmId } from '../../types/film';
import type { ToneCurves } from '../../types/curves';
import type { ColorMixerSettings } from '../../types/colorMixer';
import type { SharpeningSettings } from '../../types/sharpening';
import type { CameraSettings } from '../../types/camera';
import type { GeometryTransform } from '../contracts/geometry';
import type { OpticalTransform } from '../contracts/optical';
import type { MaskData } from '../contracts/masks';

export type CompareMode = 'none' | 'original' | 'split';

/**
 * Persisted render inputs shared by the interactive preview and the exporter.
 * New editable feature groups must be added here so both paths receive them.
 * Geometry/optical are applied by the Q02 source stage before the color
 * pipeline; masks stay in corrected NIS for local stages.
 */
export interface RenderSettings {
  filmId?: FilmId;
  adjustments: AdjustmentSettings;
  curves?: ToneCurves;
  colorMixer?: ColorMixerSettings;
  sharpening?: SharpeningSettings;
  camera?: CameraSettings;
  geometry?: GeometryTransform;
  optical?: OpticalTransform;
  masks?: readonly MaskData[];
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
