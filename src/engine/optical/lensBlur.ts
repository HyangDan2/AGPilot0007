import type { MaskData } from '../contracts/masks';
import { composeMaskStack } from '../local/maskRaster';

/**
 * Lens blur engine (CP4-02). The depth model is an artist-controlled thin-lens
 * approximation, not a physical lens simulation: focusPlane/focusRange select a
 * band in a normalized depth field and the aperture f-number drives the circle
 * of confusion. No depth estimation model is used. When no manual depth mask is
 * provided the depth field is the PoC radial field (center 0, farthest corner 1).
 */

// Temporary mirror of contracts/lensBlur.ts §2.2 until CP4-01a lands on
// pro-engine; Q01 owns the contract and these shapes were proposed for it.
export interface DepthMaskGroup {
  id: string;
  name: string;
  enabled: boolean;
  masks: MaskData[];
}

export type LensBlurQuality = 'preview' | 'export';

export interface LensBlurState {
  enabled: boolean;
  focusPlane: number;
  focusRange: number;
  aperture: number;
  bladeCount: number;
  rotationDeg: number;
  quality: LensBlurQuality;
  highlightBoost: number;
  depthMask: DepthMaskGroup[] | null;
}

export interface LensBlurCapability {
  maxTextureSize: number;
  maxTaps?: number;
  supportsFloatLinear?: boolean;
}

export interface ApertureShape {
  blades: number;
  rotation: number;
  roundness: number;
}

export interface PsfTap {
  offset: { x: number; y: number };
  weight: number;
}

export interface LensBlurPlan {
  quality: LensBlurQuality;
  outputWidth: number;
  outputHeight: number;
  /** Gather resolution; preview uses half resolution before the upscale pass. */
  width: number;
  height: number;
  halfRes: boolean;
  aperture: ApertureShape;
  focusPlane: number;
  focusRange: number;
  falloff: number;
  maxCocShortSide: number;
  maxCocPx: number;
  taps: PsfTap[];
  tapCount: number;
  /** 64x1 RGBA32F texels: xy offset in CoC units, z weight, w unused. */
  psf: Float32Array;
  /** Render-resolution normalized depth when a manual depth mask is active. */
  depth: Float32Array | null;
  guardBand: number;
  guardStrength: number;
  highlightBoost: number;
}

// f/1 defocus proxy in short-side units. CoC falls as 1/N, so wide apertures
// blur strongly and f/22 is nearly sharp without a physical sensor model.
export const MAX_COC_AT_F1 = 0.08;
export const PSF_TEXTURE_WIDTH = 64;
export const MAX_TAPS = 64;
export const DEPTH_GUARD_BAND = 0.08;
export const DEPTH_GUARD_STRENGTH = 1;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const EPSILON = 1e-6;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 - edge0 <= EPSILON) return value >= edge1 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function normalizeLensBlurState(value: Partial<LensBlurState> = {}): LensBlurState {
  const rotationDeg = finite(value.rotationDeg, 0);
  return {
    enabled: value.enabled === true,
    focusPlane: clamp(finite(value.focusPlane, 0.5), 0, 1),
    focusRange: clamp(finite(value.focusRange, 0.2), 0, 1),
    aperture: clamp(finite(value.aperture, 2.8), 1, 22),
    bladeCount: Math.round(clamp(finite(value.bladeCount, 6), 5, 9)),
    rotationDeg: ((((rotationDeg + 180) % 360) + 360) % 360) - 180,
    quality: value.quality === 'export' ? 'export' : 'preview',
    highlightBoost: clamp(finite(value.highlightBoost, 0), 0, 2),
    depthMask: Array.isArray(value.depthMask) ? value.depthMask : null,
  };
}

export function isNeutralLensBlur(state: LensBlurState): boolean {
  return !state.enabled;
}

