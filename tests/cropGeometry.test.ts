import { describe, expect, it } from 'vitest';
import { MIN_CROP_EDGE } from '../src/engine/contracts/geometry';
import {
  fullFrameCrop,
  isFullFrameCrop,
  nudgeCrop,
  resizeCrop,
} from '../src/components/geometry/cropGeometry';
import { geometryOverlayAspect } from '../src/components/geometry/GeometryOverlay';

describe('crop resize', () => {
  const expectRect = (
    actual: { x: number; y: number; width: number; height: number },
    expected: { x: number; y: number; width: number; height: number },
  ) => {
    expect(actual.x).toBeCloseTo(expected.x, 12);
    expect(actual.y).toBeCloseTo(expected.y, 12);
    expect(actual.width).toBeCloseTo(expected.width, 12);
    expect(actual.height).toBeCloseTo(expected.height, 12);
  };

  it('moves the crop while keeping it inside the frame', () => {
    const crop = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 };
    expectRect(resizeCrop(crop, 'move', 0.1, -0.05), { x: 0.3, y: 0.15, width: 0.5, height: 0.5 });
    const clamped = resizeCrop(crop, 'move', 0.9, 0.9);
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(1 + 1e-12);
    expect(clamped.y + clamped.height).toBeLessThanOrEqual(1 + 1e-12);
  });

  it('resizes each corner and edge independently', () => {
    const crop = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
    expectRect(resizeCrop(crop, 'e', 0.1, 0), { x: 0.2, y: 0.2, width: 0.7, height: 0.6 });
    expectRect(resizeCrop(crop, 'w', 0.1, 0), { x: 0.3, y: 0.2, width: 0.5, height: 0.6 });
    expectRect(resizeCrop(crop, 'n', 0, 0.1), { x: 0.2, y: 0.3, width: 0.6, height: 0.5 });
    expectRect(resizeCrop(crop, 'sw', -0.1, 0.1), { x: 0.1, y: 0.2, width: 0.7, height: 0.7 });
  });

  it('never collapses below MIN_CROP_EDGE or leaves the frame', () => {
    const crop = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
    const collapsed = resizeCrop(crop, 'se', -1, -1);
    expect(collapsed.width).toBeCloseTo(MIN_CROP_EDGE, 12);
    expect(collapsed.height).toBeCloseTo(MIN_CROP_EDGE, 12);
    const expanded = resizeCrop(crop, 'nw', -1, -1);
    expect(expanded.x).toBe(0);
    expect(expanded.y).toBe(0);
    expect(expanded.x + expanded.width).toBeCloseTo(0.6, 12);
    expect(expanded.y + expanded.height).toBeCloseTo(0.6, 12);
  });

  it('treats a full-frame rect as the null crop', () => {
    expect(isFullFrameCrop(fullFrameCrop())).toBe(true);
    expect(isFullFrameCrop({ x: 0, y: 0, width: 1, height: 0.99 })).toBe(false);
  });
});

describe('crop keyboard nudges', () => {
  it('moves with arrows and uses a coarse step with Shift', () => {
    const crop = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 };
    expect(nudgeCrop(crop, 'move', 'ArrowRight', false)?.x).toBeCloseTo(0.205, 12);
    expect(nudgeCrop(crop, 'move', 'ArrowRight', true)?.x).toBeCloseTo(0.25, 12);
    expect(nudgeCrop(crop, 'move', 'Enter', false)).toBeNull();
  });

  it('resizes only along the edge axis', () => {
    const crop = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 };
    expect(nudgeCrop(crop, 'e', 'ArrowRight', false)?.width).toBeCloseTo(0.505, 12);
    expect(nudgeCrop(crop, 'e', 'ArrowUp', false)).toBeNull();
    const corner = nudgeCrop(crop, 'se', 'ArrowDown', false);
    expect(corner?.height).toBeCloseTo(0.505, 12);
    expect(corner?.width).toBeCloseTo(0.5, 12);
  });
});

describe('overlay aspect', () => {
  it('uses the post-rotation aspect and ignores crop', () => {
    const geometry = {
      rotation: 90 as const,
      straighten: 12,
      flipHorizontal: false,
      flipVertical: false,
      crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    };
    expect(geometryOverlayAspect(geometry, 4 / 3)).toBeCloseTo(3 / 4, 12);
  });
});
