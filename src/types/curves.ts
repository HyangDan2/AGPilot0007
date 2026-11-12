export const CURVE_CHANNELS = ['white', 'red', 'green', 'blue'] as const;
export type CurveChannel = typeof CURVE_CHANNELS[number];
export type CurvePoint = [number, number];
export const CURVE_MIN_GAP = 1 / 1024;
export type ToneCurves = Record<CurveChannel, CurvePoint[]>;
export const identityPoints = (): CurvePoint[] => [[0, 0], [1, 1]];
export const defaultCurves = (): ToneCurves => ({ white: identityPoints(), red: identityPoints(), green: identityPoints(), blue: identityPoints() });
export function normalizeCurves(value?: Partial<ToneCurves>): ToneCurves {
  const result = defaultCurves();
  for (const channel of CURVE_CHANNELS) {
    const points = value?.[channel];
    if (!Array.isArray(points) || points.length < 2 || points.length > 16) continue;
    if (!points.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1))) continue;
    const sorted = points.map(p => [...p] as CurvePoint).sort((a,b) => a[0]-b[0]);
    if (sorted.some((p,i) => i > 0 && p[0]-sorted[i-1][0] < CURVE_MIN_GAP)) continue;
    result[channel] = sorted;
  }
  return result;
}
export const isIdentityCurve = (points: CurvePoint[]) => points.length >= 2 && points[0][0] === 0 && points.at(-1)![0] === 1 && points.every(([x,y]) => Math.abs(x-y)<1e-7);

// Keep point order while allowing both endpoints to move across the input range.
export function moveCurvePoint(points: CurvePoint[], index: number, x: number, y: number): CurvePoint[] {
  const next = points.map(p => [...p] as CurvePoint);
  if (!next[index] || !Number.isFinite(x) || !Number.isFinite(y)) return next;
  const min = index === 0 ? 0 : next[index - 1][0] + CURVE_MIN_GAP;
  const max = index === next.length - 1 ? 1 : next[index + 1][0] - CURVE_MIN_GAP;
  next[index] = [Math.max(min, Math.min(max, x)), Math.max(0, Math.min(1, y))];
  return next;
}
