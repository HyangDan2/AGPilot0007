import {
  isNeutralLensBlur,
  normalizeLensBlur,
  type LensBlurCapability,
  type LensBlurPlan,
  type LensBlurState,
} from '../contracts/lensBlur';
import {
  DEPTH_GUARD_BAND,
  DEPTH_GUARD_STRENGTH,
  MAX_TAPS,
  apertureFromState,
  apertureTapWeights,
  focusFalloff,
  lensBlurMaxCoc,
  psfTextureData,
  rasterizeDepthMaskRegion,
  suggestTaps,
  type PsfTap,
} from './lensBlur';

/** Preferred lens tile core edge; halo grows the rendered crop around it. */
export const LENS_TILE_CORE_EDGE = 4096;
export const MIN_LENS_TILE_EDGE = 256;
/** Conservative per-pixel GPU footprint: RGBA8 tile + RGBA16F lens target + R32F depth. */
export const GPU_BYTES_PER_TILE_PIXEL = 16;

export interface LensTileRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LensTile {
  /** Non-overlapping output rect. */
  core: LensTileRegion;
  /** Core plus gather halo, clamped to the frame. */
  crop: LensTileRegion;
}

export interface LensTileGrid {
  columns: number;
  rows: number;
  coreEdge: number;
  halo: number;
  tiles: LensTile[];
}

/** Full-frame lens inputs shared by every tile; no depth array is allocated. */
export interface LensTileTemplate {
  state: LensBlurState;
  aperture: number;
  focusPlane: number;
  focusRange: number;
  falloff: number;
  maxCocShortSide: number;
  /** Maximum gather radius in full-frame pixels. */
  maxCocPx: number;
  taps: PsfTap[];
  psf: Float32Array;
  halo: number;
  /** False when the single-pass plan would run the unguarded procedural field. */
  paintedDepth: boolean;
}

function assertDimension(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${label} dimensions`);
}

/**
 * Tiles a frame into non-overlapping cores, each rendered with a crop grown by
 * the gather halo so a core pixel never samples outside its crop.
 */
export function planLensTiles(
  frameWidth: number,
  frameHeight: number,
  coreEdge: number,
  halo: number,
): LensTileGrid {
  assertDimension(frameWidth, 'lens tile frame');
  assertDimension(frameHeight, 'lens tile frame');
  const edge = Math.max(MIN_LENS_TILE_EDGE, Math.floor(coreEdge));
  const pad = Math.max(0, Math.ceil(halo));
  const xStarts: number[] = [];
  for (let x = 0; x < frameWidth; x += edge) xStarts.push(x);
  const yStarts: number[] = [];
  for (let y = 0; y < frameHeight; y += edge) yStarts.push(y);
  const tiles: LensTile[] = [];
  for (const y of yStarts) {
    for (const x of xStarts) {
      const width = Math.min(edge, frameWidth - x);
      const height = Math.min(edge, frameHeight - y);
      const cropX = Math.max(0, x - pad);
      const cropY = Math.max(0, y - pad);
      const cropRight = Math.min(frameWidth, x + width + pad);
      const cropBottom = Math.min(frameHeight, y + height + pad);
      tiles.push({
        core: { x, y, width, height },
        crop: { x: cropX, y: cropY, width: cropRight - cropX, height: cropBottom - cropY },
      });
    }
  }
  return {
    columns: xStarts.length,
    rows: yStarts.length,
    coreEdge: edge,
    halo: pad,
    tiles,
  };
}

/**
 * Builds the frame-global tap/CoC template. Mirrors `planLensBlur` policy at
 * export quality but never rasterizes the frame; null when the blur is inert.
 */
export function createLensTileTemplate(
  state: LensBlurState,
  frameSize: { width: number; height: number },
  capability: LensBlurCapability,
): LensTileTemplate | null {
  const { width, height } = frameSize;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid lens blur output size');
  }
  const maxTextureSize = Math.floor(capability?.maxTextureSize ?? 0);
  if (!(maxTextureSize > 0)) throw new Error('Invalid lens blur capability');
  const normalized = normalizeLensBlur({ ...state, quality: 'export' });
  if (isNeutralLensBlur(normalized)) return null;
  const aperture = apertureFromState(normalized);
  const maxCocShortSide = lensBlurMaxCoc(normalized.aperture);
  const maxDepthDelta = Math.max(normalized.focusPlane, 1 - normalized.focusPlane) - normalized.focusRange / 2;
  if (maxDepthDelta <= 0) return null;
  const shortSidePx = Math.min(width, height);
  let budget = suggestTaps(maxCocShortSide, shortSidePx, 'export');
  if (capability.maxTaps !== undefined) {
    budget = Math.min(budget, Math.max(0, Math.floor(Number.isFinite(capability.maxTaps) ? capability.maxTaps : 0)));
  }
  if (budget < 2) return null;
  const taps = apertureTapWeights(aperture, budget);
  if (taps.length < 2) return null;
  let maxTapRadius = 0;
  for (const tap of taps) maxTapRadius = Math.max(maxTapRadius, Math.hypot(tap.offset.x, tap.offset.y));
  const maxCocPx = maxCocShortSide * shortSidePx;
  const paintedDepth = !!normalized.depthMask && normalized.depthMask.some((mask) => mask.enabled);
  return {
    state: normalized,
    aperture: normalized.aperture,
    focusPlane: normalized.focusPlane,
    focusRange: normalized.focusRange,
    falloff: focusFalloff(normalized.focusRange),
    maxCocShortSide,
    maxCocPx,
    taps,
    psf: psfTextureData(taps),
    halo: Math.ceil(maxCocPx * maxTapRadius) + 2,
    paintedDepth,
  };
}

/**
 * Plans one crop. The CoC fraction is rescaled so the gather radius stays the
 * full-frame pixel radius; depth is rasterized in global coordinates.
 */
export function planLensTileStage(
  template: LensTileTemplate,
  frameSize: { width: number; height: number },
  crop: LensTileRegion,
  depthOut?: Float32Array,
): LensBlurPlan {
  const { width, height } = crop;
  const count = width * height;
  const depth = rasterizeDepthMaskRegion(
    template.state.depthMask,
    frameSize.width,
    frameSize.height,
    crop,
    depthOut && depthOut.length >= count ? depthOut.subarray(0, count) : undefined,
  );
  return {
    quality: 'export',
    outputWidth: frameSize.width,
    outputHeight: frameSize.height,
    width,
    height,
    halfRes: false,
    aperture: template.aperture,
    focusPlane: template.focusPlane,
    focusRange: template.focusRange,
    falloff: template.falloff,
    maxCocShortSide: template.maxCocPx / Math.min(width, height),
    maxCocPx: template.maxCocPx,
    taps: template.taps.length,
    tapCount: template.taps.length,
    psf: template.psf,
    depth,
    guardBand: DEPTH_GUARD_BAND,
    guardStrength: template.paintedDepth ? DEPTH_GUARD_STRENGTH : 0,
    highlightBoost: template.state.highlightBoost,
  };
}

/**
 * True only when a lens export cannot fit a single GPU upload. Frames inside
 * the texture limit keep the single pass: it is faster and parity-equal.
 */
export function shouldTileLensExport(
  output: { width: number; height: number },
  maxTextureSize: number,
): boolean {
  return Math.max(output.width, output.height) > maxTextureSize;
}

export { MAX_TAPS };
