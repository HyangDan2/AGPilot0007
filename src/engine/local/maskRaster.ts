import {
  MAX_LOCAL_GROUPS,
  localAdjustmentsActive,
  type LocalAdjustmentState,
  type LocalAdjustmentValues,
} from '../contracts/localAdjustments';
import type { MaskBlend, MaskData } from '../contracts/masks';

export interface LocalStageGroup {
  adjustment: LocalAdjustmentValues;
  opacity: number;
  blend: MaskBlend;
}

export interface LocalStagePlan {
  width: number;
  height: number;
  groups: LocalStageGroup[];
  /** One canvas per group, index-aligned; group coverage lives in RGB. */
  masks: HTMLCanvasElement[];
}

export interface CorrectedPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const EPSILON = 1e-9;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (Math.abs(edge1 - edge0) <= EPSILON) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Short-side normalized, centered coordinates so radii stay round. */
function toShortSide(x: number, y: number, width: number, height: number): { x: number; y: number } {
  const shortSide = Math.min(width, height);
  return { x: (x - 0.5) * (width / shortSide), y: (y - 0.5) * (height / shortSide) };
}

function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(px - ax, py - ay);
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / lengthSquared);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function brushStrokeCoverage(
  mask: Extract<MaskData, { kind: 'brush' }>,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const point = toShortSide(x, y, width, height);
  let coverage = 0;
  for (const stroke of mask.strokes) {
    const radius = stroke.radius;
    if (radius <= 0) continue;
    const inner = radius * stroke.hardness;
    let best = 0;
    const points = stroke.points.map((p) => toShortSide(p.x, p.y, width, height));
    if (points.length === 1) {
      best = 1 - smoothstep(inner, radius, Math.hypot(point.x - points[0].x, point.y - points[0].y));
    } else {
      for (let index = 1; index < points.length; index++) {
        const distance = segmentDistance(
          point.x,
          point.y,
          points[index - 1].x,
          points[index - 1].y,
          points[index].x,
          points[index].y,
        );
        const value = 1 - smoothstep(inner, radius, distance);
        if (value > best) best = value;
      }
    }
    const stamp = best * stroke.flow;
    coverage = coverage + stamp - coverage * stamp;
  }
  return clamp01(coverage);
}

function linearCoverage(
  mask: Extract<MaskData, { kind: 'linear' }>,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const start = toShortSide(mask.start.x, mask.start.y, width, height);
  const end = toShortSide(mask.end.x, mask.end.y, width, height);
  const point = toShortSide(x, y, width, height);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared <= EPSILON
      ? 0
      : ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const feather = Math.max(0, mask.feather);
  if (feather <= EPSILON) return t >= 0.5 ? 1 : 0;
  return smoothstep(0.5 - feather / 2, 0.5 + feather / 2, t);
}

function radialCoverage(
  mask: Extract<MaskData, { kind: 'radial' }>,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const center = toShortSide(mask.center.x, mask.center.y, width, height);
  const point = toShortSide(x, y, width, height);
  const radians = (mask.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const localX = (cos * dx + sin * dy) / mask.radiusX;
  const localY = (-sin * dx + cos * dy) / mask.radiusY;
  const distance = Math.hypot(localX, localY);
  const inner = 1 - Math.max(0, mask.feather);
  return 1 - smoothstep(inner, 1, distance);
}

function luminanceAt(pixels: CorrectedPixels, index: number): number {
  const offset = index * 4;
  const data = pixels.data;
  return (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
}

function luminanceCoverage(
  mask: Extract<MaskData, { kind: 'luminance' }>,
  pixels: CorrectedPixels,
  index: number,
): number {
  const luminance = luminanceAt(pixels, index);
  const feather = Math.max(0, mask.feather) / 2;
  const low = smoothstep(mask.lo - feather, mask.lo + feather, luminance);
  const high = 1 - smoothstep(mask.hi - feather, mask.hi + feather, luminance);
  return clamp01(low * high);
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > EPSILON) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max <= EPSILON ? 0 : delta / max, v: max };
}

