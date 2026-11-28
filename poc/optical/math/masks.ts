import type { Vec2 } from './homography';
import { uvToShortSide } from './coordinates';

// All mask geometry is stored in normalized image space (NIS) or short-side
// units, never in pixels. Short-side units make radii and feather widths
// isotropic and independent of preview/export resolution.

export type MaskBlend = 'add' | 'subtract' | 'intersect';

export interface MaskBase {
  id: string;
  enabled: boolean;
  invert?: boolean;
  opacity?: number;
  blend?: MaskBlend;
}

export interface BrushStroke {
  points: Vec2[];
  radius: number;
  hardness: number;
  flow: number;
}

export interface BrushMask extends MaskBase {
  kind: 'brush';
  strokes: BrushStroke[];
}

export interface LinearMask extends MaskBase {
  kind: 'linear';
  start: Vec2;
  end: Vec2;
  // Fraction (0..1) of the start-end span used as the soft transition, centred
  // on the midpoint. 0 produces a hard edge, 1 a full ramp.
  feather: number;
}

export interface RadialMask extends MaskBase {
  kind: 'radial';
  center: Vec2;
  radiusX: number;
  radiusY: number;
  rotation: number;
  // Fraction (0..1) of the radius used as the outer soft transition.
  feather: number;
}

export interface LuminanceMask extends MaskBase {
  kind: 'luminance';
  lo: number;
  hi: number;
  feather: number;
}

export interface ColorMask extends MaskBase {
  kind: 'color';
  color: { r: number; g: number; b: number };
  hueRange: number;
  satRange: number;
  lumRange: number;
  feather: number;
}

export type LocalMask = BrushMask | LinearMask | RadialMask | LuminanceMask | ColorMask;

export interface RgbSample {
  r: number;
  g: number;
  b: number;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function luma(sample: RgbSample): number {
  return 0.2126 * sample.r + 0.7152 * sample.g + 0.0722 * sample.b;
}

export function rgbToHsl(sample: RgbSample): { h: number; s: number; l: number } {
  const max = Math.max(sample.r, sample.g, sample.b);
  const min = Math.min(sample.r, sample.g, sample.b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta < 1e-9) return { h: 0, s: 0, l };
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === sample.r) h = ((sample.g - sample.b) / delta) % 6;
  else if (max === sample.g) h = (sample.b - sample.r) / delta + 2;
  else h = (sample.r - sample.g) / delta + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  const t = lengthSq > 1e-12 ? Math.min(1, Math.max(0, (apx * abx + apy * aby) / lengthSq)) : 0;
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

function brushWeight(mask: BrushMask, uv: Vec2, aspect: number): number {
  const p = uvToShortSide(uv, aspect);
  let acc = 0;
  const union = (weight: number) => {
    acc = acc + weight - acc * weight;
  };
  for (const stroke of mask.strokes) {
    const radius = Math.max(1e-6, stroke.radius);
    const feather = radius * (1 - Math.min(1, Math.max(0, stroke.hardness)));
    const flow = Math.min(1, Math.max(0, stroke.flow));
    if (stroke.points.length === 0) continue;
    if (stroke.points.length === 1) {
      const q = uvToShortSide(stroke.points[0], aspect);
      const distance = Math.hypot(p.x - q.x, p.y - q.y);
      union((1 - smoothstep(radius - feather, radius, distance)) * flow);
      continue;
    }
    for (let i = 0; i < stroke.points.length - 1; i++) {
      const distance = distanceToSegment(
        p,
        uvToShortSide(stroke.points[i], aspect),
        uvToShortSide(stroke.points[i + 1], aspect)
      );
      const coverage = 1 - smoothstep(radius - feather, radius, distance);
      union(coverage * flow);
    }
  }
  return acc;
}

function linearWeight(mask: LinearMask, uv: Vec2, aspect: number): number {
  const start = uvToShortSide(mask.start, aspect);
  const end = uvToShortSide(mask.end, aspect);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-12) return 0;
  const p = uvToShortSide(uv, aspect);
  const t = ((p.x - start.x) * dx + (p.y - start.y) * dy) / lengthSq;
  const f = Math.min(1, Math.max(0, mask.feather));
  return smoothstep(0.5 - f / 2, 0.5 + f / 2, t);
}

function radialWeight(mask: RadialMask, uv: Vec2, aspect: number): number {
  const center = uvToShortSide(mask.center, aspect);
  const p = uvToShortSide(uv, aspect);
  const cos = Math.cos(-mask.rotation);
  const sin = Math.sin(-mask.rotation);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const x = (dx * cos - dy * sin) / Math.max(1e-6, mask.radiusX);
  const y = (dx * sin + dy * cos) / Math.max(1e-6, mask.radiusY);
  const distance = Math.hypot(x, y);
  const f = Math.min(1, Math.max(0, mask.feather));
  return 1 - smoothstep(1 - f, 1, distance);
}

function bandWeight(value: number, lo: number, hi: number, feather: number): number {
  if (value < lo) return smoothstep(lo - feather, lo, value);
  if (value > hi) return 1 - smoothstep(hi, hi + feather, value);
  return 1;
}

function luminanceWeight(mask: LuminanceMask, sample: RgbSample): number {
  return bandWeight(luma(sample), mask.lo, mask.hi, Math.max(1e-6, mask.feather));
}

function colorWeight(mask: ColorMask, sample: RgbSample): number {
  const target = rgbToHsl(mask.color);
  const current = rgbToHsl(sample);
  let hueDistance = Math.abs(current.h - target.h);
  hueDistance = Math.min(hueDistance, 360 - hueDistance);
  const hue = target.s < 0.02 || current.s < 0.02
    ? 1
    : 1 - smoothstep(mask.hueRange, mask.hueRange * (1 + Math.max(0, mask.feather)), hueDistance);
  const sat = 1 - smoothstep(
    mask.satRange,
    mask.satRange * (1 + Math.max(0, mask.feather)),
    Math.abs(current.s - target.s)
  );
  const lum = 1 - smoothstep(
    mask.lumRange,
    mask.lumRange * (1 + Math.max(0, mask.feather)),
    Math.abs(current.l - target.l)
  );
  return Math.max(0, hue) * Math.max(0, sat) * Math.max(0, lum);
}

export function evaluateMask(
  mask: LocalMask,
  uv: Vec2,
  aspect: number,
  sample: RgbSample = { r: 0.5, g: 0.5, b: 0.5 }
): number {
  let weight: number;
  switch (mask.kind) {
    case 'brush':
      weight = brushWeight(mask, uv, aspect);
      break;
    case 'linear':
      weight = linearWeight(mask, uv, aspect);
      break;
    case 'radial':
      weight = radialWeight(mask, uv, aspect);
      break;
    case 'luminance':
      weight = luminanceWeight(mask, sample);
      break;
    case 'color':
      weight = colorWeight(mask, sample);
      break;
  }
  if (mask.invert) weight = 1 - weight;
  return Math.min(1, Math.max(0, weight * (mask.opacity ?? 1)));
}

export function composeMaskStack(
  masks: LocalMask[],
  uv: Vec2,
  aspect: number,
  sample?: RgbSample,
  base = 0
): number {
  let acc = base;
  for (const mask of masks) {
    if (!mask.enabled) continue;
    const weight = evaluateMask(mask, uv, aspect, sample);
    const blend = mask.blend ?? 'add';
    if (blend === 'add') acc = Math.min(1, acc + weight);
    else if (blend === 'subtract') acc = Math.max(0, acc - weight);
    else acc = acc * weight;
  }
  return acc;
}
