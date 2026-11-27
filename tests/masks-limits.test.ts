import { describe, expect, it } from 'vitest';
import {
  MASK_LIMITS,
  MAX_MASKS,
  MAX_STROKE_POINTS,
  MAX_STROKES,
  normalizeMasks,
  normalizeMasksDetailed,
  validateMasks,
} from '../src/engine/contracts/masks';

const linearMask = (index: number) => ({
  id: `mask-${index}`,
  name: `Mask ${index}`,
  kind: 'linear',
  start: { x: 0, y: 0.5 },
  end: { x: 1, y: 0.5 },
  feather: 0.2,
});

const stroke = (index: number, points = 2) => ({
  points: Array.from({ length: points }, (_, point) => ({
    x: (point + index) % 2 === 0 ? 0.25 : 0.75,
    y: 0.5,
  })),
  radius: 0.1,
  hardness: 0.5,
  flow: 1,
});

const brushMask = (index: number, strokes: unknown[]) => ({
  id: `brush-${index}`,
  name: `Brush ${index}`,
  kind: 'brush',
  strokes,
});

describe('mask capacity limits', () => {
  it('exposes the same ceilings as the mask constants', () => {
    expect(MASK_LIMITS).toEqual({
      masks: MAX_MASKS,
      strokes: MAX_STROKES,
      points: MAX_STROKE_POINTS,
    });
  });

  it('reports masks dropped beyond MAX_MASKS', () => {
    const input = Array.from({ length: MAX_MASKS + 4 }, (_, index) => linearMask(index));
    const { masks, dropped } = normalizeMasksDetailed(input);
    expect(masks).toHaveLength(MAX_MASKS);
    expect(dropped).toEqual({ masks: 4, strokes: 0, points: 0 });
  });

  it('reports strokes dropped beyond MAX_STROKES', () => {
    const input = [brushMask(0, Array.from({ length: MAX_STROKES + 6 }, (_, index) => stroke(index)))];
    const { masks, dropped } = normalizeMasksDetailed(input);
    expect(masks).toHaveLength(1);
    expect((masks[0] as { strokes: unknown[] }).strokes).toHaveLength(MAX_STROKES);
    expect(dropped).toEqual({ masks: 0, strokes: 6, points: 0 });
  });

  it('reports points dropped beyond MAX_STROKE_POINTS', () => {
    const input = [brushMask(0, [stroke(0, MAX_STROKE_POINTS + 76)])];
    const { masks, dropped } = normalizeMasksDetailed(input);
    expect((masks[0] as { strokes: Array<{ points: unknown[] }> }).strokes[0].points).toHaveLength(
      MAX_STROKE_POINTS,
    );
    expect(dropped).toEqual({ masks: 0, strokes: 0, points: 76 });
  });

  it('does not count invalid or duplicate entries as truncation', () => {
    const input = [linearMask(0), linearMask(0), null, 'junk', { ...linearMask(1), kind: 'bogus' }];
    const { masks, dropped } = normalizeMasksDetailed(input);
    expect(masks).toHaveLength(1);
    expect(dropped).toEqual({ masks: 0, strokes: 0, points: 0 });
  });

  it('keeps normalizeMasks identical to the detailed masks list', () => {
    const input = Array.from({ length: MAX_MASKS + 2 }, (_, index) => linearMask(index));
    expect(normalizeMasks(input)).toEqual(normalizeMasksDetailed(input).masks);
  });

  it('keeps validateMasks strict at the ceilings', () => {
    const tooMany = Array.from({ length: MAX_MASKS + 1 }, (_, index) => linearMask(index));
    expect(() => validateMasks(tooMany)).toThrow('Invalid masks');
    expect(() => validateMasks(tooMany.slice(0, MAX_MASKS))).not.toThrow();

    const tooManyPoints = [brushMask(0, [stroke(0, MAX_STROKE_POINTS + 1)])];
    expect(() => validateMasks(tooManyPoints)).toThrow('Invalid mask stroke');
    const tooManyStrokes = [
      brushMask(0, Array.from({ length: MAX_STROKES + 1 }, (_, index) => stroke(index))),
    ];
    expect(() => validateMasks(tooManyStrokes)).toThrow('Invalid mask shape');
  });
});
