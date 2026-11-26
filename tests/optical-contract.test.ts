import { describe, it, expect } from 'vitest';
import {
  OPTICAL_TRANSFORM_VERSION,
  assertOpticalTransform,
  fromOpticalTransform,
  toOpticalTransform,
} from '../poc/optical/math/optical-transform';
import {
  identityMat3,
  perspectiveCorrectionHomography,
  perspectiveCorrectionQuad,
  type Vec2,
} from '../poc/optical/math/homography';
import { correctedToSource, sourceToCorrected, type OpticalGeometry } from '../poc/optical/math/coordinates';
import {
  createOpticalTransform,
  createPerspectiveQuad,
  validateOpticalTransform,
  type PerspectiveQuad,
} from '../src/engine/contracts/optical';
import { IDENTITY_GEOMETRY } from '../src/engine/contracts/geometry';
import { geometryToSource, sourceToGeometry } from '../src/engine/contracts/geometryMappings';
import { MAX_MASKS, MAX_STROKE_POINTS, MAX_STROKES } from '../src/engine/contracts/masks';

describe('Q01 optical transform adapter', () => {
  it('adds the mandatory version and carries an optional perspective quad', () => {
    const geometry = {
      homography: perspectiveCorrectionHomography(0.5, 0.2, 0.15),
      distortion: { k1: 0.2, k3: -0.01, p1: 0.004 },
      perspective: perspectiveCorrectionQuad(0.5, 0.2, 0.15),
    };
    const transform = toOpticalTransform(geometry);
    expect(transform.version).toBe(OPTICAL_TRANSFORM_VERSION);
    expect(transform.homography).toEqual(geometry.homography);
    expect(transform.homography).not.toBe(geometry.homography);
    expect(transform.distortion).toEqual(geometry.distortion);
    expect(transform.distortion).not.toBe(geometry.distortion);
    expect(transform.perspective).toEqual(geometry.perspective);
    expect(() => assertOpticalTransform(transform)).not.toThrow();
  });

  it('accepts an explicit perspective quad and omits absent optional fields', () => {
    const quad = perspectiveCorrectionQuad(0.4, -0.2, 0.1);
    const transform = toOpticalTransform({ homography: identityMat3() }, quad);
    expect(transform.perspective).toEqual(quad);
    expect('distortion' in transform).toBe(false);

    const plain = toOpticalTransform({ homography: identityMat3() });
    expect('perspective' in plain).toBe(false);
    expect(plain.version).toBe(1);
  });

  it('rejects singular, non-finite, and malformed homographies', () => {
    expect(() => toOpticalTransform({ homography: [1, 0, 0, 0, 1, 0, 0, 0, 0] })).toThrow(/singular/);
    expect(() => toOpticalTransform({ homography: [1, 0, 0, 0, 1, 0, 0, 0, Number.NaN] })).toThrow(/finite|singular/);
    expect(() =>
      toOpticalTransform({ homography: [1, 0, 0, 0, 1, 0] as unknown as number[] })
    ).toThrow(/homography/);
  });

  it('rejects out-of-range distortion coefficients at the contract boundary', () => {
    const base = { homography: identityMat3() };
    expect(() => toOpticalTransform({ ...base, distortion: { k1: 2 } })).toThrow(/distortion/);
    expect(() => toOpticalTransform({ ...base, distortion: { k1: 0.1, k2: 1.5 } })).toThrow(/distortion/);
    expect(() => toOpticalTransform({ ...base, distortion: { k1: 0.1, p1: 0.75 } })).toThrow(/distortion/);
  });

  it('rejects non-convex or out-of-range perspective quads', () => {
    const crossed: Vec2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(() => toOpticalTransform({ homography: identityMat3() }, crossed)).toThrow(/perspective/);
    const outside: Vec2[] = [
      { x: -0.6, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(() => toOpticalTransform({ homography: identityMat3() }, outside)).toThrow(/perspective/);
  });

  it('round-trips a validated transform into Q02 geometry with deep copies', () => {
    const transform = toOpticalTransform(
      {
        homography: perspectiveCorrectionHomography(0.3, 0.1, 0.12),
        distortion: { k1: -0.1, k2: 0.02, k3: 0.001, p1: 0.003, p2: -0.002 },
      },
      perspectiveCorrectionQuad(0.3, 0.1, 0.12)
    );
    const geometry = fromOpticalTransform(transform);
    expect(geometry.homography).toEqual(transform.homography);
    expect(geometry.homography).not.toBe(transform.homography);
    expect(geometry.distortion).toEqual(transform.distortion);
    expect(geometry.perspective).toEqual(transform.perspective);
    expect(geometry.perspective).not.toBe(transform.perspective);

    const roundTrip = toOpticalTransform(geometry);
    expect(roundTrip).toEqual(transform);
  });

  it('rejects unknown versions and invalid payloads from Q01', () => {
    const valid = toOpticalTransform({ homography: identityMat3() });
    expect(() => fromOpticalTransform({ ...valid, version: 2 })).toThrow(/transform/);
    expect(() => fromOpticalTransform({ ...valid, homography: [1, 0, 0, 0, 1, 0, 0, 0, 0] })).toThrow(/singular/);
    expect(() => fromOpticalTransform(null)).toThrow(/transform/);
  });

  it('matches the Q01 perspective quad formula', () => {
    // createPerspectiveQuad(0.5, 0.2, 0.15): v = 0.075, h = 0.03.
    expect(perspectiveCorrectionQuad(0.5, 0.2, 0.15)).toEqual([
      { x: 0.075, y: 0 },
      { x: 0.925, y: 0.03 },
      { x: 1, y: 0.97 },
      { x: 0, y: 1 },
    ]);
  });

  it('keeps corrected->source direction and inverse consistent after adaptation', () => {
    const geometry: OpticalGeometry = fromOpticalTransform(
      toOpticalTransform(
        {
          homography: perspectiveCorrectionHomography(0.6, -0.3, 0.15),
          distortion: { k1: 0.18, k2: -0.02 },
        },
        perspectiveCorrectionQuad(0.6, -0.3, 0.15)
      )
    );
    const points: Vec2[] = [
      { x: 0.5, y: 0.5 },
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.3 },
      { x: 0.35, y: 0.75 },
      { x: 0.9, y: 0.9 },
    ];
    for (const source of points) {
      const corrected = sourceToCorrected(source, geometry);
      const back = correctedToSource(corrected, geometry);
      expect(Math.abs(back.x - source.x)).toBeLessThan(1e-9);
      expect(Math.abs(back.y - source.y)).toBeLessThan(1e-9);
    }
  });
});

describe('Q01 contract cross-checks after merging the engine branch', () => {
  it('produces payloads that Q01 validateOpticalTransform accepts', () => {
    const geometry: OpticalGeometry = {
      homography: perspectiveCorrectionHomography(0.5, 0.2, 0.15),
      distortion: { k1: 0.22, k2: -0.035, p1: 0.008, p2: -0.006 },
    };
    const quad = perspectiveCorrectionQuad(0.5, 0.2, 0.15);
    const adapted = toOpticalTransform(geometry, quad);
    expect(() => validateOpticalTransform(adapted)).not.toThrow();
    expect(() => validateOpticalTransform(JSON.parse(JSON.stringify(adapted)))).not.toThrow();
  });

  it('agrees with the Q01 perspective quad and converts Q01 payloads back', () => {
    const quad: PerspectiveQuad = createPerspectiveQuad(0.4, -0.2, 0.12);
    expect(quad as readonly Vec2[]).toEqual(perspectiveCorrectionQuad(0.4, -0.2, 0.12));

    const q01 = createOpticalTransform({
      homography: perspectiveCorrectionHomography(0.4, -0.2, 0.12),
      perspective: quad,
    });
    expect(() => validateOpticalTransform(q01)).not.toThrow();
    const geometry = fromOpticalTransform(q01);
    expect(geometry.homography).toEqual(q01.homography);
    expect(geometry.perspective).toEqual(quad);
  });

  it('pins the Q01 canonical mask limits used by the budget measurements', () => {
    expect(MAX_MASKS).toBe(16);
    expect(MAX_STROKES).toBe(64);
    expect(MAX_STROKE_POINTS).toBe(1024);
  });

  it('handoffs Q01 geometry output and Q02 optical input with the same y-down NIS', () => {
    expect(sourceToGeometry({ x: 0, y: 0 }, IDENTITY_GEOMETRY, 1)).toEqual({ x: 0, y: 0 });
    expect(geometryToSource({ x: 0, y: 0 }, IDENTITY_GEOMETRY, 1)).toEqual({ x: 0, y: 0 });
    expect(correctedToSource({ x: 0, y: 0 }, { homography: identityMat3() })).toEqual({ x: 0, y: 0 });

    const geometry = {
      ...IDENTITY_GEOMETRY,
      straighten: 2,
      crop: { x: 0.1, y: 0.05, width: 0.8, height: 0.9 },
    };
    const points: Vec2[] = [
      { x: 0.42, y: 0.31 },
      { x: 0.2, y: 0.6 },
      { x: 0.75, y: 0.4 },
    ];
    for (const source of points) {
      const mapped = sourceToGeometry(source, geometry, 1.5);
      expect(mapped.x).toBeGreaterThanOrEqual(0);
      expect(mapped.x).toBeLessThanOrEqual(1);
      expect(mapped.y).toBeGreaterThanOrEqual(0);
      expect(mapped.y).toBeLessThanOrEqual(1);
      const back = geometryToSource(mapped, geometry, 1.5);
      expect(Math.abs(back.x - source.x)).toBeLessThan(1e-9);
      expect(Math.abs(back.y - source.y)).toBeLessThan(1e-9);
    }
  });
});