import { describe, it, expect } from 'vitest';
import {
  RAW_NEUTRAL_DEVELOP,
  composeDevelop,
  isNeutralDevelop,
  normalizeDevelop,
  rawDevelopStateFromInfo,
  validateDevelop,
} from '../src/engine/contracts/develop';
import {
  LENS_BLUR_DEFAULTS,
  isNeutralLensBlur,
  normalizeLensBlur,
  validateLensBlur,
} from '../src/engine/contracts/lensBlur';
import type { LensBlurPlan } from '../src/engine/contracts/lensBlur';
import type {
  VideoCapabilities,
  VideoExportHandle,
  VideoExportResult,
  VideoExportSettings,
} from '../src/engine/contracts/video';
import { RECIPE_SCHEMA_MAX, assertRecipePersistable, RECIPE_STORAGE_KEYS } from '../src/engine/contracts/recipeValidation';
import { IDENTITY_GEOMETRY } from '../src/engine/contracts/geometry';
import { validateRecipeJSON, CURRENT_SCHEMA_VERSION, shouldWriteRecipeV10 } from '../src/stores/recipeStore';
import { DEFAULT_ADJUSTMENTS } from '../src/types/film';
import type { RenderSettings } from '../src/engine/pipeline/renderSettings';

const recipeBase = {
  name: 'CP4 recipe',
  baseFilmId: 'FS-001',
  profileVersion: '1.0.0',
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

describe('CP4 develop contract (BL-CP3-01)', () => {
  it('normalizes invalid develop values toward neutral and clamps ranges', () => {
    expect(normalizeDevelop(undefined)).toEqual(RAW_NEUTRAL_DEVELOP);
    expect(
      normalizeDevelop({
        wb: { mode: 'custom', temperatureK: 15000, tint: 200 },
        exposureEV: 9,
        highlightRecovery: -1,
      }),
    ).toEqual({ wb: { mode: 'custom', temperatureK: 12000, tint: 100 }, exposureEV: 5, highlightRecovery: 0 });
    expect(normalizeDevelop({ wb: { mode: 'custom', temperatureK: 1500, tint: -200 } }).wb).toEqual({
      mode: 'custom',
      temperatureK: 2000,
      tint: -100,
    });
  });

  it('detects the neutral develop', () => {
    expect(isNeutralDevelop(RAW_NEUTRAL_DEVELOP)).toBe(true);
    expect(isNeutralDevelop(normalizeDevelop({ exposureEV: 0.25 }))).toBe(false);
    expect(isNeutralDevelop(normalizeDevelop({ highlightRecovery: 1 }))).toBe(false);
    expect(isNeutralDevelop(normalizeDevelop({ wb: { mode: 'custom', temperatureK: 5600, tint: 0 } }))).toBe(false);
  });

  it('rejects malformed develop payloads at the recipe boundary', () => {
    expect(() => validateDevelop(null)).toThrow(/Invalid develop settings/);
    expect(() => validateDevelop({ ...RAW_NEUTRAL_DEVELOP, extra: 1 })).toThrow(/Unknown develop field/);
    expect(() => validateDevelop({ ...RAW_NEUTRAL_DEVELOP, wb: { mode: 'sunlight' } })).toThrow(/white balance mode/);
    expect(() => validateDevelop({ ...RAW_NEUTRAL_DEVELOP, wb: { mode: 'as-shot', tint: 0 } })).toThrow(/white balance/);
    expect(() =>
      validateDevelop({ ...RAW_NEUTRAL_DEVELOP, wb: { mode: 'custom', temperatureK: 1500, tint: 0 } }),
    ).toThrow(/temperature/);
    expect(() =>
      validateDevelop({ ...RAW_NEUTRAL_DEVELOP, wb: { mode: 'custom', temperatureK: 5600, tint: 101 } }),
    ).toThrow(/tint/);
    expect(() => validateDevelop({ ...RAW_NEUTRAL_DEVELOP, exposureEV: 6 })).toThrow(/exposure/);
    expect(() => validateDevelop({ ...RAW_NEUTRAL_DEVELOP, highlightRecovery: 2 })).toThrow(/highlight recovery/);
  });

  it('leaves user exposure and white balance additive on a baked develop (applied exactly once)', () => {
    const settings: RenderSettings = {
      adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: 0.4, temperature: 18, tint: -6 },
    };
    const dev = normalizeDevelop({
      wb: { mode: 'custom', temperatureK: 5200, tint: 10 },
      exposureEV: 1.2,
      highlightRecovery: 0.5,
    });
    const composed = composeDevelop(settings, dev, { developBaked: true });
    expect(composed).toBe(settings);
    expect(composed.adjustments.exposure).toBe(0.4);
    expect(composed.adjustments.temperature).toBe(18);
    expect(composed.adjustments.tint).toBe(-6);
  });

  it('is a byte-equal no-op for neutral develop and treats a missing developBaked flag as baked', () => {
    const settings: RenderSettings = { adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: -0.7, temperature: 9 } };
    expect(composeDevelop(settings, RAW_NEUTRAL_DEVELOP, { developBaked: true })).toBe(settings);
    expect(JSON.stringify(composeDevelop(settings, normalizeDevelop({ exposureEV: 2 }), {}))).toBe(JSON.stringify(settings));
  });

  it('folds only the EV baseline when the decoder did not bake the develop', () => {
    const settings: RenderSettings = { adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: 0.4, temperature: 12 } };
    const composed = composeDevelop(
      settings,
      normalizeDevelop({ wb: { mode: 'custom', temperatureK: 4800, tint: 5 }, exposureEV: 1.5 }),
      { developBaked: false },
    );
    expect(composed.adjustments.exposure).toBeCloseTo(1.9, 10);
    expect(composed.adjustments.temperature).toBe(12);
    expect(settings.adjustments.exposure).toBe(0.4);
  });

  it('maps the CP3 decoder develop record into the contract state', () => {
    expect(rawDevelopStateFromInfo(null)).toBe(RAW_NEUTRAL_DEVELOP);
    expect(rawDevelopStateFromInfo({ identity: true, settings: { exposureEv: 2 } })).toBe(RAW_NEUTRAL_DEVELOP);
    expect(
      rawDevelopStateFromInfo({
        identity: false,
        settings: { exposureEv: 0.7, temperatureK: 5400, tint: 10, highlightRecovery: 'blend' },
      }),
    ).toEqual({ wb: { mode: 'custom', temperatureK: 5400, tint: 10 }, exposureEV: 0.7, highlightRecovery: 0.5 });
    expect(
      rawDevelopStateFromInfo({ identity: false, settings: { exposureEv: 0, temperatureK: 5400, tint: 0, highlightRecovery: 'reconstruct' } }).highlightRecovery,
    ).toBe(1);
  });
});

