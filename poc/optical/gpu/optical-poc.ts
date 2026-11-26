import {
  multiplyMat3,
  perspectiveCorrectionHomography,
  rotationHomography,
  type Mat3,
} from '../math/homography';
import { apertureTapWeights, type ApertureShape } from '../math/focus';
import { rgbToHsl } from '../math/masks';
import { isDistortionInvertible } from '../math/distortion';

export interface PocDistortion {
  k1: number;
  k2?: number;
  p1?: number;
  p2?: number;
}

export interface PocMaskBase {
  blend?: 'add' | 'subtract' | 'intersect';
  invert?: boolean;
  opacity?: number;
  enabled?: boolean;
}

export interface PocBrushStroke {
  points: [number, number][];
  radius: number;
  hardness: number;
  flow: number;
}

export type PocMask =
  | ({ kind: 'none' } & PocMaskBase)
  | ({ kind: 'radial'; center: [number, number]; radius: [number, number]; rotation: number; feather: number } & PocMaskBase)
  | ({ kind: 'linear'; start: [number, number]; end: [number, number]; feather: number } & PocMaskBase)
  | ({
      kind: 'brush';
      strokes?: PocBrushStroke[];
      points?: [number, number][];
      radius?: number;
      hardness?: number;
      flow?: number;
    } & PocMaskBase)
  | ({ kind: 'luma'; lo: number; hi: number; feather: number } & PocMaskBase)
  | ({
      kind: 'color';
      color: [number, number, number];
      hueRange: number;
      satRange: number;
      lumRange: number;
      feather: number;
    } & PocMaskBase);

export interface PocFocus {
  center: [number, number];
  radius: number;
  falloff: number;
  maxCoc: number;
}

export type PocView = 'composite' | 'mask' | 'geometry' | 'coc';

export interface PocConfig {
  size: number;
  aspect: number;
  scene: 'grid' | 'colour' | 'bokeh';
  view: PocView;
  perspective: { vertical: number; horizontal: number; strength: number };
  rotationDeg: number;
  distortion: PocDistortion | null;
  mask: PocMask;
  masks?: PocMask[];
  localExposure: number;
  focus: PocFocus;
  aperture: ApertureShape;
  taps: number;
  bokehScale: 1 | 2;
}

export interface RenderReport {
  passes: { scene: number; geometry: number; bokeh: number; upscale: number };
  totalMs: number;
}

export type PocApiInfo = {
  renderer: string;
  vendor: string;
  maxTextureSize: number;
};

export interface PocApi {
  ready: boolean;
  render(patch?: Partial<PocConfig>): RenderReport;
  readPixel(u: number, v: number): [number, number, number, number];
  sumRegion(u0: number, v0: number, u1: number, v1: number, channel: number): number;
  info(): PocApiInfo;
}

export const DEFAULT_CONFIG: PocConfig = {
  size: 512,
  aspect: 1,
  scene: 'grid',
  view: 'composite',
  perspective: { vertical: 0, horizontal: 0, strength: 0.15 },
  rotationDeg: 0,
  distortion: null,
  mask: { kind: 'none' },
  localExposure: 0,
  focus: { center: [0.5, 0.5], radius: 0.2, falloff: 0.2, maxCoc: 0 },
  aperture: { blades: 6, rotation: 0, roundness: 0.2 },
  taps: 32,
  bokehScale: 1,
};

const MAX_MASKS = 8;
const BRUSH_TEX_WIDTH = 512;
const BRUSH_TEX_HEIGHT = 32;
const BRUSH_TEX_MAX = BRUSH_TEX_WIDTH * BRUSH_TEX_HEIGHT;
export const MAX_BRUSH_SEGMENTS_PER_MASK = 1024;

