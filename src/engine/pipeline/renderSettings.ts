import type { AdjustmentSettings, FilmId } from '../../types/film';
import type { ToneCurves } from '../../types/curves';
import type { ColorMixerSettings } from '../../types/colorMixer';
import type { SharpeningSettings } from '../../types/sharpening';
import type { CameraSettings } from '../../types/camera';
import type { GeometryTransform } from '../contracts/geometry';
import type { OpticalTransform } from '../contracts/optical';
import type { MaskData } from '../contracts/masks';
import type { LocalAdjustmentState } from '../contracts/localAdjustments';
import type { LocalStagePlan } from './localStageSeam';

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
  localAdjustments?: LocalAdjustmentState;
  /** Q02's rasterized plan; null/undefined keeps the CP2 render path untouched. */
  localStage?: LocalStagePlan | null;
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

/**
 * @deprecated CP4 composes RAW develop as a decoder-baked baseline via
 * `composeDevelop`; user exposure/white balance stay additive. Kept only for the
 * locked `src/poc` batch path, which still imports it, and it no longer zeroes
 * anything (BL-CP3-01).
 */
export function withRawDevelopGuard<T extends RenderSettings>(
  settings: T,
  _develop: { identity: boolean } | null | undefined,
): T {
  return settings;
}
