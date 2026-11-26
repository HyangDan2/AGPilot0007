import type { Vec2 } from './homography';
import { uvToShortSide } from './coordinates';

// Virtual defocus model. This is an artist-controlled thin-lens approximation:
// the circle of confusion (CoC) radius is derived from a focus centre, a sharp
// zone and a falloff, then convolved with an aperture-shaped PSF. It is not a
// measurement of a physical lens and must not be labelled as one.

export interface ApertureShape {
  blades: number;
  rotation: number;
  roundness: number;
}

export interface PsfTap {
  offset: Vec2;
  weight: number;
}

export interface FocusSettings {
  center: Vec2;
  focusRadius: number;
  falloff: number;
  maxCoc: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function polygonRadius(theta: number, blades: number, rotation: number): number {
  if (blades < 3) return 1;
  const sector = (2 * Math.PI) / blades;
  let local = (theta - rotation) % sector;
  if (local < 0) local += sector;
  return Math.cos(Math.PI / blades) / Math.cos(local - Math.PI / blades);
}

function insideAperture(theta: number, radius: number, aperture: ApertureShape): boolean {
  const roundness = Math.min(1, Math.max(0, aperture.roundness));
  const limit = roundness + (1 - roundness) * polygonRadius(theta, aperture.blades, aperture.rotation);
  return radius <= limit;
}

// Deterministic area-uniform spiral samples filtered by the aperture polygon.
// Offsets are in unit CoC radius and weights sum to one.
export function apertureTapWeights(aperture: ApertureShape, taps = 64): PsfTap[] {
  const offsets: PsfTap[] = [];
  for (let i = 0; i < taps; i++) {
    const radius = Math.sqrt((i + 0.5) / taps);
    const theta = i * GOLDEN_ANGLE;
    if (!insideAperture(theta, radius, aperture)) continue;
    offsets.push({ offset: { x: radius * Math.cos(theta), y: radius * Math.sin(theta) }, weight: 1 });
  }
  if (offsets.length === 0) {
    return [{ offset: { x: 0, y: 0 }, weight: 1 }];
  }
  const norm = 1 / offsets.length;
  for (const tap of offsets) tap.weight *= norm;
  return offsets;
}

export function circleOfConfusion(
  uv: Vec2,
  focus: FocusSettings,
  aspect: number
): number {
  const a = uvToShortSide(uv, aspect);
  const b = uvToShortSide(focus.center, aspect);
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  const feather = Math.max(1e-6, focus.falloff);
  const t = Math.min(1, Math.max(0, (distance - focus.focusRadius) / feather));
  return focus.maxCoc * t * t * (3 - 2 * t);
}

function sampleBilinear(
  src: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number,
  out: number[]
): void {
  const x = Math.min(width - 1, Math.max(0, u * width - 0.5));
  const y = Math.min(height - 1, Math.max(0, v * height - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  for (let c = 0; c < 4; c++) {
    const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
    const bottom = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
}

// CPU reference gather blur. RGBA is non-premultiplied 0..1. Pixels whose CoC
// is effectively zero are copied unchanged so disabled defocus is exact.
export function blurRgbaReference(
  src: Float32Array,
  width: number,
  height: number,
  focus: FocusSettings,
  aperture: ApertureShape,
  options: { taps?: number } = {}
): Float32Array {
  if (src.length !== width * height * 4) throw new Error('RGBA buffer size mismatch');
  const taps = apertureTapWeights(aperture, options.taps ?? 64);
  const aspect = width / height;
  const scaleU = Math.max(1, aspect);
  const scaleV = Math.max(1, 1 / aspect);
  const out = new Float32Array(src.length);
  const sample = [0, 0, 0, 0];

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const i = (y * width + x) * 4;
      const coc = circleOfConfusion({ x: u, y: v }, focus, aspect);
      if (coc < 1e-5) {
        out[i] = src[i];
        out[i + 1] = src[i + 1];
        out[i + 2] = src[i + 2];
        out[i + 3] = src[i + 3];
        continue;
      }
      const du = (coc / scaleU);
      const dv = (coc / scaleV);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const tap of taps) {
        sampleBilinear(src, width, height, u + tap.offset.x * du, v + tap.offset.y * dv, sample);
        const w = tap.weight;
        r += sample[0] * w;
        g += sample[1] * w;
        b += sample[2] * w;
        a += sample[3] * w;
      }
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = a;
    }
  }
  return out;
}
