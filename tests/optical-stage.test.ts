import { describe, expect, it } from 'vitest';
import {
  createOpticalTransform,
  createPerspectiveQuad,
  validateOpticalTransform,
  type OpticalTransform,
} from '../src/engine/contracts/optical';
import { normalizeGeometry } from '../src/engine/contracts/geometry';
import { renderPlanFingerprint, resolveRenderPlan } from '../src/engine/contracts/renderPlan';
import { DEFAULT_ADJUSTMENTS } from '../src/types/film';
import {
  Q02_GEOMETRY_MODULE_ID,
  Q02_HARNESS_MAX_MASKS,
  Q02_OPTICAL_MODULE_ID,
  assertMaskBudget,
  createGeometryStageModule,
  createOpticalStageModule,
  createQ02RenderRegistry,
  type OpticalRenderSettings,
} from '../src/engine/optical/modules';
import {
  geometryOutputToSource,
  geometrySourceToOutput,
  geometryUniforms,
} from '../src/engine/optical/geometry';
import {
  assertOpticalRenderable,
  normalizeOpticalTransform,
  opticalCorrectedToSource,
  opticalUniforms,
} from '../src/engine/optical/transform';

const geometry = normalizeGeometry({
  rotation: 90,
  straighten: 4,
  flipHorizontal: true,
  crop: { x: 0.1, y: 0.05, width: 0.8, height: 0.75 },
});

const optical = createOpticalTransform({
  homography: [1.01, 0.005, -0.004, -0.002, 0.99, 0.006, 0.0002, -0.0001, 1],
  distortion: { k1: -0.05, k2: 0.01, p1: 0.003, p2: -0.002 },
  perspective: createPerspectiveQuad(0.2, -0.15),
});

const settings = (overrides: Partial<OpticalRenderSettings> = {}): OpticalRenderSettings => ({
  adjustments: DEFAULT_ADJUSTMENTS,
  ...overrides,
});

const radialMask = (index: number) => ({
  id: `mask-${index}`,
  name: `Mask ${index}`,
  enabled: true,
  blend: 'add' as const,
  opacity: 1,
  inverted: false,
  kind: 'radial' as const,
  center: { x: 0.5, y: 0.5 },
  radiusX: 0.25,
  radiusY: 0.25,
  rotation: 0,
  feather: 0.2,
});

const masks = (count: number) => Array.from({ length: count }, (_, index) => radialMask(index));