describe('CP4 lens blur contract', () => {
  it('normalizes defaults, clamps ranges and rounds blade count', () => {
    expect(normalizeLensBlur({})).toEqual(LENS_BLUR_DEFAULTS);
    const blur = normalizeLensBlur({
      enabled: true,
      focusPlane: -3,
      focusRange: 9,
      aperture: 40,
      bladeCount: 12.4,
      rotationDeg: 540,
      quality: 'turbo' as never,
      highlightBoost: 9,
    });
    expect(blur).toMatchObject({
      enabled: true,
      focusPlane: 0,
      focusRange: 1,
      aperture: 22,
      bladeCount: 9,
      rotationDeg: 180,
      quality: 'preview',
      highlightBoost: 2,
    });
    expect(normalizeLensBlur({ aperture: 0.2, bladeCount: 2 }).aperture).toBe(1);
    expect(normalizeLensBlur({ aperture: 0.2, bladeCount: 2 }).bladeCount).toBe(5);
  });

  it('is neutral when disabled', () => {
    expect(isNeutralLensBlur(normalizeLensBlur({}))).toBe(true);
    expect(isNeutralLensBlur(LENS_BLUR_DEFAULTS)).toBe(true);
    expect(isNeutralLensBlur(normalizeLensBlur({ enabled: true }))).toBe(false);
  });

  it('round-trips a depth mask through the shared mask schema', () => {
    const depthMask = [
      {
        id: 'depth-1',
        name: 'Focus band',
        enabled: true,
        blend: 'add' as const,
        opacity: 1,
        inverted: false,
        kind: 'linear' as const,
        start: { x: 0.5, y: 0 },
        end: { x: 0.5, y: 1 },
        feather: 0.2,
      },
    ];
    const blur = normalizeLensBlur({ enabled: true, depthMask });
    expect(blur.depthMask).toEqual(depthMask);
    expect(normalizeLensBlur({ enabled: true, depthMask: [] }).depthMask).toBeNull();
    expect(normalizeLensBlur({ enabled: true, depthMask: [{ bogus: true }] as never }).depthMask).toBeNull();
  });

  it('rejects malformed lens blur payloads at the recipe boundary', () => {
    const valid = normalizeLensBlur({ enabled: true });
    expect(() => validateLensBlur(null)).toThrow(/Invalid lens blur/);
    expect(() => validateLensBlur({ ...valid, unknown: 1 })).toThrow(/Unknown lens blur field/);
    expect(() => validateLensBlur({ ...valid, aperture: 0 })).toThrow(/aperture/);
    expect(() => validateLensBlur({ ...valid, bladeCount: 6.5 })).toThrow(/blade count/);
    expect(() => validateLensBlur({ ...valid, bladeCount: 4 })).toThrow(/blade count/);
    expect(() => validateLensBlur({ ...valid, quality: 'turbo' })).toThrow(/quality/);
    expect(() => validateLensBlur({ ...valid, enabled: 'yes' })).toThrow(/enabled/);
    expect(() => validateLensBlur({ ...valid, depthMask: [{ id: 'x' }] })).toThrow(/mask/i);
  });
});

