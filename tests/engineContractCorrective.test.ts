import { describe, it, expect } from 'vitest';
import {
  AI_OUTPUT_KINDS,
  MAX_LOCAL_GROUPS,
  MAX_MASKS,
  MAX_STROKE_POINTS,
  MAX_STROKES,
  RECIPE_SCHEMA_MAX,
  RENDER_FEATURES,
  acquireAll,
  assertDecodedSource,
  assertRecipePersistable,
  assertRecipeVersionSupported,
  createCoreRenderRegistry,
  createEditState,
  createModuleRegistry,
  createOpticalTransform,
  createPerspectiveQuad,
  createRenderSession,
  createResourceBroker,
  createResourceBudget,
  createResourceScope,
  decideResourceAllocation,
  detectDeviceCapabilities,
  detectRecipeSchemaVersion,
  estimateFrameBytes,
  geometryIsIdentity,
  geometryToSource,
  IDENTITY_GEOMETRY,
  sourceToGeometry,
  geometryOutputAspect,
  isInvertibleMat3,
  localAdjustmentsActive,
  normalizeLocalAdjustments,
  RECIPE_STORAGE_KEYS,
  RESOURCE_GUIDANCE,
  resolveRecipeStorageKey,
  resolveRenderPlan,
  stageIndex,
  throwIfExportAborted,
  LOCAL_ADJUSTMENT_STAGE,
  validateAIModuleDescriptor,
  validateImageBuffer,
  validateLocalAdjustments,
  validateOpticalTransform,
  GEOMETRY_TRANSFORM_ORDER,
  type DecodedSource,
  type EditModule,
  type GeometryTransform,
  type ImageSourceDescriptor,
  type PipelineStage,
  type ResourceBudget,
  type ResourceDecision,
} from '../src/engine/contracts';
import { validateRecipeJSON } from '../src/stores/recipeStore';
import { DEFAULT_ADJUSTMENTS } from '../src/types/film';

const identity = { ...DEFAULT_ADJUSTMENTS };

const moduleOf = (id: string, stage: PipelineStage, requires?: string[]): EditModule => ({
  id,
  stage,
  contractVersion: 1,
  requires,
});

describe('CORE-01 registry ordering and immutability', () => {
  it('orders by pipeline stage when modules are registered in reverse order', () => {
    const registry = createModuleRegistry();
    registry.register(moduleOf('core.detail', 'detail'));
    registry.register(moduleOf('core.look', 'look'));
    registry.register(moduleOf('core.source', 'source'));
    registry.register(moduleOf('core.tone', 'tone', ['core.source']));
    expect(registry.resolveOrder()).toEqual(['core.source', 'core.tone', 'core.look', 'core.detail']);
  });

  it('copies and freezes module metadata so external mutation cannot pollute the registry', () => {
    const requires = ['core.source'];
    const source = moduleOf('core.source', 'source');
    const look = { ...moduleOf('core.look', 'look', requires) };
    const registry = createModuleRegistry();
    registry.register(source);
    registry.register(look);

    requires.push('missing.module');
    (look as { stage: PipelineStage }).stage = 'output';
    (source as { stage: PipelineStage }).stage = 'detail';

    const stored = registry.get('core.look')!;
    expect(stored.stage).toBe('look');
    expect(stored.requires).toEqual(['core.source']);
    expect(Object.isFrozen(stored)).toBe(true);
    try {
      (stored as { stage: PipelineStage }).stage = 'output';
    } catch {
      // Strict-mode assignment to a frozen object is expected to fail.
    }
    expect(stored.stage).toBe('look');

    const listed = registry.list();
    (listed[0].requires as string[]).push('missing.module');
    expect(registry.get('core.source')?.stage).toBe('source');
    expect(registry.get('core.look')?.requires).toEqual(['core.source']);
    expect(registry.resolveOrder()).toEqual(['core.source', 'core.look']);
  });
});

