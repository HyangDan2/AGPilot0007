import type { AdjustmentSettings, FilmId } from '../../types/film';
import type { CameraSettings } from '../../types/camera';
import type { ColorMixerSettings } from '../../types/colorMixer';
import type { ToneCurves } from '../../types/curves';
import type { SharpeningSettings } from '../../types/sharpening';
import type { GeometryTransform } from '../../engine/contracts/geometry';
import type { OpticalTransform } from '../../engine/contracts/optical';
import type { LocalAdjustmentState } from '../../engine/contracts/localAdjustments';

/**
 * CP1 PoC contract for one image's edit state.
 *
 * Mirrors the fields workspaceStore already snapshots per photo (see
 * src/stores/workspaceStore.ts) so a later Q01 store integration can adopt it
 * without changing the Recipe schema. No store is modified from this module.
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
  optical: OpticalTransform | null;
  localAdjustments: LocalAdjustmentState;
}

export const PARAMETER_GROUPS = [
  'film',
  'tone',
  'grain',
  'curves',
  'camera',
  'colorMixer',
  'sharpening',
  'geometry',
  'optical',
  'localAdjustments',
] as const;
export type ParameterGroup = (typeof PARAMETER_GROUPS)[number];

export const GROUP_LABELS: Record<ParameterGroup, string> = {
  film: 'Film & Preset',
  tone: 'Light & Color',
  grain: 'Grain & Vignette',
  curves: 'Tone Curves',
  camera: 'Camera Effects',
  colorMixer: 'Color Lab',
  sharpening: 'Sharpening',
  geometry: 'Framing & Crop',
  optical: 'Optical Corrections',
  localAdjustments: 'Local Adjustments',
};

/** Portion of an EditState copied through selective copy/paste. */
export interface ParameterClip {
  sourceId: string;
  groups: ParameterGroup[];
  film?: Pick<EditState, 'activeFilmId' | 'activePresetId'>;
  tone?: Partial<AdjustmentSettings>;
  grain?: Pick<AdjustmentSettings, 'grain' | 'vignette' | 'filmStrength'>;
  curves?: ToneCurves;
  camera?: CameraSettings;
  colorMixer?: ColorMixerSettings;
  sharpening?: SharpeningSettings;
  geometry?: GeometryTransform;
  optical?: OpticalTransform | null;
  localAdjustments?: LocalAdjustmentState;
}