describe('CP4 video contract', () => {
  it('composes export settings, capability shapes and the file-carrying handle', async () => {
    const settings: VideoExportSettings = {
      container: 'mp4',
      videoCodec: 'avc',
      audioMode: 'passthrough',
      resolution: '1080p',
      bitrateMbps: 20,
      fps: 30,
      trim: { startSec: 1.5, endSec: 9 },
    };
    const capabilities: VideoCapabilities = {
      canDecode: true,
      encoders: { avc: true, vp9: false },
      containers: { mp4: true, webm: false },
      audioPassthrough: true,
    };
    const result: VideoExportResult = {
      blob: new Blob(['frame'], { type: 'video/mp4' }),
      mimeType: 'video/mp4',
      bytes: 5,
      width: 1920,
      height: 1080,
      durationSec: 7.5,
    };
    // Q03's richer task result must satisfy the frozen seam structurally.
    const richerTaskResult = { ...result, frames: 225, container: 'mp4' as const, audio: 'passthrough' as const };
    const assignable: VideoExportResult = richerTaskResult;
    const cancelled: string[] = [];
    const handle: VideoExportHandle = {
      promise: Promise.resolve(result),
      cancel: () => cancelled.push('cancel'),
      onProgress: () => () => undefined,
    };
    handle.cancel();
    const completed = await handle.promise;
    expect(cancelled).toEqual(['cancel']);
    expect(completed.blob.size).toBe(assignable.bytes);
    expect(completed.durationSec).toBe(settings.trim.endSec - settings.trim.startSec);
    expect(capabilities.encoders.vp9).toBe(false);
  });
});