export function apertureFromState(state: LensBlurState): ApertureShape {
  return {
    blades: Math.round(clamp(state.bladeCount, 5, 9)),
    rotation: (state.rotationDeg * Math.PI) / 180,
    roundness: 0,
  };
}

export function lensBlurMaxCoc(aperture: number): number {
  return MAX_COC_AT_F1 / clamp(aperture, 1, 22);
}

export function focusFalloff(focusRange: number): number {
  return Math.max(0.05, (1 - clamp(focusRange, 0, 1)) / 2);
}

function polygonRadius(theta: number, blades: number, rotation: number): number {
  if (blades < 3) return 1;
  const sector = (2 * Math.PI) / blades;
  let local = (theta - rotation) % sector;
  if (local < 0) local += sector;
  return Math.cos(Math.PI / blades) / Math.cos(local - Math.PI / blades);
}

function insideAperture(theta: number, radius: number, aperture: ApertureShape): boolean {
  const roundness = clamp(aperture.roundness, 0, 1);
  const limit = roundness + (1 - roundness) * polygonRadius(theta, aperture.blades, aperture.rotation);
  return radius <= limit;
}

/**
 * Deterministic area-uniform golden-angle samples filtered by the aperture
 * polygon. Offsets are in unit CoC radius; the surviving weights sum to one.
 */
export function apertureTapWeights(aperture: ApertureShape, taps = MAX_TAPS): PsfTap[] {
  const count = Math.max(1, Math.min(MAX_TAPS, Math.floor(taps)));
  const offsets: PsfTap[] = [];
  for (let index = 0; index < count; index++) {
    const radius = Math.sqrt((index + 0.5) / count);
    const theta = index * GOLDEN_ANGLE;
    if (!insideAperture(theta, radius, aperture)) continue;
    offsets.push({ offset: { x: radius * Math.cos(theta), y: radius * Math.sin(theta) }, weight: 1 });
  }
  if (offsets.length === 0) return [{ offset: { x: 0, y: 0 }, weight: 1 }];
  const norm = 1 / offsets.length;
  for (const tap of offsets) tap.weight = norm;
  return offsets;
}

/** Packs taps into the 64x1 RGBA32F texture consumed by the gather shader. */
export function psfTextureData(taps: readonly PsfTap[]): Float32Array {
  if (taps.length > PSF_TEXTURE_WIDTH) {
    throw new Error(`Lens blur PSF supports at most ${PSF_TEXTURE_WIDTH} taps`);
  }
  const data = new Float32Array(PSF_TEXTURE_WIDTH * 4);
  taps.forEach((tap, index) => {
    data[index * 4] = tap.offset.x;
    data[index * 4 + 1] = tap.offset.y;
    data[index * 4 + 2] = tap.weight;
  });
  return data;
}

/** Short-side normalized radial depth: 0 at center, 1 at the farthest corner. */
export function proceduralDepth(x: number, y: number, width: number, height: number): number {
  const shortSide = Math.min(width, height);
  if (shortSide <= 0) return 0;
  const sx = (x - 0.5) * (width / shortSide);
  const sy = (y - 0.5) * (height / shortSide);
  const maxRadius = 0.5 * Math.hypot(width / shortSide, height / shortSide);
  return clamp(Math.hypot(sx, sy) / maxRadius, 0, 1);
}

export function circleOfConfusion(depth: number, state: LensBlurState): number {
  const range = clamp(state.focusRange, 0, 1);
  const delta = Math.abs(depth - clamp(state.focusPlane, 0, 1)) - range / 2;
  const t = smoothstep(0, 1, delta / focusFalloff(range));
  return lensBlurMaxCoc(state.aperture) * t;
}

export type BokehQuality = LensBlurQuality;

/**
 * Tap budget policy ported from the PoC: circles of confusion cross
 * domain-equivalent pixel radii, so the tier follows CoC pixels at the gather
 * resolution rather than output size. CoC < 0.75px is an exact identity.
 */
