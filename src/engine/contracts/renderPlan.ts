import type { RenderSettings } from '../pipeline/renderSettings';
import { CURVE_CHANNELS, isIdentityCurve } from '../../types/curves';
import { geometryIsIdentity } from './geometry';
import { PIPELINE_STAGES, type PipelineStage } from './stages';

export type RenderTargetKind = 'preview' | 'export';

export const RENDER_FEATURES = [
  'geometry',
  'film',
  'curves',
  'colorMixer.rgbBase',
  'colorMixer.spectrum',
  'colorMixer.points',
  'sharpening',
  'camera.date',
  'camera.optics',
] as const;

export type RenderFeature = (typeof RENDER_FEATURES)[number];

export interface RenderPlan {
  target: RenderTargetKind;
  stages: PipelineStage[];
  features: RenderFeature[];
  floatIntermediate: boolean;
  previewOnly: boolean;
}

const rgbBaseActive = (settings: RenderSettings): boolean => {
  const mixer = settings.colorMixer;
  const base = mixer?.rgbBase;
  if (!mixer || mixer.enabled === false || !base || base.enabled === false) return false;
  if (base.shadowsTint !== 0) return true;
  return (['red', 'green', 'blue'] as const).some(
    (primary) => base.primaries[primary].hue !== 0 || base.primaries[primary].saturation !== 0,
  );
};

const spectrumActive = (settings: RenderSettings): boolean => {
  const mixer = settings.colorMixer;
  if (!mixer || mixer.enabled === false) return false;
  return (Object.keys(mixer.bands) as (keyof typeof mixer.bands)[]).some((color) =>
    (['hue', 'saturation', 'luminance'] as const).some((axis) => mixer.bands[color][axis] !== 0),
  );
};

const pointsActive = (settings: RenderSettings): boolean => {
  const mixer = settings.colorMixer;
  if (!mixer || mixer.enabled === false) return false;
  return mixer.points.some(
    (point) =>
      point.enabled &&
      (point.shift.hue !== 0 || point.shift.saturation !== 0 || point.shift.luminance !== 0),
  );
};

/**
 * Resolves which shared stages a render must execute. Preview and export must
 * produce the same plan for the same RenderSettings; only preview-only request
 * flags (compare/split/mask/draft/reference) may differ.
 */
export function resolveRenderPlan(settings: RenderSettings, target: RenderTargetKind): RenderPlan {
  const active = new Set<RenderFeature>();
  if (settings.geometry && !geometryIsIdentity(settings.geometry)) active.add('geometry');
  if (settings.filmId && settings.filmId !== 'identity') active.add('film');
  if (settings.curves && CURVE_CHANNELS.some((channel) => !isIdentityCurve(settings.curves![channel]))) {
    active.add('curves');
  }
  if (rgbBaseActive(settings)) active.add('colorMixer.rgbBase');
  if (spectrumActive(settings)) active.add('colorMixer.spectrum');
  if (pointsActive(settings)) active.add('colorMixer.points');
  const sharpeningActive = (settings.sharpening?.amount ?? 0) > 0 || (settings.adjustments.sharpness ?? 0) > 0;
  if (sharpeningActive) active.add('sharpening');
  if (settings.camera?.dateStamp.enabled) active.add('camera.date');
  const optics = settings.camera?.optics;
  if (optics && (optics.glow > 0 || optics.halation > 0 || optics.softness > 0)) active.add('camera.optics');

  const stages = new Set<PipelineStage>(['source', 'tone', 'output']);
  if (active.has('geometry')) stages.add('geometry');
  if (active.has('film') || active.has('curves')) stages.add('look');
  if (active.has('colorMixer.rgbBase') || active.has('colorMixer.spectrum') || active.has('colorMixer.points')) {
    stages.add('colorLab');
  }
  if (active.has('sharpening')) stages.add('detail');
  if (active.has('camera.date') || active.has('camera.optics')) stages.add('composite');

  return {
    target,
    stages: [...stages].sort((a, b) => PIPELINE_STAGES.indexOf(a) - PIPELINE_STAGES.indexOf(b)),
    features: RENDER_FEATURES.filter((feature) => active.has(feature)),
    floatIntermediate: sharpeningActive,
    previewOnly: target === 'preview',
  };
}

/** Stable identity of a render plan, excluding the target and preview-only flags. */
export function renderPlanFingerprint(plan: RenderPlan): string {
  return `${plan.stages.join('>')}|${plan.features.join(',')}|${plan.floatIntermediate ? 1 : 0}`;
}
