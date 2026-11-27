import { geometryIsIdentity, type GeometryTransform } from '../contracts/geometry';
import type { OpticalTransform } from '../contracts/optical';
import { validateImageBuffer, type ImageBuffer } from '../contracts/imageBuffer';
import type { MaskData } from '../contracts/masks';
import { geometryOutputToSource, geometryUniforms, GEOMETRY_SHADER_CHUNK, validateGeometryRenderable } from './geometry';
import { assertMaskBudget } from './modules';
import {
  assertOpticalRenderable,
  opticalCorrectedToSource,
  opticalIsIdentity,
  opticalUniforms,
  OPTICAL_SHADER_CHUNK,
} from './transform';

export type Q02SourceStageSource =
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageBitmap
  | HTMLImageElement
  | ImageBuffer;

export interface Q02SourceStageInput {
  source: Q02SourceStageSource;
  sourceWidth: number;
  sourceHeight: number;
  output: { width: number; height: number };
  geometry?: GeometryTransform | null;
  optical?: OpticalTransform | null;
  masks?: readonly MaskData[] | null;
}

export interface Q02SourceStageResult {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  width: number;
  height: number;
  fingerprint: string;
}

type SourceStageSettings = Pick<
  Q02SourceStageInput,
  'sourceWidth' | 'sourceHeight' | 'output' | 'geometry' | 'optical'
>;