describe('CORE-02 registry-driven render plan activation', () => {
  it('activates a newly registered module without editing core render plan code', () => {
    const registry = createCoreRenderRegistry();
    registry.register({
      ...moduleOf('q99.test.local', 'local', ['core.tone']),
      isActive: (settings) => settings.adjustments.saturation === 7,
      resourceUsage: () => ({ floatIntermediate: true }),
      execute: () => undefined,
    });

    expect(typeof registry.get('q99.test.local')?.execute).toBe('function');

    const inactive = resolveRenderPlan({ adjustments: { ...identity } }, 'export', registry);
    const active = resolveRenderPlan(
      { adjustments: { ...identity, saturation: 7 } },
      'export',
      registry,
    );

    expect(inactive.features).not.toContain('q99.test.local');
    expect(active.features).toContain('q99.test.local');
    expect(active.activeModules).toContain('q99.test.local');
    expect(active.stages).toContain(LOCAL_ADJUSTMENT_STAGE);
    expect(active.floatIntermediate).toBe(true);
    expect(inactive.floatIntermediate).toBe(false);
  });

  it('keeps built-in feature IDs and activation parity for preview and export', () => {
    const registry = createCoreRenderRegistry();
    const plan = resolveRenderPlan({ filmId: 'FS-010', adjustments: { ...identity } }, 'preview', registry);
    expect(plan.features).toEqual(['film']);
    expect(plan.previewOnly).toBe(true);
    expect(plan.stages).toEqual(['source', 'tone', 'look', 'output']);
    expect(RENDER_FEATURES).toContain('geometry');
    expect(resolveRenderPlan({ filmId: 'FS-010', adjustments: { ...identity } }, 'export', registry).features).toEqual(
      plan.features,
    );
  });

  it('rejects active modules whose registered feature dependency is inactive', () => {
    const registry = createCoreRenderRegistry();
    registry.register({
      ...moduleOf('q99.needs.film', 'local', ['film']),
      isActive: () => true,
    });
    expect(() => resolveRenderPlan({ adjustments: { ...identity } }, 'export', registry)).toThrow(/inactive module/);
  });
});

describe('CORE-03 image buffer integrity', () => {
  const source: ImageSourceDescriptor = {
    id: 'source-a',
    name: 'capture.dng',
    mimeType: 'image/x-adobe-dng',
    width: 2,
    height: 2,
    precision: 'hdr-linear16',
    hasAlpha: false,
    decoderId: 'q03.raw',
  };
  const working = {
    id: 'working-a',
    sourceId: 'source-a',
    width: 2,
    height: 2,
    format: 'rgba16f' as const,
    colorSpace: 'linear-srgb' as const,
    memoryBytes: 32,
    storage: 'cpu' as const,
    data: new Uint16Array(16),
  };

  it('accepts a consistent float working buffer and validates GPU ownership', () => {
    expect(() => validateImageBuffer(working, source)).not.toThrow();
    expect(() =>
      validateImageBuffer(
        {
          ...working,
          storage: 'gpu',
          texture: {} as WebGLTexture,
          resourceOwner: 'renderer',
          disposable: true,
        },
        source,
      ),
    ).not.toThrow();
    expect(() => assertDecodedSource({ source, working, warnings: [] })).not.toThrow();
  });

  it('rejects format, length, memory, source identity and non-finite pixels', () => {
    expect(() =>
      validateImageBuffer({ ...working, data: new Float32Array(16) }, source),
    ).toThrow(/data type/);
    expect(() => validateImageBuffer({ ...working, memoryBytes: 31 }, source)).toThrow(/memoryBytes/);
    expect(() => validateImageBuffer({ ...working, data: new Uint16Array(15) }, source)).toThrow(/data length/);
    expect(() => validateImageBuffer({ ...working, sourceId: 'other' }, source)).toThrow(/sourceId/);
    expect(() =>
      validateImageBuffer({ ...working, format: 'rgba32f', memoryBytes: 64, data: new Float32Array(16) }, source),
    ).not.toThrow();
    const abnormal = new Float32Array(16);
    abnormal[3] = Number.NaN;
    expect(() =>
      validateImageBuffer({ ...working, format: 'rgba32f', memoryBytes: 64, data: abnormal }, source),
    ).toThrow(/non-finite/);
  });

  it('rejects GPU buffers without an explicit owner or disposal contract', () => {
    const gpu = {
      ...working,
      storage: 'gpu',
      texture: {} as WebGLTexture,
      resourceOwner: 'renderer',
      disposable: true,
    };
    expect(() => validateImageBuffer({ ...gpu, resourceOwner: '' }, source)).toThrow(/resourceOwner/);
    expect(() => validateImageBuffer({ ...gpu, disposable: undefined }, source)).toThrow(/disposable/);
  });

  it('never allows an implicit 8-bit working buffer for high-precision sources', () => {
    expect(() =>
      assertDecodedSource({
        source,
        working: { ...working, format: 'rgba8', memoryBytes: 16, data: new Uint8Array(16) },
        warnings: [],
      } as DecodedSource),
    ).toThrow(/16-bit or 32-bit float/);
    expect(() => assertDecodedSource({ source, working: { ...working, colorSpace: 'srgb' }, warnings: [] })).toThrow(
      /linear-srgb/,
    );
  });

  it('pins the RGBA float boundary for SDR sources and rejects 3-channel formats', () => {
    const sdr = { ...source, precision: 'sdr-srgb8' as const };
    expect(() =>
      assertDecodedSource({
        source: sdr,
        working: { ...working, format: 'rgba8', memoryBytes: 16, data: new Uint8Array(16) },
        warnings: [],
      } as DecodedSource),
    ).toThrow(/16-bit or 32-bit float/);
    expect(() =>
      validateImageBuffer({ ...working, format: 'rgb16f' as never }, source),
    ).toThrow(/format/);
  });
});

