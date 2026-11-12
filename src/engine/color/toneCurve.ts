/**
 * Monotone cubic spline interpolation (Fritsch-Carlson).
 * Guaranteed monotonic when data points are monotonic.
 * Avoids spline overshooting / oscillations.
 */
export function createMonotoneSpline(points: [number, number][]): (x: number) => number {
  const n = points.length;
  if (n === 0) return (x: number) => x;
  if (n === 1) return () => points[0][1];

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);

  // Slopes of secant lines between successive points
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    d.push(dx !== 0 ? (ys[i + 1] - ys[i]) / dx : 0);
  }

  // Internal tangents
  const m: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m.push(0);
    } else {
      m.push((d[i - 1] + d[i]) / 2);
    }
  }
  m.push(d[n - 2]);

  // Fritsch & Carlson modifier for monotonicity
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }

  return (x: number): number => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];

    let k = 0;
    while (x > xs[k + 1] && k < n - 2) {
      k++;
    }

    const h = xs[k + 1] - xs[k];
    if (h === 0) return ys[k];

    const u = (x - xs[k]) / h;
    const u2 = u * u;
    const u3 = u2 * u;

    const val =
      (2 * u3 - 3 * u2 + 1) * ys[k] +
      (u3 - 2 * u2 + u) * h * m[k] +
      (-2 * u3 + 3 * u2) * ys[k + 1] +
      (u3 - u2) * h * m[k + 1];

    return Math.min(1.0, Math.max(0.0, val));
  };
}