interface SourcePixelData {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

interface SourceStageCacheEntry {
  source: Q02SourceStageSource;
  fingerprint: string;
  result: Q02SourceStageResult;
}

let lastCacheEntry: SourceStageCacheEntry | null = null;

const FNV_OFFSET_A = 0x811c9dc5;
const FNV_OFFSET_B = 0x9e3779b9;
const FNV_PRIME = 0x01000193;

function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function hashText(text: string): string {
  return `${fnv1a(text, FNV_OFFSET_A)}${fnv1a(text, FNV_OFFSET_B)}`;
}

/**
 * Stable fingerprint of the source pixels' dimensions and the warp settings.
 * Masks are deliberately excluded: they are validated here for the product
 * budget but stay in corrected NIS for local stages, so they cannot change the
 * warped source canvas. Including them would invalidate the cache on every UI
 * mask edit without changing a pixel.
 */
export function sourceStageFingerprint(input: SourceStageSettings): string {
  assertDimensions(input.sourceWidth, input.sourceHeight, 'source');
  assertDimensions(input.output.width, input.output.height, 'output');
  const geometry = validateGeometryRenderable(input.geometry);
  const optical = input.optical ? normalizeOpticalForFingerprint(input.optical) : null;
  return fingerprintFrom(geometry, optical, input.sourceWidth, input.sourceHeight, input.output.width, input.output.height);
}

function normalizeOpticalForFingerprint(value: OpticalTransform): OpticalTransform | null {
  const normalized = assertOpticalRenderable(value);
  return opticalIsIdentity(normalized) ? null : normalized;
}

function fingerprintFrom(
  geometry: GeometryTransform,
  optical: OpticalTransform | null,
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
): string {
  const payload = JSON.stringify({
    version: 1,
    source: [sourceWidth, sourceHeight],
    output: [outputWidth, outputHeight],
    geometry: [
      geometry.rotation,
      geometry.straighten,
      geometry.flipHorizontal ? 1 : 0,
      geometry.flipVertical ? 1 : 0,
      geometry.crop ? [geometry.crop.x, geometry.crop.y, geometry.crop.width, geometry.crop.height] : null,
    ],
    optical: optical
      ? {
          homography: [...optical.homography],
          distortion: optical.distortion
            ? [
                optical.distortion.k1,
                optical.distortion.k2 ?? 0,
                optical.distortion.k3 ?? 0,
                optical.distortion.p1 ?? 0,
                optical.distortion.p2 ?? 0,
              ]
            : null,
          perspective: optical.perspective
            ? optical.perspective.map((point) => [point.x, point.y])
            : null,
        }
      : null,
  });
  return `q02-source-${hashText(payload)}`;
}

function assertDimensions(width: number, height: number, label: 'source' | 'output'): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid ${label} dimensions`);
  }
}

function isImageBuffer(source: Q02SourceStageSource): source is ImageBuffer {
  return typeof source === 'object' && source !== null && 'storage' in source;
}

function sourcePixels(source: Q02SourceStageSource, width: number, height: number): SourcePixelData {
  if (isImageBuffer(source)) {
    validateImageBuffer(source);
    if (source.width !== width || source.height !== height) {
      throw new Error('Source dimensions do not match the image buffer');
    }
    if (source.storage === 'gpu') {
      throw new Error('Source stage does not support GPU image buffers');
    }
    if (source.format !== 'rgba8' || !(source.data instanceof Uint8Array)) {
      throw new Error('Source stage requires an rgba8 CPU image buffer');
    }
    return { width, height, data: source.data };
  }

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!context) throw new Error('Source stage requires a 2D canvas context to read pixels');
  context.clearRect(0, 0, width, height);
  context.drawImage(source as CanvasImageSource, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  return { width, height, data: image.data };
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas === 'function') {
    try {
      return new OffscreenCanvas(width, height);
    } catch {
      // Fall through to the DOM canvas fallback.
    }
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('Source stage requires OffscreenCanvas or HTMLCanvasElement support');
}

const VERTEX_SHADER = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(pos.x, 1.0 - pos.y);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_q02_source;
out vec4 outColor;
${OPTICAL_SHADER_CHUNK}
${GEOMETRY_SHADER_CHUNK}
void main() {
  vec2 p = q02_geometry_output_to_source(vUv);
  p = q02_optical_corrected_to_source(p);
  outColor = texture(u_q02_source, p);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Source stage could not create a shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'shader compile failed';
    gl.deleteShader(shader);
    throw new Error(`Source stage shader compile failed: ${log}`);
  }
  return shader;
}

function setGeometryUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  geometry: GeometryTransform,
  sourceAspect: number,
): void {
  const uniforms = geometryUniforms(geometry, sourceAspect);
  gl.uniform1f(gl.getUniformLocation(program, 'u_q02_geometry_rotation'), uniforms.rotation);
  gl.uniform1f(gl.getUniformLocation(program, 'u_q02_geometry_straighten'), uniforms.straighten);
  gl.uniform1f(gl.getUniformLocation(program, 'u_q02_geometry_aspect'), uniforms.aspect);
  gl.uniform2f(
    gl.getUniformLocation(program, 'u_q02_geometry_flip'),
    uniforms.flip[0],
    uniforms.flip[1],
  );
  gl.uniform4f(
    gl.getUniformLocation(program, 'u_q02_geometry_crop'),
    uniforms.crop[0],
    uniforms.crop[1],
    uniforms.crop[2],
    uniforms.crop[3],
  );
}

function setOpticalUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  optical: OpticalTransform | null,
): void {
  const uniforms = optical
    ? opticalUniforms(optical)
    : {
        homography: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
        radial: [0, 0, 0, 0] as const,
        tangential: [0, 0] as const,
      };
  gl.uniformMatrix3fv(
    gl.getUniformLocation(program, 'u_q02_optical_h'),
    false,
    uniforms.homography,
  );
  gl.uniform4f(
    gl.getUniformLocation(program, 'u_q02_optical_radial'),
    uniforms.radial[0],
    uniforms.radial[1],
    uniforms.radial[2],
    uniforms.radial[3],
  );
  gl.uniform2f(
    gl.getUniformLocation(program, 'u_q02_optical_tangential'),
    uniforms.tangential[0],
    uniforms.tangential[1],
  );
}

function renderWebGL(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  source: Q02SourceStageSource,
  sourceWidth: number,
  sourceHeight: number,
  geometry: GeometryTransform,
  optical: OpticalTransform | null,
): boolean {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  }) as WebGL2RenderingContext | null;
  if (!gl) return false;

  const program = gl.createProgram();
  if (!program) throw new Error('Source stage could not create a WebGL program');
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || 'program link failed';
    gl.deleteProgram(program);
    throw new Error(`Source stage program link failed: ${log}`);
  }

  const texture = gl.createTexture();
  if (!texture) throw new Error('Source stage could not create a texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  if (isImageBuffer(source)) {
    validateImageBuffer(source);
    if (source.width !== sourceWidth || source.height !== sourceHeight) {
      throw new Error('Source dimensions do not match the image buffer');
    }
    if (source.storage === 'gpu') {
      throw new Error('Source stage does not support GPU image buffers');
    }
    if (source.format !== 'rgba8' || !(source.data instanceof Uint8Array)) {
      throw new Error('Source stage requires an rgba8 CPU image buffer');
    }
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      sourceWidth,
      sourceHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source.data,
    );
  } else {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source as TexImageSource,
    );
  }

  gl.useProgram(program);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.BLEND);
  gl.disable(gl.DITHER);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  setGeometryUniforms(gl, program, geometry, sourceWidth / sourceHeight);
  setOpticalUniforms(gl, program, optical);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(gl.getUniformLocation(program, 'u_q02_source'), 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  const error = gl.getError();
  gl.deleteTexture(texture);
  gl.deleteProgram(program);
  if (error !== gl.NO_ERROR) throw new Error(`Source stage WebGL error ${error}`);
  return true;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function sampleBilinear(
  pixels: SourcePixelData,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  offset: number,
): void {
  const width = pixels.width;
  const height = pixels.height;
  const sampleX = clamp01(x) * width - 0.5;
  const sampleY = clamp01(y) * height - 0.5;
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(sampleX)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(sampleY)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, sampleX - x0));
  const fy = Math.min(1, Math.max(0, sampleY - y0));
  const data = pixels.data;
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  for (let channel = 0; channel < 4; channel++) {
    out[offset + channel] =
      data[i00 + channel] * w00 +
      data[i10 + channel] * w10 +
      data[i01 + channel] * w01 +
      data[i11 + channel] * w11;
  }
}

function renderCpu(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  source: Q02SourceStageSource,
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
  geometry: GeometryTransform,
  optical: OpticalTransform | null,
): boolean {
  const context = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!context) return false;
  const sourceAspect = sourceWidth / sourceHeight;
  const pixels = sourcePixels(source, sourceWidth, sourceHeight);
  const image = context.createImageData(outputWidth, outputHeight);
  const out = image.data;

  for (let y = 0; y < outputHeight; y++) {
    const v = (y + 0.5) / outputHeight;
    for (let x = 0; x < outputWidth; x++) {
      const u = (x + 0.5) / outputWidth;
      const geometryPoint = geometryOutputToSource({ x: u, y: v }, geometry, sourceAspect);
      const sourcePoint = optical
        ? opticalCorrectedToSource(geometryPoint, optical)
        : geometryPoint;
      sampleBilinear(pixels, sourcePoint.x, sourcePoint.y, out, (y * outputWidth + x) * 4);
    }
  }

  context.putImageData(image, 0, 0);
  return true;
}

/**
 * Applies the optical -> geometry inverse mapping to a source image and returns
 * the warped canvas. Synchronous by contract for Q01's preview runner.
 *
 * Returns null only when both geometry and optical are identity, so legacy
 * rendering keeps its exact zero-copy path. Non-identity requests run the same
 * validation gates as the stage modules before a single pixel is touched.
 */
export function renderSourceStage(input: Q02SourceStageInput): Q02SourceStageResult | null {
  assertDimensions(input.sourceWidth, input.sourceHeight, 'source');
  assertDimensions(input.output.width, input.output.height, 'output');

  const geometry = validateGeometryRenderable(input.geometry);
  const optical = input.optical ? assertOpticalRenderable(input.optical) : null;
  assertMaskBudget(input.masks, 'product');

  const activeOptical = optical && !opticalIsIdentity(optical) ? optical : null;
  if (geometryIsIdentity(geometry) && !activeOptical) return null;

  const fingerprint = fingerprintFrom(
    geometry,
    activeOptical,
    input.sourceWidth,
    input.sourceHeight,
    input.output.width,
    input.output.height,
  );
  if (
    lastCacheEntry &&
    lastCacheEntry.source === input.source &&
    lastCacheEntry.fingerprint === fingerprint
  ) {
    return lastCacheEntry.result;
  }

  const { width, height } = input.output;
  const canvas = createCanvas(width, height);
  canvas.width = width;
  canvas.height = height;

  if (!renderWebGL(canvas, input.source, input.sourceWidth, input.sourceHeight, geometry, activeOptical)) {
    if (!renderCpu(canvas, input.source, input.sourceWidth, input.sourceHeight, width, height, geometry, activeOptical)) {
      throw new Error('Source stage requires WebGL2 or 2D canvas support');
    }
  }

  const result: Q02SourceStageResult = { canvas, width, height, fingerprint };
  lastCacheEntry = { source: input.source, fingerprint, result };
  return result;
}