describe('CORE-04 geometry order and forward/inverse mapping', () => {
  const aspect = 4 / 3;
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    expect(a.x).toBeCloseTo(b.x, 8);
    expect(a.y).toBeCloseTo(b.y, 8);
  };

  it('uses one documented order: flip, rotate, straighten, crop', () => {
    expect(GEOMETRY_TRANSFORM_ORDER).toEqual(['flip', 'rotate', 'straighten', 'crop']);
    expect(geometryIsIdentity(IDENTITY_GEOMETRY)).toBe(true);
    const point = { x: 0.2, y: 0.3 };
    near(sourceToGeometry(point, { ...IDENTITY_GEOMETRY, flipHorizontal: true }, aspect), { x: 0.8, y: 0.3 });
    near(sourceToGeometry({ x: 0, y: 0 }, { ...IDENTITY_GEOMETRY, rotation: 90 }, aspect), { x: 1, y: 0 });
  });

  it('round-trips source and corrected coordinates for compound geometry', () => {
    const geometry: GeometryTransform = {
      rotation: 270,
      straighten: 12,
      flipHorizontal: true,
      flipVertical: true,
      crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
    };
    const point = { x: 0.27, y: 0.61 };
    const output = sourceToGeometry(point, geometry, aspect);
    near(geometryToSource(output, geometry, aspect), point);

    const cropOnly: GeometryTransform = {
      ...IDENTITY_GEOMETRY,
      crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.6 },
    };
    near(geometryToSource({ x: 0, y: 0 }, cropOnly, aspect), { x: 0.25, y: 0.1 });
    near(sourceToGeometry({ x: 0.5, y: 0.4 }, cropOnly, aspect), { x: 0.5, y: 0.5 });
    expect(geometryOutputAspect(cropOnly, aspect)).toBeCloseTo(aspect * (0.5 / 0.6), 8);
  });

  it('keeps the center fixed and scales to cover while straightening', () => {
    const straight: GeometryTransform = { ...IDENTITY_GEOMETRY, straighten: 20 };
    near(sourceToGeometry({ x: 0.5, y: 0.5 }, straight, aspect), { x: 0.5, y: 0.5 });
    expect(geometryOutputAspect({ ...IDENTITY_GEOMETRY, rotation: 90 }, aspect)).toBeCloseTo(1 / aspect, 8);
    const edge = sourceToGeometry({ x: 0, y: 0.5 }, straight, aspect);
    expect(edge.x).toBeLessThan(0);
  });
});