export function suggestTaps(
  maxCocShortSide: number,
  shortSidePx: number,
  quality: BokehQuality = 'export',
): number {
  const cocPx = Math.max(0, maxCocShortSide) * Math.max(1, shortSidePx);
  if (!(cocPx >= 0.75)) return 0;
  const preview = quality === 'preview';
  if (cocPx < 6) return preview ? 12 : 24;
  if (cocPx < 20) return preview ? 20 : 40;
  return preview ? 32 : 64;
}

function isGeometricMask(mask: MaskData): boolean {
  return mask.kind === 'brush' || mask.kind === 'linear' || mask.kind === 'radial';
}

/**
 * Depth mask coverage is the depth field itself (0 near, 1 far). Groups are
 * unioned by maximum so painted areas accumulate regardless of paint order.
 * Luminance/color masks need corrected pixels and are rejected here; depth
 * masks are painted with geometric masks.
 */
export function rasterizeDepthMask(
  groups: readonly DepthMaskGroup[] | null,
  width: number,
  height: number,
): Float32Array | null {
  const active = (groups ?? []).filter((group) => group.enabled);
  if (active.length === 0) return null;
  for (const group of active) {
    for (const mask of group.masks) {
      if (mask.enabled && !isGeometricMask(mask)) {
        throw new Error('Depth masks support brush, linear and radial masks only');
      }
    }
  }
  let depth: Float32Array | null = null;
  for (const group of active) {
    const coverage = composeMaskStack(group.masks, width, height);
    if (!depth) {
      depth = coverage;
      continue;
    }
    for (let index = 0; index < coverage.length; index++) {
      if (coverage[index] > depth[index]) depth[index] = coverage[index];
    }
  }
  return depth;
}

function renderSize(
  outputWidth: number,
  outputHeight: number,
  halfRes: boolean,
  maxTextureSize: number,
): { width: number; height: number } {
  const scale = halfRes ? 0.5 : 1;
  let width = Math.max(1, Math.round(outputWidth * scale));
  let height = Math.max(1, Math.round(outputHeight * scale));
  if (width > maxTextureSize || height > maxTextureSize) {
    const fit = Math.min(maxTextureSize / width, maxTextureSize / height);
    width = Math.max(1, Math.floor(width * fit));
    height = Math.max(1, Math.floor(height * fit));
  }
  return { width, height };
}

/**
 * Frozen CP4-02 seam: returns null when the stage is inert (disabled, exact
 * identity CoC, or a budget clamped to zero), so the renderer keeps the
 * unmodified path and neutral output stays byte-equal.
 */
export function planLensBlur(
  state: LensBlurState,
  outputSize: { width: number; height: number },
  capability: LensBlurCapability,
): LensBlurPlan | null {
  const { width: outputWidth, height: outputHeight } = outputSize;
  if (
    !Number.isInteger(outputWidth) ||
    !Number.isInteger(outputHeight) ||
    outputWidth <= 0 ||
    outputHeight <= 0
  ) {
    throw new Error('Invalid lens blur output size');
  }
  const maxTextureSize = Math.floor(finite(capability?.maxTextureSize, 0));
  if (maxTextureSize <= 0) throw new Error('Invalid lens blur capability');
  if (isNeutralLensBlur(state)) return null;

  const normalized = normalizeLensBlurState(state);
  const aperture = apertureFromState(normalized);
  const maxCocShortSide = lensBlurMaxCoc(normalized.aperture);
  const maxDepthDelta = Math.max(normalized.focusPlane, 1 - normalized.focusPlane) - normalized.focusRange / 2;
  if (maxDepthDelta <= 0) return null;
  const halfRes = normalized.quality === 'preview';
  const { width, height } = renderSize(outputWidth, outputHeight, halfRes, maxTextureSize);
  const shortSidePx = Math.min(width, height);
  const maxCocPx = maxCocShortSide * shortSidePx;

  let budget = suggestTaps(maxCocShortSide, shortSidePx, normalized.quality);
  if (capability.maxTaps !== undefined) {
    budget = Math.min(budget, Math.max(0, Math.floor(finite(capability.maxTaps, 0))));
  }
  if (budget < 2) return null;

  const taps = apertureTapWeights(aperture, budget);
  if (taps.length < 2) return null;

  return {
    quality: normalized.quality,
    outputWidth,
    outputHeight,
    width,
    height,
    halfRes,
    aperture,
    focusPlane: normalized.focusPlane,
    focusRange: normalized.focusRange,
    falloff: focusFalloff(normalized.focusRange),
    maxCocShortSide,
    maxCocPx,
    taps,
    tapCount: taps.length,
    psf: psfTextureData(taps),
    depth: rasterizeDepthMask(normalized.depthMask, width, height),
    guardBand: DEPTH_GUARD_BAND,
    guardStrength: DEPTH_GUARD_STRENGTH,
    highlightBoost: normalized.highlightBoost,
  };
}

