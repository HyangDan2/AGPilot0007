import { describe, expect, it } from 'vitest';
import { normalizeGeometry } from '../src/engine/contracts/geometry';
import { createOpticalTransform } from '../src/engine/contracts/optical';
import {
  renderSourceStage,
  sourceStageFingerprint,
  type Q02SourceStageSource,
} from '../src/engine/optical/sourceStage';

const source = {} as Q02SourceStageSource;
const sourceSize = { sourceWidth: 64, sourceHeight: 48, output: { width: 64, height: 48 } };

const geometry = normalizeGeometry({
  rotation: 270,
  straighten: -8,
  flipHorizontal: false,
  crop: { x: 0.2, y: 0.15, width: 0.55, height: 0.65 },
});

const optical = createOpticalTransform({
  homography: [1.01, 0.005, -0.004, -0.002, 0.99, 0.006, 0.0002, -0.0001, 1],
  distortion: { k1: -0.05, k2: 0.01, p1: 0.003, p2: -0.002 },
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

describe('Q02 source stage', () => {
  it('returns null for the legacy path when geometry and optical are identity', () => {
    expect(
      renderSourceStage({
        ...sourceSize,
        source,
      }),
    ).toBeNull();
    expect(
      renderSourceStage({
        ...sourceSize,
        source,
        geometry: normalizeGeometry(null),
        optical: createOpticalTransform(),
        masks: [],
      }),
    ).toBeNull();
  });

  it('rejects a non-renderable geometry before touching the source', () => {
    expect(() =>
      renderSourceStage({
        ...sourceSize,
        source,
        geometry: { rotation: 0, straighten: 46, flipHorizontal: false, flipVertical: false, crop: null },
      }),
    ).toThrow('Invalid geometry straighten');
  });

  it('rejects a non-invertible optical transform before touching the source', () => {
    expect(() =>
      renderSourceStage({
        ...sourceSize,
        source,
        optical: createOpticalTransform({ distortion: { k1: -0.5 } }),
      }),
    ).toThrow('Optical distortion is not invertible in the image domain');
  });

  it('rejects mask stacks over the product budget before touching the source', () => {
    expect(() =>
      renderSourceStage({
        ...sourceSize,
        source,
        geometry,
        masks: Array.from({ length: 17 }, (_, index) => radialMask(index)),
      }),
    ).toThrow('Invalid masks: at most 16 masks');
  });

  it('produces a stable fingerprint for identical source dimensions and settings', () => {
    const settings = { ...sourceSize, geometry, optical };
    const first = sourceStageFingerprint(settings);
    const second = sourceStageFingerprint({
      ...settings,
      geometry: { ...geometry, crop: geometry.crop ? { ...geometry.crop } : null },
      optical: createOpticalTransform({
        homography: [...optical.homography],
        distortion: { k1: -0.05, k2: 0.01, p1: 0.003, p2: -0.002 },
      }),
    });
    expect(second).toBe(first);
    expect(sourceStageFingerprint({ ...settings, output: { width: 32, height: 24 } })).not.toBe(first);
  });
});