describe('CP4 recipe V10 (write 10, read 1-10)', () => {
  const opticalShift = { version: 1 as const, homography: [1, 0, 0.01, 0, 1, 0, 0, 0, 1] };
  const lensBlur = normalizeLensBlur({ ...LENS_BLUR_DEFAULTS, enabled: true, aperture: 4, highlightBoost: 1.2 });
  const develop = normalizeDevelop({
    wb: { mode: 'custom', temperatureK: 5600, tint: 12 },
    exposureEV: 0.3,
    highlightRecovery: 0.25,
  });

  it('declares 10 as both the write ceiling and the readable maximum', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(10);
    expect(RECIPE_SCHEMA_MAX).toBe(10);
  });

  it('writes v10 intent only when lens blur or develop is active', () => {
    expect(shouldWriteRecipeV10({})).toBe(false);
    expect(shouldWriteRecipeV10({ lensBlur: normalizeLensBlur({}) })).toBe(false);
    expect(shouldWriteRecipeV10({ develop: RAW_NEUTRAL_DEVELOP })).toBe(false);
    expect(shouldWriteRecipeV10({ lensBlur })).toBe(true);
    expect(shouldWriteRecipeV10({ develop })).toBe(true);
  });

  it('round-trips a v9 recipe unchanged (optical/local stay v9)', () => {
    const payload = {
      ...recipeBase,
      schemaVersion: 9,
      geometry: IDENTITY_GEOMETRY,
      optical: opticalShift,
    };
    const parsed = validateRecipeJSON(JSON.stringify(payload));
    expect(parsed.schemaVersion).toBe(9);
    expect(parsed.geometry).toEqual(IDENTITY_GEOMETRY);
    expect(parsed.optical).toEqual(opticalShift);
    const reparsed = validateRecipeJSON(JSON.stringify(parsed));
    expect(reparsed.schemaVersion).toBe(9);
    expect(reparsed.optical).toEqual(opticalShift);
  });

  it('round-trips v10 lens blur and develop losslessly', () => {
    const payload = {
      ...recipeBase,
      schemaVersion: 10,
      geometry: IDENTITY_GEOMETRY,
      optical: opticalShift,
      lensBlur,
      develop,
    };
    const parsed = validateRecipeJSON(JSON.stringify(payload));
    expect(parsed.schemaVersion).toBe(10);
    expect(parsed.geometry).toEqual(IDENTITY_GEOMETRY);
    expect(parsed.optical).toEqual(opticalShift);
    expect(parsed.lensBlur).toEqual(lensBlur);
    expect(parsed.develop).toEqual(develop);
    const reparsed = validateRecipeJSON(JSON.stringify(parsed));
    expect(reparsed).toEqual(parsed);
    expect(() => assertRecipePersistable(parsed, RECIPE_STORAGE_KEYS.stable)).not.toThrow();
  });

  it('rejects v10 fields declared under an older schema version', () => {
    expect(() =>
      validateRecipeJSON(JSON.stringify({ ...recipeBase, schemaVersion: 9, geometry: IDENTITY_GEOMETRY, lensBlur })),
    ).toThrow('Unexpected v10 field in recipe');
    expect(() =>
      validateRecipeJSON(JSON.stringify({ ...recipeBase, schemaVersion: 9, geometry: IDENTITY_GEOMETRY, develop })),
    ).toThrow('Unexpected v10 field in recipe');
  });

  it('rejects unknown v10 keys, missing geometry and malformed groups', () => {
    expect(() =>
      validateRecipeJSON(JSON.stringify({ ...recipeBase, schemaVersion: 10, geometry: IDENTITY_GEOMETRY, unknownV10: 1 })),
    ).toThrow(/Unknown recipe v10 field/);
    expect(() => validateRecipeJSON(JSON.stringify({ ...recipeBase, schemaVersion: 10 }))).toThrow(/geometry wrapper/);
    expect(() =>
      validateRecipeJSON(
        JSON.stringify({ ...recipeBase, schemaVersion: 10, geometry: IDENTITY_GEOMETRY, lensBlur: { ...lensBlur, bladeCount: 4 } }),
      ),
    ).toThrow(/blade count/);
    expect(() =>
      validateRecipeJSON(
        JSON.stringify({
          ...recipeBase,
          schemaVersion: 10,
          geometry: IDENTITY_GEOMETRY,
          develop: { ...develop, exposureEV: 9 },
        }),
      ),
    ).toThrow(/exposure/);
  });

  it('rejects versions beyond 10', () => {
    expect(() =>
      validateRecipeJSON(JSON.stringify({ ...recipeBase, schemaVersion: 11, geometry: IDENTITY_GEOMETRY })),
    ).toThrow(/Unsupported recipe version/);
  });
});

describe('CP4 lens blur plan payload', () => {
  it('declares the frozen renderer-binding shape', () => {
    const psf = new Float32Array(64 * 4);
    const plan: LensBlurPlan = {
      width: 1000,
      height: 750,
      outputWidth: 2000,
      outputHeight: 1500,
      halfRes: true,
      focusPlane: 0.5,
      focusRange: 0.2,
      falloff: 0.4,
      maxCocShortSide: 0.08 / 2.8,
      maxCocPx: Math.round((0.08 / 2.8) * 750),
      aperture: 2.8,
      taps: 24,
      tapCount: 24,
      quality: 'preview',
      highlightBoost: 0.4,
      guardBand: 0.08,
      guardStrength: 1,
      psf,
      depth: null,
    };
    expect(Object.keys(plan)).toHaveLength(19);
    expect(plan.psf).toHaveLength(256);
    expect(plan.psf).toBeInstanceOf(Float32Array);
    expect(plan.depth).toBeNull();
    expect(plan.halfRes).toBe(true);
    expect(plan.maxCocPx).toBeGreaterThan(0);
    expect(plan.maxCocPx).toBeLessThanOrEqual(750);
  });
});
