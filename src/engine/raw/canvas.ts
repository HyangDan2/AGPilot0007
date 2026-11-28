import type { CpuImageBuffer } from '../contracts/imageBuffer';

/**
 * Half-float linear → sRGB canvas helpers for the RAW seam (CP3-03).
 *
 * These are the develop-preview renderers used by `openRawForEditing` and the
 * lazily-created full-resolution export canvas. The browser-only implementation
 * mirrors the linear→sRGB LUT used by the SDR path so preview and export share
 * one transfer function.
 */

let halfSrgbLut: Uint8Array | null = null;
let halfToFloatLut: Float32Array | null = null;
let linearSrgbLut: Uint8Array | null = null;

function linearToSrgbByte(value: number): number {
  if (!(value > 0)) return 0;
  if (value >= 1) return 255;
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

function linearLut(): Uint8Array {
  if (halfSrgbLut) return halfSrgbLut;
  const lut = new Uint8Array(65536);
  for (let bits = 0; bits < 65536; bits += 1) {
    const sign = bits & 0x8000 ? -1 : 1;
    const exponent = (bits >> 10) & 0x1f;
    const fraction = bits & 0x3ff;
    const value = exponent === 0
      ? sign * Math.pow(2, -14) * (fraction / 1024)
      : exponent === 31
        ? (fraction ? NaN : sign * Infinity)
        : sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
    lut[bits] = linearToSrgbByte(value);
  }
  halfSrgbLut = lut;
  return lut;
}

function halfFloatTable(): Float32Array {
  if (halfToFloatLut) return halfToFloatLut;
  const table = new Float32Array(65536);
  for (let bits = 0; bits < 65536; bits += 1) {
    const sign = bits & 0x8000 ? -1 : 1;
    const exponent = (bits >> 10) & 0x1f;
    const fraction = bits & 0x3ff;
    table[bits] = exponent === 0
      ? sign * Math.pow(2, -14) * (fraction / 1024)
      : exponent === 31
        ? (fraction ? NaN : sign * Infinity)
        : sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
  }
  halfToFloatLut = table;
  return table;
}

/** Linear [0,1] → sRGB byte at 1/65536 resolution (≤0.5 LSB rounding error). */
function linearByteTable(): Uint8Array {
  if (linearSrgbLut) return linearSrgbLut;
  const table = new Uint8Array(65537);
  for (let index = 0; index <= 65536; index += 1) {
    table[index] = linearToSrgbByte(index / 65536);
  }
  linearSrgbLut = table;
  return table;
}

function outputSize(width: number, height: number, maxEdge?: number): [number, number] {
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(width, height)) : 1;
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create RAW develop canvas');
  return { canvas, ctx };
}

/** RGBA half floats (alpha ignored) → 8-bit sRGB canvas, nearest-neighbour scaled. */
export function renderLinearRgba16ToCanvas(source: CpuImageBuffer, maxEdge?: number): HTMLCanvasElement {
  const { width, height } = source;
  const [outWidth, outHeight] = outputSize(width, height, maxEdge);
  const { canvas, ctx } = createCanvas(outWidth, outHeight);
  const image = ctx.createImageData(outWidth, outHeight);
  const lut = linearLut();
  const data = source.data;
  if (!(data instanceof Uint16Array)) throw new Error('RAW develop expects half-float RGBA samples');
  for (let y = 0; y < outHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor((y * height) / outHeight));
    for (let x = 0; x < outWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x * width) / outWidth));
      const src = (sourceY * width + sourceX) * 4;
      const dst = (y * outWidth + x) * 4;
      image.data[dst] = lut[data[src]];
      image.data[dst + 1] = lut[data[src + 1]];
      image.data[dst + 2] = lut[data[src + 2]];
      image.data[dst + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Delta develop preview (CP5-02): applies a linear 3x3 (exposure + WB change
 * relative to the open-time decode) to the already-decoded base buffer and
 * encodes it exactly like `renderLinearRgba16ToCanvas`. Same sampling grid, so
 * the delta preview differs from a fresh decode only by f16 rounding.
 */
export function renderLinearRgba16ToCanvasDelta(
  source: CpuImageBuffer,
  matrix: readonly number[],
  maxEdge?: number,
): HTMLCanvasElement {
  const { width, height } = source;
  const [outWidth, outHeight] = outputSize(width, height, maxEdge);
  const { canvas, ctx } = createCanvas(outWidth, outHeight);
  const image = ctx.createImageData(outWidth, outHeight);
  const toFloat = halfFloatTable();
  const toByte = linearByteTable();
  const data = source.data;
  if (!(data instanceof Uint16Array)) throw new Error('RAW develop expects half-float RGBA samples');
  const m0 = matrix[0];
  const m1 = matrix[1];
  const m2 = matrix[2];
  const m3 = matrix[3];
  const m4 = matrix[4];
  const m5 = matrix[5];
  const m6 = matrix[6];
  const m7 = matrix[7];
  const m8 = matrix[8];
  const encode = (value: number): number => (value >= 1 ? 255 : value > 0 ? toByte[(value * 65536) | 0] : 0);
  for (let y = 0; y < outHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor((y * height) / outHeight));
    for (let x = 0; x < outWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x * width) / outWidth));
      const src = (sourceY * width + sourceX) * 4;
      const r = toFloat[data[src]];
      const g = toFloat[data[src + 1]];
      const b = toFloat[data[src + 2]];
      const dst = (y * outWidth + x) * 4;
      image.data[dst] = encode(m0 * r + m1 * g + m2 * b);
      image.data[dst + 1] = encode(m3 * r + m4 * g + m5 * b);
      image.data[dst + 2] = encode(m6 * r + m7 * g + m8 * b);
      image.data[dst + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Developed RGB half floats → 8-bit sRGB canvas (export resolver path). */
export function renderLinearRgb16ToCanvas(rgb: Uint16Array, width: number, height: number, maxEdge?: number): HTMLCanvasElement {
  const [outWidth, outHeight] = outputSize(width, height, maxEdge);
  const { canvas, ctx } = createCanvas(outWidth, outHeight);
  const image = ctx.createImageData(outWidth, outHeight);
  const lut = linearLut();
  for (let y = 0; y < outHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor((y * height) / outHeight));
    for (let x = 0; x < outWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x * width) / outWidth));
      const src = (sourceY * width + sourceX) * 3;
      const dst = (y * outWidth + x) * 4;
      image.data[dst] = lut[rgb[src]];
      image.data[dst + 1] = lut[rgb[src + 1]];
      image.data[dst + 2] = lut[rgb[src + 2]];
      image.data[dst + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('Canvas PNG encoding is unavailable'));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas PNG encoding failed'));
    }, 'image/png');
  });
}