function colorCoverage(
  mask: Extract<MaskData, { kind: 'color' }>,
  pixels: CorrectedPixels,
  index: number,
): number {
  const offset = index * 4;
  const data = pixels.data;
  const pixel = rgbToHsv(data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255);
  const target = rgbToHsv(mask.color.r, mask.color.g, mask.color.b);

  const hueDelta = Math.min(Math.abs(pixel.h - target.h), 360 - Math.abs(pixel.h - target.h));
  const feather = Math.max(0, mask.feather);
  const band = (range: number, delta: number): number => {
    if (range <= EPSILON) return delta <= EPSILON ? 1 : 0;
    if (feather <= EPSILON) return delta <= range ? 1 : 0;
    return 1 - smoothstep(range * (1 - feather), range, delta);
  };

  return (
    band(mask.hueRange, hueDelta) *
    band(Math.max(mask.satRange, EPSILON), Math.abs(pixel.s - target.s)) *
    band(Math.max(mask.lumRange, EPSILON), Math.abs(pixel.v - target.v))
  );
}

/**
 * Rasterizes one mask to coverage (0..1) at the requested resolution. Radii,
 * feather, and stroke distance use short-side normalized units, so preview and
 * export produce identical coverage shapes at different pixel sizes.
 */
export function rasterizeMask(
  mask: MaskData,
  width: number,
  height: number,
  pixels?: CorrectedPixels,
): Float32Array {
  const coverage = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const ny = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5) / width;
      const index = y * width + x;
      let value = 0;
      switch (mask.kind) {
        case 'brush':
          value = brushStrokeCoverage(mask, nx, ny, width, height);
          break;
        case 'linear':
          value = linearCoverage(mask, nx, ny, width, height);
          break;
        case 'radial':
          value = radialCoverage(mask, nx, ny, width, height);
          break;
        case 'luminance':
          if (!pixels) throw new Error('Luminance masks require corrected pixels');
          value = luminanceCoverage(mask, pixels, index);
          break;
        case 'color':
          if (!pixels) throw new Error('Color masks require corrected pixels');
          value = colorCoverage(mask, pixels, index);
          break;
        default:
          value = 0;
      }
      coverage[index] = clamp01(mask.inverted ? 1 - value : value);
    }
  }
  return coverage;
}

/** Composes a mask stack in array order with add/subtract/intersect and opacity. */
export function composeMaskStack(
  masks: readonly MaskData[],
  width: number,
  height: number,
  pixels?: CorrectedPixels,
): Float32Array {
  const result = new Float32Array(width * height);
  for (const mask of masks) {
    if (!mask.enabled) continue;
    const coverage = rasterizeMask(mask, width, height, pixels);
    const opacity = clamp01(mask.opacity);
    for (let index = 0; index < coverage.length; index++) {
      const value = coverage[index] * opacity;
      const base = result[index];
      switch (mask.blend) {
        case 'subtract':
          result[index] = base * (1 - value);
          break;
        case 'intersect':
          result[index] = base * value;
          break;
        default:
          result[index] = base + value - base * value;
      }
    }
  }
  return result;
}