describe('CORE-05 optical transform contract', () => {
  it('accepts an identity optical transform and a balanced perspective quad', () => {
    const identityOptical = createOpticalTransform();
    expect(() => validateOpticalTransform(identityOptical)).not.toThrow();
    expect(isInvertibleMat3(identityOptical.homography)).toBe(true);
    const quad = createPerspectiveQuad(0.5, -0.5, 0.15);
    expect(() =>
      validateOpticalTransform({ ...identityOptical, perspective: quad }),
    ).not.toThrow();
  });

  it('rejects singular homographies, abnormal distortion and non-convex perspective quads', () => {
    const base = createOpticalTransform();
    expect(() =>
      validateOpticalTransform({ ...base, homography: [1, 0, 0, 0, 1, 0, 0, 0, 0] }),
    ).toThrow(/singular/);
    expect(() =>
      validateOpticalTransform({ ...base, homography: [1, 0, 0, 0, 1, 0, 0, 0, Number.NaN] }),
    ).toThrow(/homography|finite/);
    expect(() => validateOpticalTransform({ ...base, distortion: { k1: 2 } })).toThrow(/distortion/);
    expect(() =>
      validateOpticalTransform({
        ...base,
        perspective: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.2, y: 0.2 },
          { x: 0, y: 1 },
        ],
      }),
    ).toThrow(/perspective/);
  });

  it('rejects Q02-internal shapes so only the Q01 OpticalTransform crosses the boundary', () => {
    const identityOptical = createOpticalTransform();
    expect(() =>
      validateOpticalTransform({ version: 1, matrix: [...identityOptical.homography] } as never),
    ).toThrow(/homography/);
    expect(() =>
      validateOpticalTransform({ version: 2, homography: [...identityOptical.homography] } as never),
    ).toThrow(/Invalid optical transform/);
  });

  it('mirrors the Q02 invertibility gate for radial and tangential coefficients', () => {
    const base = createOpticalTransform();
    const withCoefficients = (distortion: Record<string, number>) => ({ ...base, distortion });

    expect(() => validateOpticalTransform(withCoefficients({ k1: -0.5 }))).toThrow(/not invertible/);
    expect(() => validateOpticalTransform(withCoefficients({ k1: -0.16 }))).toThrow(/not invertible/);
    expect(() => validateOpticalTransform(withCoefficients({ k1: -0.1 }))).not.toThrow();
    expect(() => validateOpticalTransform(withCoefficients({ k1: 1.5 }))).not.toThrow();
    expect(() => validateOpticalTransform(withCoefficients({ k1: -0.2, k2: 0.1 }))).not.toThrow();
    expect(() => validateOpticalTransform(withCoefficients({ k1: -0.5, k2: 0.02, k3: 0.01 }))).toThrow(
      /not invertible/,
    );
    expect(() => validateOpticalTransform(withCoefficients({ k1: 0.5, p1: 0.2 }))).not.toThrow();
    expect(() => validateOpticalTransform(withCoefficients({ k1: 1.5, p1: 0.5 }))).not.toThrow();
    expect(() => validateOpticalTransform(withCoefficients({ k1: 0.5, p1: 0.5 }))).toThrow(/not invertible/);
  });
});