const VERTEX_SOURCE = `#version 300 es
layout(location=0) in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const SCENE_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform int u_scene;
uniform vec2 u_px;

float marker(vec2 uv, vec2 centre, float radius) {
  float d = length((uv - centre) * u_px);
  return 1.0 - smoothstep(radius, radius * 1.3, d);
}

void main() {
  if (u_scene == 0) {
    vec2 g = fract(v_uv * 8.0);
    float line = step(g.x, 0.06) + step(g.y, 0.06);
    vec3 base = vec3(0.18 + 0.55 * step(0.5, v_uv.x), 0.22 + 0.45 * step(0.5, v_uv.y), 0.42);
    vec3 color = mix(base, vec3(0.92), clamp(line, 0.0, 1.0) * 0.85);
    float shortSide = min(u_px.x, u_px.y);
    color = mix(color, vec3(1.0, 0.15, 0.15), marker(v_uv, vec2(0.25, 0.25), shortSide * 0.012));
    color = mix(color, vec3(0.15, 1.0, 0.15), marker(v_uv, vec2(0.75, 0.25), shortSide * 0.012));
    color = mix(color, vec3(0.2, 0.45, 1.0), marker(v_uv, vec2(0.25, 0.75), shortSide * 0.012));
    color = mix(color, vec3(1.0, 1.0, 0.2), marker(v_uv, vec2(0.75, 0.75), shortSide * 0.012));
    fragColor = vec4(color, 1.0);
  } else if (u_scene == 1) {
    fragColor = vec4(
      step(0.5, v_uv.x) > 0.5 ? 0.78 : 0.22,
      step(0.5, v_uv.y) > 0.5 ? 0.68 : 0.30,
      0.52,
      1.0
    );
  } else {
    vec3 color = vec3(0.02);
    color = mix(color, vec3(1.0), marker(v_uv, vec2(0.5, 0.5), min(u_px.x, u_px.y) * 0.012));
    fragColor = vec4(color, 1.0);
  }
}`;

const GEOMETRY_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_scene;
uniform sampler2D u_brush_table;
uniform mat3 u_h;
uniform vec4 u_dist;
uniform int u_view;
uniform float u_aspect;
uniform float u_local_exposure;

const int MAX_MASKS = ${MAX_MASKS};
const int MAX_BRUSH_SEGMENTS = ${MAX_BRUSH_SEGMENTS_PER_MASK};
uniform int u_mask_count;
uniform int u_mask_kind[MAX_MASKS];
uniform int u_mask_blend[MAX_MASKS];
uniform int u_mask_invert[MAX_MASKS];
uniform vec4 u_mask_a[MAX_MASKS];
uniform vec4 u_mask_b[MAX_MASKS];
uniform vec2 u_mask_c[MAX_MASKS];
uniform float u_mask_opacity[MAX_MASKS];

vec2 correctedToSource(vec2 uv) {
  vec2 centred = uv * 2.0 - 1.0;
  float r2 = dot(centred, centred);
  float radial = 1.0 + u_dist.x * r2 + u_dist.y * r2 * r2;
  vec2 tangent = vec2(
    2.0 * u_dist.z * centred.x * centred.y + u_dist.w * (r2 + 2.0 * centred.x * centred.x),
    u_dist.z * (r2 + 2.0 * centred.y * centred.y) + 2.0 * u_dist.w * centred.x * centred.y
  );
  vec2 p = (centred * radial + tangent) * 0.5 + 0.5;
  vec3 h = u_h * vec3(p, 1.0);
  return h.xy / h.z;
}

vec2 shortSide(vec2 p) {
  return p * vec2(u_aspect >= 1.0 ? u_aspect : 1.0, u_aspect >= 1.0 ? 1.0 : 1.0 / u_aspect);
}