function createRasterCanvas(width: number, height: number, coverage: Float32Array): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Local stage requires a 2D canvas context');
  const image = context.createImageData(width, height);
  for (let index = 0; index < coverage.length; index++) {
    const value = Math.round(clamp01(coverage[index]) * 255);
    const offset = index * 4;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function readCorrectedPixels(
  corrected: CanvasImageSource,
  width: number,
  height: number,
): CorrectedPixels {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Local stage requires a 2D canvas context');
  context.drawImage(corrected, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  return { data: image.data, width, height };
}

function needsPixels(masks: readonly MaskData[]): boolean {
  return masks.some(
    (mask) => mask.enabled && (mask.kind === 'luminance' || mask.kind === 'color'),
  );
}

/**
 * Frozen CP3 seam: builds the local stage plan at the requested size. Returns
 * null when the stage is inactive so the renderer keeps the CP2 path.
 */
export function planLocalStage(input: {
  state: LocalAdjustmentState;
  width: number;
  height: number;
  corrected: CanvasImageSource;
}): LocalStagePlan | null {
  const { state, width, height, corrected } = input;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid local stage dimensions');
  }
  if (!localAdjustmentsActive(state)) return null;
  const activeGroups = state.groups.filter((group) => group.enabled);
  if (activeGroups.length === 0) return null;
  if (activeGroups.length > MAX_LOCAL_GROUPS) {
    throw new Error(`Too many local adjustment groups (max ${MAX_LOCAL_GROUPS})`);
  }

  const pixelsNeeded = activeGroups.some((group) => needsPixels(group.masks));
  const pixels = pixelsNeeded ? readCorrectedPixels(corrected, width, height) : undefined;

  const groups: LocalStageGroup[] = [];
  const masks: HTMLCanvasElement[] = [];
  for (const group of activeGroups) {
    const coverage = composeMaskStack(group.masks, width, height, pixels);
    groups.push({
      adjustment: { ...group.adjustment },
      opacity: clamp01(group.opacity),
      blend: group.blend,
    });
    masks.push(createRasterCanvas(width, height, coverage));
  }
  return { width, height, groups, masks };
}

export interface LocalStageAdjustmentUniforms {
  a: [number, number, number, number];
  b: [number, number, number, number];
  c: [number, number, number, number];
}

/** First texture unit owned by the local stage (image 0, LUT 1, date 2, curves 3, detail 4). */
export const LOCAL_STAGE_TEXTURE_BASE = 5;

export interface LocalStageTextureBudget {
  base: number;
  groupLimit: number;
}

/**
 * Groups the renderer may bind without exceeding the device texture limit.
 * Planning still produces every active group; the renderer clamps binding.
 */
export function localStageTextureBudget(maxTextureImageUnits: number): LocalStageTextureBudget {
  const units = Number.isFinite(maxTextureImageUnits) ? Math.floor(maxTextureImageUnits) : 0;
  return {
    base: LOCAL_STAGE_TEXTURE_BASE,
    groupLimit: Math.max(0, Math.min(MAX_LOCAL_GROUPS, units - LOCAL_STAGE_TEXTURE_BASE)),
  };
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sortObjectKeys(source[key]);
    return sorted;
  }
  return value;
}

/**
 * Deterministic key for renderer-side plan caching (state + output size).
 * Call on state changes, not per frame; returns null when the stage is inert.
 */
export function localStageCacheKey(state: LocalAdjustmentState): string | null {
  if (!localAdjustmentsActive(state)) return null;
  const groups = state.groups
    .filter((group) => group.enabled)
    .map((group) => ({
      id: group.id,
      opacity: group.opacity,
      blend: group.blend,
      adjustment: group.adjustment,
      masks: group.masks.filter((mask) => mask.enabled),
    }));
  return JSON.stringify(sortObjectKeys(groups));
}

/** Maps a group's adjustment values to the three vec4 uniform slots. */
export function localStageAdjustmentUniforms(values: LocalAdjustmentValues): LocalStageAdjustmentUniforms {
  return {
    a: [values.exposure ?? 0, values.contrast ?? 0, values.highlights ?? 0, values.shadows ?? 0],
    b: [values.whites ?? 0, values.blacks ?? 0, values.temperature ?? 0, values.tint ?? 0],
    c: [values.saturation ?? 0, values.grain ?? 0, values.sharpness ?? 0, values.vignette ?? 0],
  };
}

/** 0 = add, 1 = subtract, 2 = intersect; matches the GLSL blend branches. */
export function localStageBlendCode(blend: MaskBlend): 0 | 1 | 2 {
  if (blend === 'subtract') return 1;
  if (blend === 'intersect') return 2;
  return 0;
}

