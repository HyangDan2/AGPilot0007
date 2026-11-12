import { describe, it, expect } from 'vitest';
import { createMonotoneSpline } from '../src/engine/color/toneCurve';

describe('Monotone Tone Curve Interpolation (Fritsch-Carlson)', () => {
  it('returns linear passthrough for 2-point identity curve', () => {
    const curve = createMonotoneSpline([
      [0.0, 0.0],
      [1.0, 1.0],
    ]);
    expect(curve(0.0)).toBe(0.0);
    expect(curve(0.25)).toBeCloseTo(0.25, 4);
    expect(curve(0.5)).toBeCloseTo(0.5, 4);
    expect(curve(0.75)).toBeCloseTo(0.75, 4);
    expect(curve(1.0)).toBe(1.0);
  });

  it('guarantees monotonicity without overshoot', () => {
    // S-curve points
    const points: [number, number][] = [
      [0.0, 0.0],
      [0.2, 0.1],
      [0.5, 0.5],
      [0.8, 0.9],
      [1.0, 1.0],
    ];
    const curve = createMonotoneSpline(points);

    let prev = -1;
    for (let x = 0.0; x <= 1.0; x += 0.01) {
      const y = curve(x);
      expect(y).toBeGreaterThanOrEqual(prev);
      expect(y).toBeGreaterThanOrEqual(0.0);
      expect(y).toBeLessThanOrEqual(1.0);
      prev = y;
    }
  });

  it('clamps values outside range [0, 1]', () => {
    const curve = createMonotoneSpline([
      [0.0, 0.0],
      [1.0, 1.0],
    ]);
    expect(curve(-0.5)).toBe(0.0);
    expect(curve(1.5)).toBe(1.0);
  });
});