describe('CORE-06 local adjustment contract', () => {
  const mask = {
    id: 'mask-face',
    name: 'Face',
    enabled: true,
    blend: 'add' as const,
    opacity: 1,
    inverted: false,
    kind: 'radial' as const,
    center: { x: 0.5, y: 0.5 },
    radiusX: 0.3,
    radiusY: 0.2,
    rotation: 0,
    feather: 0.5,
  };
  const group = {
    id: 'group-face',
    name: 'Face light',
    enabled: true,
    masks: [mask],
    adjustment: { exposure: 0.5, saturation: 20 },
    opacity: 1,
    blend: 'add' as const,
  };

  it('normalizes mask groups, clamps adjustments and removes duplicates', () => {
    const normalized = normalizeLocalAdjustments({
      enabled: true,
      groups: [
        {
          ...group,
          opacity: 2,
          adjustment: { exposure: 5, saturation: 20, filmStrength: 30 },
        },
        { ...group, masks: [{ ...mask, id: 'mask-copy' }] },
        { ...group, id: 'group-second', adjustment: { saturation: 200 } },
      ],
    });
    expect(normalized.groups).toHaveLength(2);
    expect(normalized.groups[0].opacity).toBe(1);
    expect(normalized.groups[0].adjustment.exposure).toBe(3);
    expect('filmStrength' in normalized.groups[0].adjustment).toBe(false);
    expect(normalized.groups[1].adjustment.saturation).toBe(100);
    expect(() => validateLocalAdjustments(normalized)).not.toThrow();
    expect(localAdjustmentsActive(normalized)).toBe(true);
    expect(localAdjustmentsActive({ enabled: false, groups: normalized.groups })).toBe(false);
    expect(LOCAL_ADJUSTMENT_STAGE).toBe('local');
    expect(stageIndex('colorLab')).toBeLessThan(stageIndex(LOCAL_ADJUSTMENT_STAGE));
    expect(stageIndex(LOCAL_ADJUSTMENT_STAGE)).toBeLessThan(stageIndex('detail'));
  });

  it('rejects malformed groups, disallowed parameters and duplicate mask identities across groups', () => {
    expect(() => validateLocalAdjustments({ enabled: true, groups: [{ ...group, adjustment: { exposure: 5 } }] })).toThrow(
      /adjustment/,
    );
    expect(() =>
      validateLocalAdjustments({ enabled: true, groups: [{ ...group, adjustment: { filmStrength: 20 } }] }),
    ).toThrow(/adjustment/);
    expect(() => validateLocalAdjustments({ enabled: true, groups: [{ ...group, blend: 'bad' }] })).toThrow(/blend/);
    expect(() =>
      validateLocalAdjustments({
        enabled: true,
        groups: [group, { ...group, id: 'group-two' }],
      }),
    ).toThrow(/mask identity/);
    expect(() =>
      validateLocalAdjustments({
        enabled: true,
        groups: Array.from({ length: MAX_LOCAL_GROUPS + 1 }, (_, i) => ({
          ...group,
          id: `group-${i}`,
          masks: [{ ...mask, id: `mask-${i}` }],
        })),
      }),
    ).toThrow(/group count/);
  });

  it('keeps the Q01 mask limits as the provisional single source of truth', () => {
    expect([MAX_MASKS, MAX_STROKES, MAX_STROKE_POINTS, MAX_LOCAL_GROUPS]).toEqual([16, 64, 1024, 8]);
  });
});

describe('CORE-07 resource budget and allocation', () => {
  const small: ResourceBudget = createResourceBudget({
    maxCpuBytes: 64 * 1024 * 1024,
    maxGpuBytes: 32 * 1024 * 1024,
    maxTextureSize: 2048,
    maxPreviewEdge: 1024,
    maxConcurrency: 2,
    floatRenderTarget: true,
  });

  it('estimates frame bytes and selects full, proxy and tile strategies', () => {
    expect(estimateFrameBytes(100, 100, 'rgba16f')).toBe(80_000);
    const full = decideResourceAllocation(
      { width: 1600, height: 1200, format: 'rgba8', floatIntermediate: false, mode: 'export' },
      small,
    );
    expect(full.allowed).toBe(true);
    expect(full.quality).toBe('full');
    const proxy = decideResourceAllocation(
      { width: 8000, height: 6000, format: 'rgba8', floatIntermediate: false, mode: 'preview' },
      small,
    );
    expect(proxy.allowed).toBe(true);
    expect(proxy.quality).toBe('proxy');
    expect(Math.max(proxy.width, proxy.height)).toBeLessThanOrEqual(1024);
    const tiled = decideResourceAllocation(
      { width: 4000, height: 3000, format: 'rgba8', floatIntermediate: false, mode: 'export' },
      small,
    );
    expect(tiled.allowed).toBe(true);
    expect(tiled.quality).toBe('tile');
    expect(tiled.tile!.width).toBeLessThanOrEqual(2048);
    expect(tiled.tile!.height).toBeLessThanOrEqual(2048);
  });

  it('rejects unimplemented float targets and invalid requests with user guidance', () => {
    const noFloat = createResourceBudget({ ...small, floatRenderTarget: false });
    const rejected: ResourceDecision = decideResourceAllocation(
      { width: 1200, height: 800, format: 'rgba16f', floatIntermediate: true, mode: 'export' },
      noFloat,
    );
    expect(rejected.allowed).toBe(false);
    expect(rejected.reason).toBe('float-render-target-unsupported');
    expect(rejected.message).toBe(RESOURCE_GUIDANCE['float-render-target-unsupported']);
    expect(
      decideResourceAllocation(
        { width: 0, height: 800, format: 'rgba8', floatIntermediate: false, mode: 'export' },
        small,
      ).allowed,
    ).toBe(false);
  });

  it('enforces concurrency and memory budgets in the shared broker', () => {
    const broker = createResourceBroker({ ...small, maxConcurrency: 1 });
    const request = { width: 1600, height: 1200, format: 'rgba8' as const, floatIntermediate: false, mode: 'export' as const };
    const first = broker.request(request);
    expect(first.allowed).toBe(true);
    const second = broker.request(request);
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.decision.reason).toBe('concurrency-limit');
    if (first.allowed) {
      first.grant.release();
      first.grant.release();
    }
    expect(broker.activeCount).toBe(0);
    expect(broker.request(request).allowed).toBe(true);

    const memory = createResourceBroker({ ...small, maxGpuBytes: 20 * 1024 * 1024, maxConcurrency: 2 });
    const largeRequest = {
      width: 2000,
      height: 2000,
      format: 'rgba8' as const,
      floatIntermediate: false,
      mode: 'export' as const,
    };
    expect(memory.request(largeRequest).allowed).toBe(true);
    const over = memory.request(largeRequest);
    expect(over.allowed).toBe(false);
    if (!over.allowed) expect(over.decision.reason).toBe('budget-exceeded');
  });

  it('derives conservative mobile capabilities', () => {
    const capabilities = detectDeviceCapabilities({
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      mobile: true,
      maxTextureSize: 4096,
      floatRenderTarget: true,
    });
    const budget = createResourceBudget({
      maxConcurrency: capabilities.mobile ? 2 : 3,
      maxPreviewEdge: capabilities.mobile ? 1536 : 2048,
    });
    expect(budget.maxConcurrency).toBe(2);
    expect(budget.maxPreviewEdge).toBe(1536);
  });
});