const LOCAL_GROUP_BODY = (index: number): string => `
  if (u_q02_local_group_count > ${index}) {
    float coverage = texture(u_q02_local_masks[${index}], uv).r
                   * u_q02_local_group_opacity[${index}];
    if (coverage > 0.0) {
      vec3 adjusted = q02_local_adjust(result, uv, edge, ${index});
      int blend = u_q02_local_group_blend[${index}];
      if (blend == 1) {
        result = mix(adjusted, result, coverage);
      } else if (blend == 2) {
        result = mix(result, adjusted, smoothstep(0.5, 1.0, coverage));
      } else {
        result = mix(result, adjusted, coverage);
      }
    }
  }`;

/**
 * GLSL ES 3.00 local stage. Group coverage is sampled from RGB canvases (red
 * channel); adjustments apply in corrected NIS after Color Lab and before
 * detail. Sampler indices are unrolled constants for driver compatibility;
 * the renderer binds the plan canvases starting at texture unit 5 (Q00 ruling).
 */
export const LOCAL_STAGE_FRAGMENT = /* glsl */ `
uniform sampler2D u_q02_local_masks[${MAX_LOCAL_GROUPS}];
uniform int u_q02_local_group_count;
uniform float u_q02_local_group_opacity[${MAX_LOCAL_GROUPS}];
uniform int u_q02_local_group_blend[${MAX_LOCAL_GROUPS}];
uniform vec4 u_q02_local_adjust_a[${MAX_LOCAL_GROUPS}];
uniform vec4 u_q02_local_adjust_b[${MAX_LOCAL_GROUPS}];
uniform vec4 u_q02_local_adjust_c[${MAX_LOCAL_GROUPS}];

float q02_local_hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 q02_local_adjust(vec3 color, vec2 uv, float edge, int i) {
  float exposure = u_q02_local_adjust_a[i].x;
  float contrast = u_q02_local_adjust_a[i].y;
  float highlights = u_q02_local_adjust_a[i].z;
  float shadows = u_q02_local_adjust_a[i].w;
  float whites = u_q02_local_adjust_b[i].x;
  float blacks = u_q02_local_adjust_b[i].y;
  float temperature = u_q02_local_adjust_b[i].z;
  float tint = u_q02_local_adjust_b[i].w;
  float saturation = u_q02_local_adjust_c[i].x;
  float grain = u_q02_local_adjust_c[i].y;
  float sharpness = u_q02_local_adjust_c[i].z;
  float vignette = u_q02_local_adjust_c[i].w;

  vec3 result = color * exp2(exposure);
  float luma = dot(result, vec3(0.2126, 0.7152, 0.0722));

  result = (result - 0.5) * max(0.0, 1.0 + contrast / 100.0) + 0.5;
  result += (highlights / 100.0) * luma * luma * 0.5;
  result -= (shadows / 100.0) * (1.0 - luma) * 0.5;
  result += (whites / 100.0) * (luma - 0.5) * 0.25;
  result -= (blacks / 100.0) * (luma - 0.5) * 0.25;

  result.r += temperature / 1000.0;
  result.b -= temperature / 1000.0;
  result.g += tint / 1000.0;

  float gray = dot(result, vec3(0.2126, 0.7152, 0.0722));
  result = mix(vec3(gray), result, max(0.0, 1.0 + saturation / 100.0));

  if (abs(sharpness) > 0.001) {
    result += edge * (sharpness / 400.0);
  }
  if (abs(grain) > 0.001) {
    float noise = q02_local_hash(uv * 1024.0) - 0.5;
    result += noise * (grain / 100.0) * 0.25;
  }
  if (abs(vignette) > 0.001) {
    vec2 centered = uv * 2.0 - 1.0;
    float falloff = smoothstep(0.4, 1.2, length(centered));
    result *= 1.0 - (vignette / 100.0) * falloff;
  }

  return clamp(result, 0.0, 1.0);
}

vec3 q02_local_stage(vec3 color, vec2 uv) {
  float grayIn = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float edge = dFdx(grayIn) + dFdy(grayIn);
  vec3 result = color;${Array.from({ length: MAX_LOCAL_GROUPS }, (_, index) => LOCAL_GROUP_BODY(index)).join('')}
  return result;
}
`;