describe('Q02 geometry and optical stage modules', () => {
  it('registers on a copy of the core registry in optical -> geometry order', () => {
    const registry = createQ02RenderRegistry();
    const plan = resolveRenderPlan(settings({ geometry, optical }), 'preview', registry);
    expect(plan.features).toContain(Q02_OPTICAL_MODULE_ID);
    expect(plan.features).toContain(Q02_GEOMETRY_MODULE_ID);
    expect(plan.stages.indexOf('optical')).toBeLessThan(plan.stages.indexOf('geometry'));
    expect(plan.stages).toContain('source');
    expect(plan.stages).toContain('tone');
    expect(plan.floatIntermediate).toBe(true);
  });

  it('produces the same preview and export plan fingerprint', () => {
    const registry = createQ02RenderRegistry();
    const input = settings({ geometry, optical });
    const preview = resolveRenderPlan(input, 'preview', registry);
    const exported = resolveRenderPlan(input, 'export', registry);
    expect(renderPlanFingerprint(exported)).toBe(renderPlanFingerprint(preview));
  });

  it('leaves both modules inactive at identity', () => {
    const registry = createQ02RenderRegistry();
    const plan = resolveRenderPlan(settings(), 'preview', registry);
    expect(plan.features).not.toContain(Q02_OPTICAL_MODULE_ID);
    expect(plan.features).not.toContain(Q02_GEOMETRY_MODULE_ID);
  });

  it('round-trips output/source geometry at boundaries and interior points', () => {
    const aspect = 4 / 3;
    for (const point of [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 0.31, y: 0.67 },
    ]) {
      const source = geometryOutputToSource(point, geometry, aspect);
      expect(Number.isFinite(source.x)).toBe(true);
      expect(Number.isFinite(source.y)).toBe(true);
      const back = geometrySourceToOutput(source, geometry, aspect);
      expect(back.x).toBeCloseTo(point.x, 12);
      expect(back.y).toBeCloseTo(point.y, 12);
    }
    const uniforms = geometryUniforms(geometry, aspect);
    expect(uniforms.rotation).toBe(90);
    expect(uniforms.straighten).toBe(4);
    expect(uniforms.aspect).toBeCloseTo(1 / aspect, 12);
    expect(uniforms.flip).toEqual([1, 0]);
    expect(uniforms.crop).toEqual([0.1, 0.05, 0.8, 0.75]);
  });

  it('validates optical input and rejects non-invertible coefficients', () => {
    expect(() => validateOpticalTransform(optical)).not.toThrow();
    const source = opticalCorrectedToSource({ x: 0.25, y: 0.75 }, optical);
    expect(Number.isFinite(source.x)).toBe(true);
    expect(Number.isFinite(source.y)).toBe(true);

    const folded = createOpticalTransform({ distortion: { k1: -0.5 } });
    expect(() => assertOpticalRenderable(folded)).toThrow(/not invertible/);
    expect(() =>
      createOpticalStageModule().execute?.({ target: 'preview', settings: settings({ optical: folded }) }),
    ).toThrow(/not invertible/);
    expect(() => normalizeOpticalTransform(folded)).toThrow(/not invertible/);
  });

  it('packs the homography column-major for the shared GPU uniform path', () => {
    const uniforms = opticalUniforms(optical);
    const expected = [1.01, -0.002, 0.0002, 0.005, 0.99, -0.0001, -0.004, 0.006, 1];
    [...uniforms.homography].forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6));
    expect(uniforms.radial).toEqual([-0.05, 0.01, 0, 0]);
    expect(uniforms.tangential).toEqual([0.003, -0.002]);
  });

  it('enforces product 16/64/1024 budgets without truncation', () => {
    expect(() => assertMaskBudget(masks(16))).not.toThrow();
    expect(() => assertMaskBudget(masks(17))).toThrow(/at most 16 masks/);

    const points = Array.from({ length: 1025 }, (_, index) => ({
      x: (index % 32) / 32,
      y: Math.floor(index / 32) / 32,
    }));
    const brush = (pointCount: number) => ({
      ...radialMask(0),
      kind: 'brush' as const,
      strokes: [{ points: points.slice(0, pointCount), radius: 0.1, hardness: 0.5, flow: 1 }],
    });
    expect(() => assertMaskBudget([brush(1024)])).not.toThrow();
    expect(() => assertMaskBudget([brush(1025)])).toThrow(/Invalid mask stroke/);

    const strokes = Array.from({ length: 65 }, () => ({ points: [{ x: 0.5, y: 0.5 }], radius: 0.1, hardness: 0.5, flow: 1 }));
    expect(() =>
      assertMaskBudget([{ ...radialMask(0), kind: 'brush', strokes }]),
    ).toThrow(/Invalid mask shape/);
  });

  it('keeps the harness 8-mask cap separate from the product contract', () => {
    expect(() => assertMaskBudget(masks(Q02_HARNESS_MAX_MASKS), 'harness')).not.toThrow();
    expect(() => assertMaskBudget(masks(Q02_HARNESS_MAX_MASKS + 1), 'harness')).toThrow(/at most 8 masks/);
    expect(() =>
      createOpticalStageModule().execute?.({
        target: 'export',
        settings: settings({ optical, masks: masks(17) }),
      }),
    ).toThrow(/at most 16 masks/);
  });

  it('keeps the optical module active only for a non-identity transform', () => {
    const module = createOpticalStageModule();
    expect(module.isActive?.(settings())).toBe(false);
    expect(module.isActive?.(settings({ optical: createOpticalTransform() }))).toBe(false);
    const adjusted: OpticalTransform = createOpticalTransform({ distortion: { k1: 0.05 } });
    expect(module.isActive?.(settings({ optical: adjusted }))).toBe(true);
    expect(createGeometryStageModule().isActive?.(settings())).toBe(false);
    expect(createGeometryStageModule().isActive?.(settings({ geometry }))).toBe(true);
  });
});
