import { describe, it, expect } from 'vitest';
import {
  CORE_AI_MODULES,
  IDENTITY_GEOMETRY,
  RECIPE_SCHEMA_V8,
  PREVIEW_ONLY_REQUEST_FLAGS,
  assertDecodedSource,
  createEditState,
  createModuleRegistry,
  createResourceScope,
  geometryIsIdentity,
  isAIModuleAvailable,
  normalizeGeometry,
  normalizeMasks,
  renderPlanFingerprint,
  resolveRenderPlan,
  toRecipeV8,
  validateAIModuleDescriptor,
  validateGeometry,
  validateMasks,
  validateRecipeV8Geometry,
} from '../src/engine/contracts';
import { DEFAULT_ADJUSTMENTS, type CustomRecipe } from '../src/types/film';
import { defaultCurves } from '../src/types/curves';
import { normalizeCamera } from '../src/types/camera';
import { DEFAULT_SHARPENING } from '../src/types/sharpening';
import { defaultColorMixer } from '../src/types/colorMixer';

describe('module registry and pipeline order', () => {
  it('resolves dependencies in stage order and filters by stage', () => {
    const registry = createModuleRegistry();
    registry.register({ id: 'core.look', stage: 'look', contractVersion: 1, requires: ['core.tone'] });
    registry.register({ id: 'core.tone', stage: 'tone', contractVersion: 1, requires: ['q03.decode'] });
    registry.register({ id: 'q03.decode', stage: 'source', contractVersion: 1 });
    expect(registry.resolveOrder()).toEqual(['q03.decode', 'core.tone', 'core.look']);
    expect(registry.resolveOrder('look')).toEqual(['core.look']);
    expect(registry.get('core.tone')?.stage).toBe('tone');
  });

  it('rejects duplicates, unknown dependencies, cycles and later-stage dependencies', () => {
    const registry = createModuleRegistry();
    registry.register({ id: 'a', stage: 'tone', contractVersion: 1 });
    expect(() => registry.register({ id: 'a', stage: 'tone', contractVersion: 1 })).toThrow(/Duplicate module/);
    registry.register({ id: 'b', stage: 'look', contractVersion: 1, requires: ['missing'] });
    expect(() => registry.resolveOrder()).toThrow(/Unknown module dependency/);

    const cyclic = createModuleRegistry();
    cyclic.register({ id: 'x', stage: 'tone', contractVersion: 1, requires: ['y'] });
    cyclic.register({ id: 'y', stage: 'tone', contractVersion: 1, requires: ['x'] });
    expect(() => cyclic.resolveOrder()).toThrow(/Circular module dependency/);

    const later = createModuleRegistry();
    later.register({ id: 'late', stage: 'detail', contractVersion: 1 });
    expect(() => later.register({ id: 'early', stage: 'tone', contractVersion: 1, requires: ['late'] })).toThrow(
      /later stage/,
    );
  });
});

describe('geometry contract', () => {
  it('normalizes identity, clamps straighten and keeps crop inside the frame', () => {
    expect(normalizeGeometry()).toEqual(IDENTITY_GEOMETRY);
    expect(geometryIsIdentity(normalizeGeometry())).toBe(true);
    const normalized = normalizeGeometry({
      rotation: 90,
      straighten: 80,
      crop: { x: 0.9, y: 0.9, width: 0.5, height: 0.5 },
    });
    expect(normalized.rotation).toBe(90);
    expect(normalized.straighten).toBe(45);
    expect(normalized.crop!.x).toBeCloseTo(0.9);
    expect(normalized.crop!.width).toBeCloseTo(0.1);
    expect(normalizeGeometry({ crop: { x: 0, y: 0, width: 1, height: 1 } }).crop).toBeNull();
    expect(normalizeGeometry({ rotation: 45 as never }).rotation).toBe(0);
  });

  it('rejects invalid geometry for recipe import', () => {
    expect(() => validateGeometry({ rotation: 45, straighten: 0, flipHorizontal: false, flipVertical: false, crop: null })).toThrow(
      /Invalid geometry/,
    );
    expect(() => validateGeometry({ straighten: 50 })).toThrow(/Invalid geometry/);
    expect(() => validateGeometry({ crop: { x: 0.8, y: 0, width: 0.3, height: 0.5 } })).toThrow(/Invalid geometry/);
    expect(() =>
      validateGeometry({
        rotation: 270,
        straighten: -10,
        flipHorizontal: true,
        flipVertical: false,
        crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
      }),
    ).not.toThrow();
  });
});