float ss(float e0, float e1, float x) {
  float span = e1 - e0;
  if (abs(span) < 1e-6) return x < e0 ? 0.0 : 1.0;
  float t = clamp((x - e0) / span, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

vec3 rgbToHsl(vec3 c) {
  float maxc = max(c.r, max(c.g, c.b));
  float minc = min(c.r, min(c.g, c.b));
  float l = (maxc + minc) * 0.5;
  float d = maxc - minc;
  if (d < 1e-5) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
  float h;
  if (maxc == c.r) h = mod((c.g - c.b) / d, 6.0);
  else if (maxc == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  h *= 60.0;
  if (h < 0.0) h += 360.0;
  return vec3(h, s, l);
}

vec4 brushTexel(int index) {
  return texelFetch(u_brush_table, ivec2(index % ${BRUSH_TEX_WIDTH}, index / ${BRUSH_TEX_WIDTH}), 0);
}

float brushWeight(int start, int count, vec2 uv) {
  vec2 p = shortSide(uv);
  float acc = 0.0;
  for (int i = 0; i < MAX_BRUSH_SEGMENTS; i++) {
    if (i >= count) break;
    int base = (start + i) * 2;
    vec4 seg = brushTexel(base);
    vec4 params = brushTexel(base + 1);
    vec2 a = shortSide(seg.xy);
    vec2 b = shortSide(seg.zw);
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
    float distance = length(p - (a + ab * t));
    float radius = max(params.x, 1e-6);
    float hardness = clamp(params.y, 0.0, 1.0);
    float flow = clamp(params.z, 0.0, 1.0);
    float feather = radius * (1.0 - hardness);
    float w = (1.0 - ss(radius - feather, radius, distance)) * flow;
    acc = acc + w - acc * w;
  }
  return acc;
}

float maskWeight(int i, vec2 uv, vec3 color) {
  int kind = u_mask_kind[i];
  if (kind == 1) {
    vec2 p = shortSide(uv) - shortSide(u_mask_a[i].xy);
    float c = cos(-u_mask_b[i].x);
    float s = sin(-u_mask_b[i].x);
    vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c) / max(u_mask_a[i].zw, vec2(1e-6));
    return 1.0 - ss(1.0 - u_mask_b[i].y, 1.0, length(q));
  }
  if (kind == 2) {
    vec2 a = shortSide(u_mask_a[i].xy);
    vec2 b = shortSide(u_mask_a[i].zw);
    vec2 d = b - a;
    float t = dot(shortSide(uv) - a, d) / max(dot(d, d), 1e-8);
    float f = u_mask_b[i].x;
    return ss(0.5 - f * 0.5, 0.5 + f * 0.5, t);
  }
  if (kind == 3) {
    return brushWeight(int(u_mask_c[i].x), int(u_mask_c[i].y), uv);
  }
  if (kind == 4) {
    float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float f = u_mask_b[i].x;
    float below = ss(u_mask_a[i].x - f, u_mask_a[i].x, l);
    float above = 1.0 - ss(u_mask_a[i].y, u_mask_a[i].y + f, l);
    return below * above;
  }
  vec3 hsl = rgbToHsl(color);
  float hueDistance = abs(hsl.x - u_mask_a[i].x);
  hueDistance = min(hueDistance, 360.0 - hueDistance);
  float feather = u_mask_b[i].z;
  float hue = (u_mask_a[i].y < 0.02 || hsl.y < 0.02)
    ? 1.0
    : 1.0 - ss(u_mask_a[i].w, u_mask_a[i].w * (1.0 + feather), hueDistance);
  float sat = 1.0 - ss(u_mask_b[i].x, u_mask_b[i].x * (1.0 + feather), abs(hsl.y - u_mask_a[i].y));
  float lum = 1.0 - ss(u_mask_b[i].y, u_mask_b[i].y * (1.0 + feather), abs(hsl.z - u_mask_a[i].z));
  return max(hue, 0.0) * max(sat, 0.0) * max(lum, 0.0);
}

void main() {
  vec2 sourceUv = clamp(correctedToSource(v_uv), 0.0, 1.0);
  vec3 color = texture(u_scene, vec2(sourceUv.x, 1.0 - sourceUv.y)).rgb;
  float weight = 1.0;
  if (u_mask_count > 0) {
    float acc = 0.0;
    for (int i = 0; i < MAX_MASKS; i++) {
      if (i >= u_mask_count) break;
      float w = clamp(maskWeight(i, v_uv, color), 0.0, 1.0);
      if (u_mask_invert[i] == 1) w = 1.0 - w;
      w *= clamp(u_mask_opacity[i], 0.0, 1.0);
      int blend = u_mask_blend[i];
      if (blend == 1) acc = max(0.0, acc - w);
      else if (blend == 2) acc = acc * w;
      else acc = min(1.0, acc + w);
    }
    weight = acc;
  }
  if (u_view == 1) {
    fragColor = vec4(vec3(weight), 1.0);
    return;
  }
  color *= exp2(u_local_exposure * weight);
  fragColor = vec4(clamp(color, 0.0, 1.0), weight);
}`;

const BOKEH_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_graded;
uniform sampler2D u_psf;
uniform int u_view;
uniform int u_taps;
uniform float u_aspect;
uniform vec2 u_focus_center;
uniform float u_focus_radius;
uniform float u_focus_falloff;
uniform float u_max_coc;

vec2 shortSide(vec2 p) {
  return p * vec2(u_aspect >= 1.0 ? u_aspect : 1.0, u_aspect >= 1.0 ? 1.0 : 1.0 / u_aspect);
}

void main() {
  vec4 base = texture(u_graded, vec2(v_uv.x, 1.0 - v_uv.y));
  float distance = length(shortSide(v_uv) - shortSide(u_focus_center));
  float t = clamp((distance - u_focus_radius) / max(u_focus_falloff, 1e-6), 0.0, 1.0);
  float coc = u_max_coc * t * t * (3.0 - 2.0 * t);
  if (u_view == 3) {
    fragColor = vec4(vec3(clamp(coc / max(u_max_coc, 1e-6), 0.0, 1.0)), 1.0);
    return;
  }
  if (u_view != 0 || coc < 1e-5) {
    fragColor = base;
    return;
  }
  vec2 scale = vec2(u_aspect >= 1.0 ? u_aspect : 1.0, u_aspect >= 1.0 ? 1.0 : 1.0 / u_aspect);
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= u_taps) break;
    vec4 tap = texelFetch(u_psf, ivec2(i, 0), 0);
    vec2 sampleUv = v_uv + tap.xy * coc / scale;
    sum += texture(u_graded, vec2(sampleUv.x, 1.0 - sampleUv.y)) * tap.z;
  }
  sum.a = base.a;
  fragColor = sum;
}`;

const UPSCALE_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_src;
void main() {
  fragColor = texture(u_src, vec2(v_uv.x, 1.0 - v_uv.y));
}`;

interface Surface {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
}

interface BrushSegment {
  a: [number, number];
  b: [number, number];
  radius: number;
  hardness: number;
  flow: number;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${log}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, fragmentSource: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
}

function columnMajor(m: Mat3): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

function normalizeMaskList(config: PocConfig): PocMask[] {
  const list = config.masks ?? [config.mask];
  return list.filter((mask) => mask.kind !== 'none' && mask.enabled !== false);
}

function normalizeStrokes(mask: Extract<PocMask, { kind: 'brush' }>): PocBrushStroke[] {
  if (mask.strokes && mask.strokes.length > 0) return mask.strokes;
  if (mask.points && mask.points.length > 0) {
    return [
      {
        points: mask.points,
        radius: mask.radius ?? 0.01,
        hardness: mask.hardness ?? 0.5,
        flow: mask.flow ?? 1,
      },
    ];
  }
  return [];
}

function strokeSegments(stroke: PocBrushStroke): BrushSegment[] {
  const segments: BrushSegment[] = [];
  const points = stroke.points;
  if (points.length === 0) return segments;
  const params = { radius: stroke.radius, hardness: stroke.hardness, flow: stroke.flow };
  const point = (index: number): [number, number] => [points[index][0], points[index][1]];
  if (points.length === 1) {
    const p = point(0);
    segments.push({ a: p, b: [p[0], p[1]], ...params });
    return segments;
  }
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({ a: point(i), b: point(i + 1), ...params });
  }
  return segments;
}

export class OpticalPoc {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private vao: WebGLVertexArrayObject;
  private sceneProgram: WebGLProgram;
  private geometryProgram: WebGLProgram;
  private bokehProgram: WebGLProgram;
  private upscaleProgram: WebGLProgram;
  private sceneSurface: Surface | null = null;
  private sceneKey = '';
  private sceneRenderMs = 0;
  private gradedSurface: Surface | null = null;
  private blurSurface: Surface | null = null;
  private psfTexture: WebGLTexture;
  private psfKey = '';
  private brushTexture: WebGLTexture;
  private brushKey = '';
  private config: PocConfig = { ...DEFAULT_CONFIG };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.sceneProgram = createProgram(gl, SCENE_SOURCE);
    this.geometryProgram = createProgram(gl, GEOMETRY_SOURCE);
    this.bokehProgram = createProgram(gl, BOKEH_SOURCE);
    this.upscaleProgram = createProgram(gl, UPSCALE_SOURCE);

    const quad = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!quad || !vao) throw new Error('Failed to allocate geometry');
    this.vao = vao;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const psf = gl.createTexture();
    if (!psf) throw new Error('Failed to allocate PSF texture');
    this.psfTexture = psf;
    gl.bindTexture(gl.TEXTURE_2D, psf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const brush = gl.createTexture();
    if (!brush) throw new Error('Failed to allocate brush texture');
    this.brushTexture = brush;
    gl.bindTexture(gl.TEXTURE_2D, brush);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      BRUSH_TEX_WIDTH,
      BRUSH_TEX_HEIGHT,
      0,
      gl.RGBA,
      gl.FLOAT,
      new Float32Array(BRUSH_TEX_MAX * 4)
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private createSurface(width: number, height: number, filter: number): Surface {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new Error('Failed to allocate framebuffer');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Framebuffer is incomplete');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, width, height };
  }

  private disposeSurface(surface: Surface | null): void {
    if (!surface) return;
    this.gl.deleteFramebuffer(surface.fbo);
    this.gl.deleteTexture(surface.tex);
  }

  private ensureScene(width: number, height: number, scene: PocConfig['scene']): Surface {
    const key = `${width}x${height}:${scene}`;
    if (this.sceneSurface && this.sceneKey === key) {
      this.sceneRenderMs = 0;
      return this.sceneSurface;
    }
    this.disposeSurface(this.sceneSurface);
    this.sceneSurface = this.createSurface(width, height, this.gl.LINEAR);
    this.sceneKey = key;
    const gl = this.gl;
    const surface = this.sceneSurface;
    const start = performance.now();
    gl.bindFramebuffer(gl.FRAMEBUFFER, surface.fbo);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.sceneProgram);
    gl.uniform1i(gl.getUniformLocation(this.sceneProgram, 'u_scene'), scene === 'grid' ? 0 : scene === 'colour' ? 1 : 2);
    gl.uniform2f(gl.getUniformLocation(this.sceneProgram, 'u_px'), width, height);
    this.drawQuad();
    this.sync();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.sceneRenderMs = performance.now() - start;
    return surface;
  }

  private ensureGraded(width: number, height: number): Surface {
    if (this.gradedSurface && this.gradedSurface.width === width && this.gradedSurface.height === height) {
      return this.gradedSurface;
    }
    this.disposeSurface(this.gradedSurface);
    this.gradedSurface = this.createSurface(width, height, this.gl.LINEAR);
    return this.gradedSurface;
  }

  private ensureBlur(width: number, height: number): Surface {
    if (this.blurSurface && this.blurSurface.width === width && this.blurSurface.height === height) {
      return this.blurSurface;
    }
    this.disposeSurface(this.blurSurface);
    this.blurSurface = this.createSurface(width, height, this.gl.LINEAR);
    return this.blurSurface;
  }

  private updatePsf(aperture: ApertureShape, taps: number): void {
    const key = JSON.stringify([aperture, taps]);
    if (key === this.psfKey) return;
    const gl = this.gl;
    const width = 64;
    const data = new Float32Array(width * 4);
    const weights = apertureTapWeights(aperture, taps);
    for (let i = 0; i < Math.min(width, weights.length); i++) {
      data[i * 4] = weights[i].offset.x;
      data[i * 4 + 1] = weights[i].offset.y;
      data[i * 4 + 2] = weights[i].weight;
      data[i * 4 + 3] = 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.psfTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, 1, 0, gl.RGBA, gl.FLOAT, data);
    this.psfKey = key;
  }

  private uploadBrush(masks: PocMask[]): Array<[number, number]> {
    const ranges: Array<[number, number]> = masks.map(() => [0, 0]);
    const segments: BrushSegment[] = [];
    for (let i = 0; i < masks.length; i++) {
      const mask = masks[i];
      if (mask.kind !== 'brush') continue;
      const start = segments.length;
      for (const stroke of normalizeStrokes(mask)) {
        for (const segment of strokeSegments(stroke)) {
          if (segments.length >= BRUSH_TEX_MAX / 2) break;
          segments.push(segment);
        }
      }
      ranges[i] = [start, Math.min(MAX_BRUSH_SEGMENTS_PER_MASK, segments.length - start)];
    }
    const key = JSON.stringify(segments);
    if (key !== this.brushKey) {
      const data = new Float32Array(BRUSH_TEX_MAX * 4);
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const base = i * 8;
        data[base] = segment.a[0];
        data[base + 1] = segment.a[1];
        data[base + 2] = segment.b[0];
        data[base + 3] = segment.b[1];
        data[base + 4] = segment.radius;
        data[base + 5] = segment.hardness;
        data[base + 6] = segment.flow;
        data[base + 7] = 0;
      }
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.brushTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, BRUSH_TEX_WIDTH, BRUSH_TEX_HEIGHT, 0, gl.RGBA, gl.FLOAT, data);
      this.brushKey = key;
    }
    return ranges;
  }

  private configureMasks(masks: PocMask[]): void {
    if (masks.length > MAX_MASKS) throw new Error(`PoC supports at most ${MAX_MASKS} masks`);
    const gl = this.gl;
    const program = this.geometryProgram;
    const kinds = new Int32Array(MAX_MASKS);
    const blends = new Int32Array(MAX_MASKS);
    const inverts = new Int32Array(MAX_MASKS);
    const a = new Float32Array(MAX_MASKS * 4);
    const b = new Float32Array(MAX_MASKS * 4);
    const c = new Float32Array(MAX_MASKS * 2);
    const opacity = new Float32Array(MAX_MASKS);
    const ranges = this.uploadBrush(masks);
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

    for (let i = 0; i < masks.length; i++) {
      const mask = masks[i];
      blends[i] = mask.blend === 'subtract' ? 1 : mask.blend === 'intersect' ? 2 : 0;
      inverts[i] = mask.invert ? 1 : 0;
      opacity[i] = clamp01(mask.opacity ?? 1);
      if (mask.kind === 'radial') {
        kinds[i] = 1;
        a.set([mask.center[0], mask.center[1], mask.radius[0], mask.radius[1]], i * 4);
        b.set([mask.rotation, clamp01(mask.feather), 0, 0], i * 4);
      } else if (mask.kind === 'linear') {
        kinds[i] = 2;
        a.set([mask.start[0], mask.start[1], mask.end[0], mask.end[1]], i * 4);
        b.set([clamp01(mask.feather), 0, 0, 0], i * 4);
      } else if (mask.kind === 'brush') {
        kinds[i] = 3;
        c.set([ranges[i][0], ranges[i][1]], i * 2);
      } else if (mask.kind === 'luma') {
        kinds[i] = 4;
        a.set([mask.lo, mask.hi, 0, 0], i * 4);
        b.set([clamp01(mask.feather), 0, 0, 0], i * 4);
      } else if (mask.kind === 'color') {
        kinds[i] = 5;
        const hsl = rgbToHsl({ r: mask.color[0], g: mask.color[1], b: mask.color[2] });
        a.set([hsl.h, hsl.s, hsl.l, mask.hueRange], i * 4);
        b.set([mask.satRange, mask.lumRange, clamp01(mask.feather), 0], i * 4);
      }
    }

    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'u_mask_count'), masks.length);
    gl.uniform1iv(gl.getUniformLocation(program, 'u_mask_kind'), kinds);
    gl.uniform1iv(gl.getUniformLocation(program, 'u_mask_blend'), blends);
    gl.uniform1iv(gl.getUniformLocation(program, 'u_mask_invert'), inverts);
    gl.uniform4fv(gl.getUniformLocation(program, 'u_mask_a'), a);
    gl.uniform4fv(gl.getUniformLocation(program, 'u_mask_b'), b);
    gl.uniform2fv(gl.getUniformLocation(program, 'u_mask_c'), c);
    gl.uniform1fv(gl.getUniformLocation(program, 'u_mask_opacity'), opacity);
  }

  private drawQuad(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  // gl.finish() alone does not flush the ANGLE command stream here; a 1x1 readback forces completion.
  private sync(): void {
    const gl = this.gl;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.finish();
  }

  public render(patch: Partial<PocConfig> = {}): RenderReport {
    const gl = this.gl;
    const config: PocConfig = {
      ...this.config,
      ...patch,
      perspective: { ...this.config.perspective, ...(patch.perspective ?? {}) },
      focus: { ...this.config.focus, ...(patch.focus ?? {}) },
      aperture: { ...this.config.aperture, ...(patch.aperture ?? {}) },
      mask: patch.mask ?? this.config.mask,
      masks: patch.masks ?? this.config.masks,
    };
    if (config.distortion && !isDistortionInvertible(config.distortion)) {
      throw new Error('Distortion coefficients are not invertible in the image domain');
    }
    this.config = config;

    const aspect = Math.min(5, Math.max(0.2, config.aspect));
    const shortSide = Math.min(2048, Math.max(16, Math.round(config.size)));
    let width = aspect >= 1 ? Math.round(shortSide * aspect) : shortSide;
    let height = aspect >= 1 ? shortSide : Math.round(shortSide / aspect);
    if (width > 2048 || height > 2048) {
      const shrink = 2048 / Math.max(width, height);
      width = Math.max(8, Math.round(width * shrink));
      height = Math.max(8, Math.round(height * shrink));
    }
    this.canvas.width = width;
    this.canvas.height = height;
    const scale = config.bokehScale === 2 && config.view === 'composite' ? 2 : 1;
    const blurWidth = Math.max(1, Math.round(width / scale));
    const blurHeight = Math.max(1, Math.round(height / scale));

    const scene = this.ensureScene(width, height, config.scene);
    const graded = this.ensureGraded(width, height);
    const blur = scale > 1 ? this.ensureBlur(blurWidth, blurHeight) : null;
    this.updatePsf(config.aperture, config.taps);
    const masks = normalizeMaskList(config);

    const passes = { scene: 0, geometry: 0, bokeh: 0, upscale: 0 };
    const start = performance.now();
    passes.scene = this.sceneRenderMs;

    let h: Mat3 = perspectiveCorrectionHomography(
      config.perspective.vertical,
      config.perspective.horizontal,
      config.perspective.strength
    );
    if (Math.abs(config.rotationDeg) > 1e-9) {
      h = multiplyMat3(rotationHomography((config.rotationDeg * Math.PI) / 180), h);
    }

    const geometryStart = performance.now();
    gl.bindFramebuffer(gl.FRAMEBUFFER, graded.fbo);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.geometryProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(gl.getUniformLocation(this.geometryProgram, 'u_scene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.brushTexture);
    gl.uniform1i(gl.getUniformLocation(this.geometryProgram, 'u_brush_table'), 1);
    gl.uniformMatrix3fv(gl.getUniformLocation(this.geometryProgram, 'u_h'), false, columnMajor(h));
    gl.uniform4f(
      gl.getUniformLocation(this.geometryProgram, 'u_dist'),
      config.distortion?.k1 ?? 0,
      config.distortion?.k2 ?? 0,
      config.distortion?.p1 ?? 0,
      config.distortion?.p2 ?? 0
    );
    gl.uniform1i(gl.getUniformLocation(this.geometryProgram, 'u_view'), config.view === 'mask' ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.geometryProgram, 'u_aspect'), aspect);
    gl.uniform1f(gl.getUniformLocation(this.geometryProgram, 'u_local_exposure'), config.localExposure);
    this.configureMasks(masks);
    gl.viewport(0, 0, width, height);
    this.drawQuad();
    this.sync();
    passes.geometry = performance.now() - geometryStart;

    const bokehStart = performance.now();
    const target = blur ?? null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.width : width, target ? target.height : height);
    gl.useProgram(this.bokehProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, graded.tex);
    gl.uniform1i(gl.getUniformLocation(this.bokehProgram, 'u_graded'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.psfTexture);
    gl.uniform1i(gl.getUniformLocation(this.bokehProgram, 'u_psf'), 1);
    const bokehView = config.view === 'composite' ? 0 : config.view === 'coc' ? 3 : 2;
    gl.uniform1i(gl.getUniformLocation(this.bokehProgram, 'u_view'), bokehView);
    gl.uniform1i(gl.getUniformLocation(this.bokehProgram, 'u_taps'), Math.min(64, config.taps));
    gl.uniform1f(gl.getUniformLocation(this.bokehProgram, 'u_aspect'), aspect);
    gl.uniform2f(gl.getUniformLocation(this.bokehProgram, 'u_focus_center'), config.focus.center[0], config.focus.center[1]);
    gl.uniform1f(gl.getUniformLocation(this.bokehProgram, 'u_focus_radius'), config.focus.radius);
    gl.uniform1f(gl.getUniformLocation(this.bokehProgram, 'u_focus_falloff'), config.focus.falloff);
    gl.uniform1f(gl.getUniformLocation(this.bokehProgram, 'u_max_coc'), config.focus.maxCoc);
    this.drawQuad();
    this.sync();
    passes.bokeh = performance.now() - bokehStart;

    if (blur) {
      const upscaleStart = performance.now();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.useProgram(this.upscaleProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, blur.tex);
      gl.uniform1i(gl.getUniformLocation(this.upscaleProgram, 'u_src'), 0);
      this.drawQuad();
      this.sync();
      passes.upscale = performance.now() - upscaleStart;
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    return { passes, totalMs: performance.now() - start };
  }

  private readBytes(u: number, v: number, w: number, h: number): Uint8Array {
    const gl = this.gl;
    const x = Math.min(this.canvas.width - 1, Math.max(0, Math.floor(u * this.canvas.width)));
    const yTop = Math.min(this.canvas.height - 1, Math.max(0, Math.floor(v * this.canvas.height)));
    const width = Math.min(w, this.canvas.width - x);
    const height = Math.min(h, this.canvas.height - yTop);
    const y = this.canvas.height - yTop - height;
    const out = new Uint8Array(width * height * 4);
    gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }

  public readPixel(u: number, v: number): [number, number, number, number] {
    const bytes = this.readBytes(u, v, 1, 1);
    return [bytes[0], bytes[1], bytes[2], bytes[3]];
  }

  public sumRegion(u0: number, v0: number, u1: number, v1: number, channel: number): number {
    const w = Math.max(1, Math.round((u1 - u0) * this.canvas.width));
    const h = Math.max(1, Math.round((v1 - v0) * this.canvas.height));
    const bytes = this.readBytes(u0, v0, w, h);
    let sum = 0;
    for (let i = channel; i < bytes.length; i += 4) sum += bytes[i];
    return sum;
  }

  public info(): PocApiInfo {
    const gl = this.gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown',
      vendor: ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : 'unknown',
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    };
  }
}

const canvas = document.getElementById('view');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing #view canvas');

try {
  const poc = new OpticalPoc(canvas);
  const api: PocApi = {
    ready: true,
    render: (patch) => poc.render(patch),
    readPixel: (u, v) => poc.readPixel(u, v),
    sumRegion: (u0, v0, u1, v1, channel) => poc.sumRegion(u0, v0, u1, v1, channel),
    info: () => poc.info(),
  };
  window.__opticalPoc = api;
  window.dispatchEvent(new Event('optical-poc-ready'));
} catch (error) {
  console.error('Optical PoC failed to initialise:', error);
  throw error;
}

declare global {
  interface Window {
    __opticalPoc?: PocApi;
  }
}