function sampleBilinear(
  src: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number,
  out: number[],
): void {
  const x = clamp(u * width - 0.5, 0, width - 1);
  const y = clamp(v * height - 0.5, 0, height - 1);
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

function depthAt(
  depth: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number,
): number {
  const x = clamp(u * width - 0.5, 0, width - 1);
  const y = clamp(v * height - 0.5, 0, height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = depth[y0 * width + x0] * (1 - fx) + depth[y0 * width + x1] * fx;
  const bottom = depth[y1 * width + x0] * (1 - fx) + depth[y1 * width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * CPU reference gather. Pixels with effectively zero CoC are copied exactly so
 * the identity path is bit-stable. The depth-discontinuity guard down-weights
 * taps whose depth differs from the center pixel, which suppresses the colored
 * halos a plain gather produces across foreground/background edges.
 */
export function blurRgbaReference(
  src: Float32Array,
  width: number,
  height: number,
  plan: LensBlurPlan,
  options: { guard?: boolean } = {},
): Float32Array {
  if (src.length !== width * height * 4) throw new Error('RGBA buffer size mismatch');
  if (width !== plan.width || height !== plan.height) throw new Error('Lens plan size mismatch');
  const useGuard = options.guard !== false && plan.guardStrength > 0;
  const aspect = width / height;
  const scaleU = Math.max(1, aspect);
  const scaleV = Math.max(1, 1 / aspect);
  const guardBand = Math.max(plan.guardBand, 1e-4);
  const boost = plan.highlightBoost;
  const out = new Float32Array(src.length);
  const sample = [0, 0, 0, 0];

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const index = (y * width + x) * 4;
      const centerDepth = plan.depth
        ? plan.depth[y * width + x]
        : proceduralDepth(u, v, width, height);
      const coc = focusCoc(centerDepth, plan);
      if (coc < 1e-5) {
        out[index] = src[index];
        out[index + 1] = src[index + 1];
        out[index + 2] = src[index + 2];
        out[index + 3] = src[index + 3];
        continue;
      }
      const du = coc / scaleU;
      const dv = coc / scaleV;
      let r = 0;
      let g = 0;
      let b = 0;
      let total = 0;
      for (const tap of plan.taps) {
        const su = u + tap.offset.x * du;
        const sv = v + tap.offset.y * dv;
        sampleBilinear(src, width, height, su, sv, sample);
        let weight = tap.weight;
        if (useGuard && plan.depth) {
          const tapDepth = depthAt(plan.depth, width, height, su, sv);
          weight *= 1 - plan.guardStrength * smoothstep(guardBand * 0.5, guardBand, Math.abs(tapDepth - centerDepth));
        }
        if (boost > 0) {
          const luma = 0.2126 * sample[0] + 0.7152 * sample[1] + 0.0722 * sample[2];
          weight *= 1 + boost * luma * luma * luma * luma;
        }
        r += sample[0] * weight;
        g += sample[1] * weight;
        b += sample[2] * weight;
        total += weight;
      }
      if (total <= EPSILON) {
        out[index] = src[index];
        out[index + 1] = src[index + 1];
        out[index + 2] = src[index + 2];
      } else {
        out[index] = r / total;
        out[index + 1] = g / total;
        out[index + 2] = b / total;
      }
      out[index + 3] = src[index + 3];
    }
  }
  return out;
}

function focusCoc(depth: number, plan: LensBlurPlan): number {
  const delta = Math.abs(depth - plan.focusPlane) - plan.focusRange / 2;
  return plan.maxCocShortSide * smoothstep(0, 1, delta / plan.falloff);
}

/**
 * GLSL ES 3.00 gather. Bind u_q02_lens_scene to the graded corrected image,
 * u_q02_lens_psf to the plan.psf 64x1 RGBA32F texture and (when the plan has a
 * depth map) u_q02_lens_depth to an R32F/FLOAT texture of plan.depth; set
 * u_q02_lens_use_depth = 1 in that case, 0 for the procedural radial field.
 * UVs are in the scene texture's space (no y flip inside the chunk).
 */
export const LENS_BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D u_q02_lens_scene;
uniform sampler2D u_q02_lens_psf;
uniform sampler2D u_q02_lens_depth;
uniform int u_q02_lens_taps;
uniform int u_q02_lens_use_depth;
uniform float u_q02_lens_aspect;
uniform float u_q02_lens_focus_plane;
uniform float u_q02_lens_focus_range;
uniform float u_q02_lens_falloff;
uniform float u_q02_lens_max_coc;
uniform vec4 u_q02_lens_guard;
uniform float u_q02_lens_highlight_boost;

float q02_lens_depth(vec2 uv) {
  if (u_q02_lens_use_depth == 1) return texture(u_q02_lens_depth, uv).r;
  vec2 scale = vec2(max(1.0, u_q02_lens_aspect), max(1.0, 1.0 / u_q02_lens_aspect));
  vec2 p = (uv - 0.5) * scale;
  float maxRadius = 0.5 * length(scale);
  return clamp(length(p) / maxRadius, 0.0, 1.0);
}

float q02_lens_coc(float depth) {
  float delta = abs(depth - u_q02_lens_focus_plane) - u_q02_lens_focus_range * 0.5;
  return u_q02_lens_max_coc * smoothstep(0.0, 1.0, delta / u_q02_lens_falloff);
}

vec3 q02_lens_blur(vec3 color, vec2 uv) {
  if (u_q02_lens_taps < 2) return color;
  float centerDepth = q02_lens_depth(uv);
  float coc = q02_lens_coc(centerDepth);
  if (coc < 1e-5) return color;
  vec2 scale = vec2(max(1.0, u_q02_lens_aspect), max(1.0, 1.0 / u_q02_lens_aspect));
  vec2 step_uv = coc / scale;
  float band = max(u_q02_lens_guard.x, 1e-4);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= u_q02_lens_taps) break;
    vec4 tap = texelFetch(u_q02_lens_psf, ivec2(i, 0), 0);
    vec2 suv = uv + tap.xy * step_uv;
    vec3 sampled = texture(u_q02_lens_scene, suv).rgb;
    float weight = tap.z;
    if (u_q02_lens_guard.y > 0.0 && u_q02_lens_use_depth == 1) {
      float tapDepth = texture(u_q02_lens_depth, suv).r;
      weight *= 1.0 - u_q02_lens_guard.y * smoothstep(band * 0.5, band, abs(tapDepth - centerDepth));
    }
    if (u_q02_lens_highlight_boost > 0.0) {
      float luma = dot(sampled, vec3(0.2126, 0.7152, 0.0722));
      float boosted = luma * luma;
      weight *= 1.0 + u_q02_lens_highlight_boost * boosted * boosted;
    }
    sum += sampled * weight;
    total += weight;
  }
  return total > 0.0 ? sum / total : color;
}
`;