describe('mask contract (not persisted yet)', () => {
  const mask = {
    id: 'mask-a',
    name: 'Subject',
    enabled: true,
    blend: 'add' as const,
    opacity: 1,
    inverted: false,
    kind: 'radial' as const,
    center: { x: 0.5, y: 0.5 },
    radiusX: 0.3,
    radiusY: 0.2,
    rotation: 10,
    feather: 0.5,
  };

  it('normalizes known shapes, caps count and removes duplicate ids', () => {
    expect(validateMasks([mask])).toBeUndefined();
    const normalized = normalizeMasks([mask, { ...mask }, { ...mask, id: 'bad', kind: 'unknown' }]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].kind).toBe('radial');
    const many = normalizeMasks(Array.from({ length: 20 }, (_, i) => ({ ...mask, id: `mask-${i}` })));
    expect(many).toHaveLength(16);
    const brush = normalizeMasks([
      { ...mask, kind: 'brush', strokes: [{ points: [{ x: 0.1, y: 0.2 }], radius: 0.1, hardness: 0.5, flow: 1 }] },
    ]);
    expect(brush[0]?.kind).toBe('brush');
    expect(normalizeMasks([{ ...mask, kind: 'brush', strokes: [] }])).toHaveLength(0);
  });

  it('rejects duplicate identities and malformed shapes', () => {
    expect(() => validateMasks([mask, { ...mask }])).toThrow(/Invalid mask identity/);
    expect(() => validateMasks([{ ...mask, kind: 'luminance', lo: 0.8, hi: 0.2 }])).toThrow(/Invalid mask shape/);
    expect(() => validateMasks([{ ...mask, radiusX: 0 }])).toThrow(/Invalid mask shape/);
  });
});

describe('decoded source boundary', () => {
  const source = {
    id: 'source-1',
    name: 'portrait.jpg',
    mimeType: 'image/jpeg',
    width: 2,
    height: 2,
    precision: 'sdr-srgb8',
    hasAlpha: false,
    decoderId: 'q03.sdr',
  };
  const working = {
    id: 'working-1',
    sourceId: 'source-1',
    width: 2,
    height: 2,
    format: 'rgba16f',
    colorSpace: 'linear-srgb',
    memoryBytes: 32,
    storage: 'cpu',
    data: new Uint16Array(16),
  };

  it('accepts a linear float working buffer for SDR and RAW sources', () => {
    expect(() => assertDecodedSource({ source, working, warnings: [] })).not.toThrow();
    expect(() =>
      assertDecodedSource({ source: { ...source, precision: 'hdr-linear16' }, working, warnings: [] }),
    ).not.toThrow();
  });

  it('rejects 8-bit or non-linear working buffers', () => {
    expect(() =>
      assertDecodedSource({ source, working: { ...working, format: 'rgba8', data: new Uint8Array(16) }, warnings: [] }),
    ).toThrow(/16-bit or 32-bit float/);
    expect(() => assertDecodedSource({ source, working: { ...working, colorSpace: 'srgb' }, warnings: [] })).toThrow(
      /linear-srgb/,
    );
  });
});

describe('preview/export render plan parity', () => {
  const neutral = { filmId: 'identity' as const, adjustments: { ...DEFAULT_ADJUSTMENTS } };

  it('keeps preview and export plans identical and excludes preview-only flags', () => {
    const preview = resolveRenderPlan(neutral, 'preview');
    const exported = resolveRenderPlan(neutral, 'export');
    expect(preview.stages).toEqual(['source', 'tone', 'output']);
    expect(preview.features).toEqual([]);
    expect(renderPlanFingerprint(preview)).toBe(renderPlanFingerprint(exported));
    expect(preview.previewOnly).toBe(true);
    expect(exported.previewOnly).toBe(false);
    for (const flag of PREVIEW_ONLY_REQUEST_FLAGS) {
      expect((neutral as Record<string, unknown>)[flag]).toBeUndefined();
    }
  });

  it('activates shared stages for geometry, film, curves, Color Lab, sharpening and camera effects', () => {
    const camera = normalizeCamera();
    const settings = {
      filmId: 'FS-010' as const,
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      geometry: normalizeGeometry({
        rotation: 90,
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      }),
      curves: { ...defaultCurves(), white: [[0, 0], [0.5, 0.2], [1, 1]] as [number, number][] },
      colorMixer: {
        ...defaultColorMixer(),
        bands: {
          ...defaultColorMixer().bands,
          red: { hue: 10, saturation: 0, luminance: 0 },
        },
        rgbBase: {
          ...defaultColorMixer().rgbBase,
          shadowsTint: 10,
        },
      },
      sharpening: { ...DEFAULT_SHARPENING, amount: 40 },
      camera: {
        ...camera,
        dateStamp: { ...camera.dateStamp, enabled: true, date: '2016-03-08' },
        optics: { ...camera.optics, glow: 20 },
      },
    };
    const plan = resolveRenderPlan(settings, 'export');
    expect(plan.features).toEqual([
      'geometry',
      'film',
      'curves',
      'colorMixer.rgbBase',
      'colorMixer.spectrum',
      'sharpening',
      'camera.date',
      'camera.optics',
    ]);
    expect(plan.stages).toEqual(['source', 'geometry', 'tone', 'look', 'colorLab', 'detail', 'composite', 'output']);
    expect(plan.floatIntermediate).toBe(true);
    expect(renderPlanFingerprint(plan)).toBe(renderPlanFingerprint(resolveRenderPlan(settings, 'preview')));
  });
});

