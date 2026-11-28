import { describe, expect, it } from 'vitest';
import { buildRenderRequest } from '../src/engine/renderer/webglPipelineBackend';
import {
  LOCAL_STAGE_MASK_TEXTURE_BASE,
  LOCAL_STAGE_MAX_GROUPS,
  hasLocalStagePlan,
} from '../src/engine/pipeline/localStageSeam';
import { DEFAULT_ADJUSTMENTS } from '../src/types/film';
import {
  createCoreRenderRegistry,
  renderPlanFingerprint,
  resolveRenderPlan,
} from '../src/engine/contracts/renderPlan';

const settings = { adjustments: { ...DEFAULT_ADJUSTMENTS } };
const plan = resolveRenderPlan(settings, 'preview', createCoreRenderRegistry());
const frame = {
  target: 'preview' as const,
  width: 8,
  height: 8,
  dpr: 1,
  settings,
  plan,
  fingerprint: renderPlanFingerprint(plan),
  extras: { compareMode: 'none' as const, splitPos: 1 },
};

describe('CP3 local stage seam', () => {
  it('keeps the render request byte-identical when the plan is null or absent', () => {
    const absent = JSON.stringify(buildRenderRequest(frame));
    const nullPlan = JSON.stringify(
      buildRenderRequest({ ...frame, settings: { ...frame.settings, localStage: null } }),
    );
    expect(nullPlan).toBe(absent);
    expect(buildRenderRequest(frame).localStage).toBeUndefined();
  });

  it('treats only a real plan as present', () => {
    expect(hasLocalStagePlan(null)).toBe(false);
    expect(hasLocalStagePlan(undefined)).toBe(false);
    expect(
      hasLocalStagePlan({ width: 1, height: 1, groups: [], masks: [] }),
    ).toBe(true);
  });

  it('binds mask units above the renderer allocations and inside the 16-unit budget', () => {
    expect(LOCAL_STAGE_MASK_TEXTURE_BASE).toBeGreaterThan(4);
    expect(LOCAL_STAGE_MASK_TEXTURE_BASE + LOCAL_STAGE_MAX_GROUPS - 1).toBeLessThan(16);
    expect(LOCAL_STAGE_MAX_GROUPS).toBe(8);
  });
});