describe('CORE-08 resource lifecycle', () => {
  it('releases already-acquired resources when a later allocation fails', () => {
    const disposed: string[] = [];
    const scope = createResourceScope();
    const resource = (id: string) => ({ id, kind: 'texture' as const, bytes: 1, dispose: () => disposed.push(id) });
    expect(() =>
      acquireAll(scope, [
        () => resource('first'),
        () => resource('second'),
        () => {
          throw new Error('allocation failed');
        },
      ]),
    ).toThrow('allocation failed');
    expect(disposed).toEqual(['second', 'first']);
    expect(scope.resources).toHaveLength(0);
  });

  it('ends a render session idempotently and abandons resources after GPU context loss', () => {
    const disposed: string[] = [];
    let leases = 0;
    const resource = (id: string) => ({ id, kind: 'texture' as const, bytes: 1, dispose: () => disposed.push(id) });
    const session = createRenderSession({ release: () => leases++ });
    session.scope.acquire(() => resource('render-target'));
    session.cancel();
    session.cancel();
    expect(disposed).toEqual(['render-target']);
    expect(leases).toBe(1);

    const lost = createResourceScope();
    lost.acquire(() => resource('context-owned'));
    lost.abandon();
    expect(disposed).toEqual(['render-target']);
    expect(lost.resources).toHaveLength(0);
    expect(lost.disposed).toBe(true);
    expect(() => lost.acquire(() => resource('late'))).toThrow(/Resource scope disposed/);
  });
});

