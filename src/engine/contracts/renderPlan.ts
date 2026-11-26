import type { RenderSettings } from '../pipeline/renderSettings';
import { CURVE_CHANNELS, isIdentityCurve } from '../../types/curves';
import { geometryIsIdentity } from './geometry';
import {
  createModuleRegistry,
  type EditModuleRegistry,
  type ModuleResourceUsage,
} from './moduleRegistry';
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
  modules: string[];
  activeModules: string[];
  features: string[];
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

const floatUsage = (settings: RenderSettings): ModuleResourceUsage => ({
  floatIntermediate:
    (settings.sharpening?.amount ?? 0) > 0 || (settings.adjustments.sharpness ?? 0) > 0,
});

/**
 * Built-in render features are registered as modules so adding a feature no
 * longer requires editing resolveRenderPlan. Feature work orders can register
 * additional modules on a copy of this registry.
 */
export function createCoreRenderRegistry(): EditModuleRegistry {
  const registry = createModuleRegistry();
  registry.register({ id: 'core.source', stage: 'source', contractVersion: 1, role: 'stage' });
  registry.register({
    id: 'core.tone',
    stage: 'tone',
    contractVersion: 1,
    role: 'stage',
    requires: ['core.source'],
  });
  registry.register({
    id: 'core.output',
    stage: 'output',
    contractVersion: 1,
    role: 'stage',
    requires: ['core.tone'],
  });

  registry.register({
    id: 'geometry',
    stage: 'geometry',
    contractVersion: 1,
    isActive: (settings) => !!settings.geometry && !geometryIsIdentity(settings.geometry),
  });
  registry.register({
    id: 'film',
    stage: 'look',
    contractVersion: 1,
    isActive: (settings) => !!settings.filmId && settings.filmId !== 'identity',
  });
  registry.register({
    id: 'curves',
    stage: 'look',
    contractVersion: 1,
    isActive: (settings) =>
      !!settings.curves && CURVE_CHANNELS.some((channel) => !isIdentityCurve(settings.curves![channel])),
  });
  registry.register({
    id: 'colorMixer.rgbBase',
    stage: 'colorLab',
    contractVersion: 1,
    isActive: rgbBaseActive,
  });
  registry.register({
    id: 'colorMixer.spectrum',
    stage: 'colorLab',
    contractVersion: 1,
    isActive: spectrumActive,
  });
  registry.register({
    id: 'colorMixer.points',
    stage: 'colorLab',
    contractVersion: 1,
    isActive: pointsActive,
  });
  registry.register({
    id: 'sharpening',
    stage: 'detail',
    contractVersion: 1,
    isActive: (settings) =>
      (settings.sharpening?.amount ?? 0) > 0 || (settings.adjustments.sharpness ?? 0) > 0,
    resourceUsage: floatUsage,
  });
  registry.register({
    id: 'camera.date',
    stage: 'composite',
    contractVersion: 1,
    isActive: (settings) => settings.camera?.dateStamp.enabled === true,
  });
  registry.register({
    id: 'camera.optics',
    stage: 'composite',
    contractVersion: 1,
    isActive: (settings) => {
      const optics = settings.camera?.optics;
      return !!optics && (optics.glow > 0 || optics.halation > 0 || optics.softness > 0);
    },
  });
  return registry;
}

/**
 * Resolves which shared stages a render must execute. Preview and export must
 * produce the same plan for the same RenderSettings; only preview-only request
 * flags (compare/split/mask/draft/reference) may differ.
 */
export function resolveRenderPlan(
  settings: RenderSettings,
  target: RenderTargetKind,
  registry: EditModuleRegistry = createCoreRenderRegistry(),
): RenderPlan {
  const order = registry.resolveOrder();
  const active = new Set<string>();
  for (const id of order) {
    const module = registry.get(id)!;
    const isActive = module.role === 'stage' || module.isActive?.(settings) === true;
    if (isActive) active.add(id);
  }
  for (const id of active) {
    for (const dependency of registry.get(id)!.requires ?? []) {
      if (!active.has(dependency)) {
        throw new Error(`Active module requires inactive module: ${id} -> ${dependency}`);
      }
    }
  }

  const activeModules = order.filter((id) => active.has(id));
  const features = activeModules.filter((id) => (registry.get(id)!.role ?? 'feature') === 'feature');
  const stages = new Set<PipelineStage>(['source', 'tone', 'output']);
  for (const id of features) stages.add(registry.get(id)!.stage);
  let floatIntermediate = false;
  for (const id of features) {
    const usage = registry.get(id)!.resourceUsage?.(settings);
    if (usage?.floatIntermediate) floatIntermediate = true;
  }

  return {
    target,
    stages: [...stages].sort((a, b) => PIPELINE_STAGES.indexOf(a) - PIPELINE_STAGES.indexOf(b)),
    modules: order,
    activeModules,
    features,
    floatIntermediate,
    previewOnly: target === 'preview',
  };
}

/** Stable identity of a render plan, excluding the target and preview-only flags. */
export function renderPlanFingerprint(plan: RenderPlan): string {
  return `${plan.stages.join('>')}|${plan.features.join(',')}|${plan.floatIntermediate ? 1 : 0}`;
}