describe('recipe v8 contract', () => {
  const v7: CustomRecipe = {
    id: 'recipe-1',
    name: 'Phase 1',
    baseFilmId: 'FS-001',
    profileVersion: '1.0.0',
    adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: 0.4 },
    curves: defaultCurves(),
    camera: normalizeCamera(),
    sharpening: { ...DEFAULT_SHARPENING },
    colorMixer: defaultColorMixer(),
    createdAt: 1,
    updatedAt: 2,
    schemaVersion: 7,
  };

  it('adds neutral geometry while preserving existing v7 fields', () => {
    const v8 = toRecipeV8(v7);
    expect(v8.schemaVersion).toBe(RECIPE_SCHEMA_V8);
    expect(geometryIsIdentity(v8.geometry)).toBe(true);
    expect(v8.adjustments.exposure).toBe(0.4);
    expect(v8.curves).toEqual(v7.curves);
    expect(v8.camera).toEqual(v7.camera);
    expect(validateRecipeV8Geometry(v8)).toBeUndefined();
  });

  it('rejects future versions and invalid imported geometry', () => {
    expect(() => toRecipeV8({ ...v7, schemaVersion: 8 })).toThrow(/Unsupported recipe version/);
    expect(() => toRecipeV8({ ...v7, schemaVersion: 0 })).toThrow(/Unsupported recipe version/);
    expect(() => validateRecipeV8Geometry({ geometry: { rotation: 45 } })).toThrow(/Invalid geometry/);
    expect(() =>
      validateRecipeV8Geometry({
        geometry: {
          rotation: 180,
          straighten: 5,
          flipHorizontal: false,
          flipVertical: true,
          crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
        },
      }),
    ).not.toThrow();
  });
});

describe('edit state and resource lifecycle', () => {
  it('creates a normalized edit state with neutral geometry and legacy sharpening', () => {
    const state = createEditState({}, 35);
    expect(state.activeFilmId).toBe('FS-001');
    expect(state.activePresetId).toBeNull();
    expect(geometryIsIdentity(state.geometry)).toBe(true);
    expect(state.sharpening.mode).toBe('legacy');
    expect(state.sharpening.amount).toBe(35);
    const rotated = createEditState({ activeFilmId: 'FS-010', geometry: { ...IDENTITY_GEOMETRY, rotation: 90 } });
    expect(rotated.activeFilmId).toBe('FS-010');
    expect(rotated.geometry.rotation).toBe(90);
  });

  it('disposes resources in reverse order and refuses use after disposal', () => {
    const disposed: string[] = [];
    const scope = createResourceScope();
    const resource = (id: string) => ({ id, kind: 'texture' as const, bytes: 1, dispose: () => disposed.push(id) });
    const first = scope.acquire(() => resource('first'));
    scope.acquire(() => resource('second'));
    scope.release(first);
    scope.acquire(() => resource('third'));
    expect(disposed).toEqual(['first']);
    scope.disposeAll();
    expect(disposed).toEqual(['first', 'third', 'second']);
    expect(scope.resources).toHaveLength(0);
    expect(() => scope.acquire(() => resource('late'))).toThrow(/Resource scope disposed/);
  });
});

describe('AI extension contract', () => {
  it('stays empty in Phase 1 and validates descriptors without enabling AI', () => {
    expect(CORE_AI_MODULES).toHaveLength(0);
    expect(isAIModuleAvailable()).toBe(false);
    expect(() =>
      validateAIModuleDescriptor({
        id: 'ai.enhance',
        version: '1.0.0',
        capability: 'enhance',
        requiresGpu: true,
        input: 'image-buffer',
        output: 'image-buffer',
      }),
    ).not.toThrow();
    expect(() =>
      validateAIModuleDescriptor({
        id: 'ai.bad',
        version: '1.0.0',
        capability: 'chat',
        requiresGpu: true,
        input: 'image-buffer',
        output: 'image-buffer',
      }),
    ).toThrow(/Invalid AI module capability/);
  });
});