describe('CORE-09 recipe version identification and storage policy', () => {
  it('separates version detection from full recipe validation', () => {
    expect(RECIPE_SCHEMA_MAX).toBe(10);
    expect(detectRecipeSchemaVersion({ schemaVersion: 8 })).toBe(8);
    expect(detectRecipeSchemaVersion({})).toBeNull();
    expect(detectRecipeSchemaVersion({ schemaVersion: '8' })).toBeNull();
    expect(assertRecipeVersionSupported(undefined)).toBe(RECIPE_SCHEMA_MAX);
    expect(() => assertRecipeVersionSupported(11)).toThrow('Unsupported recipe version');
    expect(() => assertRecipeVersionSupported(0)).toThrow('Unsupported recipe version');
  });

  it('keeps Beta and Stable storage keys isolated', () => {
    expect(RECIPE_STORAGE_KEYS.stable).toBe('hd2lab_film_studio_recipes_v1');
    expect(RECIPE_STORAGE_KEYS.beta).toBe('hd2lab_film_studio_beta_recipes_v1');
    expect(resolveRecipeStorageKey('/AGPilot0007/')).toBe(RECIPE_STORAGE_KEYS.stable);
    expect(resolveRecipeStorageKey('/AGPilot0007/beta/')).toBe(RECIPE_STORAGE_KEYS.beta);
  });

  it('accepts v1-v7 imports, upgrades them to v8, and refuses malformed or future versions', () => {
    const raw = {
      id: 'recipe-v7',
      name: 'Versioned',
      baseFilmId: 'FS-001',
      profileVersion: '1.0.0',
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      createdAt: 1,
      updatedAt: 1,
      schemaVersion: 7,
    };
    for (let version = 1; version <= 7; version++) {
      const parsed = validateRecipeJSON(JSON.stringify({ ...raw, schemaVersion: version }));
      expect(parsed.schemaVersion).toBe(8);
      expect(geometryIsIdentity(parsed.geometry!)).toBe(true);
    }
    const framed = { ...raw, schemaVersion: 8, geometry: { rotation: 90, straighten: 0, flipHorizontal: false, flipVertical: false, crop: null } };
    expect(validateRecipeJSON(JSON.stringify(framed)).geometry).toEqual(framed.geometry);
    expect(() => validateRecipeJSON(JSON.stringify({ ...raw, schemaVersion: 8 }))).toThrow(/geometry wrapper/);
    expect(() => validateRecipeJSON(JSON.stringify({ ...raw, schemaVersion: 8, geometry: { rotation: 90, unknown: 1 } }))).toThrow(/Unknown recipe geometry field/);
    expect(() => validateRecipeJSON(JSON.stringify({ ...raw, schemaVersion: 11 }))).toThrow(
      'Unsupported recipe version',
    );
    expect(() =>
      assertRecipePersistable({ ...framed, schemaVersion: 11 }, RECIPE_STORAGE_KEYS.stable),
    ).toThrow('Unsupported recipe version');
    expect(() => assertRecipePersistable(framed, RECIPE_STORAGE_KEYS.stable)).not.toThrow();
  });
});

describe('CORE-10 AI result extension contract', () => {
  it('accepts mask, depth map, embedding and recommendation outputs while staying disabled', () => {
    expect(AI_OUTPUT_KINDS).toEqual(['image-buffer', 'mask', 'depth-map', 'embedding', 'recommendation']);
    expect(() =>
      validateAIModuleDescriptor({
        id: 'ai.analyze',
        version: '2.0.0',
        capability: 'subject-mask',
        requiresGpu: false,
        input: 'image-buffer',
        output: ['mask', 'depth-map', 'embedding', 'recommendation'],
      }),
    ).not.toThrow();
    expect(() =>
      validateAIModuleDescriptor({
        id: 'ai.analyze',
        version: '2.0.0',
        capability: 'subject-mask',
        requiresGpu: false,
        input: 'image-buffer',
        output: ['depth-map', 'depth-map'],
      }),
    ).toThrow(/output/);
    expect(() =>
      validateAIModuleDescriptor({
        id: 'ai.analyze',
        version: '2.0.0',
        capability: 'subject-mask',
        requiresGpu: false,
        input: 'image-buffer',
        output: ['chat'],
      }),
    ).toThrow(/output/);
  });
});

describe('SC-01 shared contract arbitration', () => {
  it('keeps geometry inside EditState and normalizes invalid values', () => {
    const identityState = createEditState();
    expect(identityState.geometry).toEqual(IDENTITY_GEOMETRY);

    const normalized = createEditState({
      geometry: {
        ...IDENTITY_GEOMETRY,
        rotation: 45 as GeometryTransform['rotation'],
        straighten: 90,
      },
    });
    expect(normalized.geometry.rotation).toBe(0);
    expect(normalized.geometry.straighten).toBe(45);
  });

  it('exposes an AbortError-based export cancellation contract', () => {
    const controller = new AbortController();
    expect(() => throwIfExportAborted(controller.signal)).not.toThrow();
    expect(() => throwIfExportAborted(undefined)).not.toThrow();

    controller.abort();
    let caught: unknown;
    try {
      throwIfExportAborted(controller.signal);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe('AbortError');
  });
});
