import { describe, expect, it } from 'vitest';
import {
  applyOpticalHomography,
  createPerspectiveQuad,
  validateOpticalTransform,
  type PerspectiveQuad,
} from '../src/engine/contracts/optical';
import { normalizeGeometry } from '../src/engine/contracts/geometry';
import { geometryOutputSize } from '../src/engine/optical/geometry';
import {
  createPerspectiveTransform,
  homographyFromPerspectiveQuad,
  opticalIsIdentity,
} from '../src/engine/optical/transform';

const UNIT_SQUARE: PerspectiveQuad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe('CP3 geometry output size', () => {
  it('keeps source dimensions for identity and flips', () => {
    expect(geometryOutputSize(null, 4000, 3000)).toEqual({ width: 4000, height: 3000 });
    expect(
      geometryOutputSize(
        normalizeGeometry({ flipHorizontal: true, flipVertical: true }),
        4000,
        3000,
      ),
    ).toEqual({ width: 4000, height: 3000 });
  });

  it('swaps axes for quarter turns and leaves 180 alone', () => {
    expect(geometryOutputSize(normalizeGeometry({ rotation: 90 }), 4000, 3000)).toEqual({
      width: 3000,
      height: 4000,
    });
    expect(geometryOutputSize(normalizeGeometry({ rotation: 270 }), 4000, 3000)).toEqual({
      width: 3000,
      height: 4000,
    });
    expect(geometryOutputSize(normalizeGeometry({ rotation: 180 }), 4000, 3000)).toEqual({
      width: 4000,
      height: 3000,
    });
  });

  it('keeps dimensions for straighten (cover) and multiplies crop', () => {
    expect(geometryOutputSize(normalizeGeometry({ straighten: 10 }), 4000, 3000)).toEqual({
      width: 4000,
      height: 3000,
    });
    expect(geometryOutputSize(normalizeGeometry({ straighten: -45 }), 4000, 3000)).toEqual({
      width: 4000,
      height: 3000,
    });
    expect(
      geometryOutputSize(
        normalizeGeometry({
          rotation: 90,
          straighten: 10,
          crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.4 },
        }),
        4000,
        3000,
      ),
    ).toEqual({ width: 1500, height: 1600 });
  });

  it('rounds deterministically and never emits a zero dimension', () => {
    const geometry = normalizeGeometry({
      rotation: 90,
      straighten: 12,
      crop: { x: 0.2, y: 0.15, width: 0.55, height: 0.65 },
    });
    const first = geometryOutputSize(geometry, 4000, 3000);
    const second = geometryOutputSize({ ...geometry, crop: { ...geometry.crop! } }, 4000, 3000);
    expect(second).toEqual(first);
    expect(geometryOutputSize(normalizeGeometry({ crop: { x: 0, y: 0, width: 0.01, height: 0.01 } }), 10, 10)).toEqual({
      width: 1,
      height: 1,
    });
    expect(() => geometryOutputSize(null, 0, 100)).toThrow('Invalid geometry source dimensions');
  });
});

describe('CP3 perspective transform', () => {
  it('solves a homography that maps the unit square onto the perspective quad', () => {
    const quad = createPerspectiveQuad(0.35, -0.25);
    const homography = homographyFromPerspectiveQuad(quad);
    UNIT_SQUARE.forEach((corner, index) => {
      const mapped = applyOpticalHomography(homography, corner);
      expect(mapped.x).toBeCloseTo(quad[index].x, 10);
      expect(mapped.y).toBeCloseTo(quad[index].y, 10);
    });
    expect(() =>
      validateOpticalTransform({ version: 1, homography, perspective: quad }),
    ).not.toThrow();
  });

  it('keeps the identity quad as the identity homography', () => {
    expect(homographyFromPerspectiveQuad(UNIT_SQUARE)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(opticalIsIdentity(createPerspectiveTransform(0, 0))).toBe(true);
  });

  it('creates a validated perspective optical transform from UI controls', () => {
    const transform = createPerspectiveTransform(0.35, -0.25);
    expect(transform.perspective).toEqual(createPerspectiveQuad(0.35, -0.25));
    expect(opticalIsIdentity(transform)).toBe(false);
    UNIT_SQUARE.forEach((corner, index) => {
      const mapped = applyOpticalHomography(transform.homography, corner);
      expect(mapped.x).toBeCloseTo(transform.perspective![index].x, 10);
      expect(mapped.y).toBeCloseTo(transform.perspective![index].y, 10);
    });
    expect(() => validateOpticalTransform(transform)).not.toThrow();
  });

  it('rejects degenerate quads', () => {
    const degenerate: PerspectiveQuad = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(() => homographyFromPerspectiveQuad(degenerate)).toThrow('degenerate');
  });
});
