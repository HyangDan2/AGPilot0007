import {
  multiplyMat3,
  perspectiveCorrectionHomography,
  rotationHomography,
  type Mat3,
} from '../math/homography';
import { apertureTapWeights, type ApertureShape } from '../math/focus';
import { rgbToHsl } from '../math/masks';

export interface PocDistortion {
  k1: number;
  k2?: number;
  p1?: number;
  p2?: number;
}

export type PocMask =
  | { kind: 'none' }
  | { kind: 'radial'; center: [number, number]; radius: [number, number]; rotation: number; feather: number }
  | { kind: 'linear'; start: [number, number]; end: [number, number]; feather: number }
  | { kind: 'brush'; points: [number, number][]; radius: number; hardness: number; flow: number }
  | { kind: 'luma'; lo: number; hi: number; feather: number }
  | { kind: 'color'; color: [number, number, number]; hueRange: number; satRange: number; lumRange: number; feather: number };

export interface PocFocus {
  center: [number, number];
  radius: number;
  falloff: number;
  maxCoc: number;
}

export type PocView = 'composite' | 'mask' | 'geometry';

export interface PocConfig {
  size: number;
  scene: 'grid' | 'colour' | 'bokeh';
  view: PocView;
  perspective: { vertical: number; horizontal: number; strength: number };
  rotationDeg: number;
  distortion: PocDistortion | null;
  mask: PocMask;
  localExposure: number;
  focus: PocFocus;
  aperture: ApertureShape;
  taps: number;
}

export interface RenderReport {
  passes: { scene: number; geometry: number; bokeh: number };
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
};

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
uniform float u_short;

float marker(vec2 uv, vec2 centre, float radius) {
  float d = length((uv - centre) * u_short);
  return 1.0 - smoothstep(radius, radius * 1.3, d);
}

void main() {
  if (u_scene == 0) {
    vec2 g = fract(v_uv * 8.0);
    float line = step(g.x, 0.06) + step(g.y, 0.06);
    vec3 base = vec3(0.18 + 0.55 * step(0.5, v_uv.x), 0.22 + 0.45 * step(0.5, v_uv.y), 0.42);
    vec3 color = mix(base, vec3(0.92), clamp(line, 0.0, 1.0) * 0.85);
    color = mix(color, vec3(1.0, 0.15, 0.15), marker(v_uv, vec2(0.25, 0.25), u_short * 0.012));
    color = mix(color, vec3(0.15, 1.0, 0.15), marker(v_uv, vec2(0.75, 0.25), u_short * 0.012));
    color = mix(color, vec3(0.2, 0.45, 1.0), marker(v_uv, vec2(0.25, 0.75), u_short * 0.012));
    color = mix(color, vec3(1.0, 1.0, 0.2), marker(v_uv, vec2(0.75, 0.75), u_short * 0.012));
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
    color = mix(color, vec3(1.0), marker(v_uv, vec2(0.5, 0.5), u_short * 0.012));
    fragColor = vec4(color, 1.0);
  }
}`;

const GEOMETRY_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_scene;
uniform mat3 u_h;
uniform vec4 u_dist;
uniform int u_view;
uniform float u_local_exposure;
uniform int u_mask_kind;
uniform vec2 u_mask_center;
uniform vec2 u_mask_radius;
uniform float u_mask_rotation;
uniform float u_mask_feather;
uniform vec2 u_mask_p0;
uniform vec2 u_mask_p1;
uniform vec4 u_brush_segments[8];
uniform int u_brush_count;
uniform float u_brush_radius;
uniform float u_brush_hardness;
uniform float u_brush_flow;
uniform float u_luma_lo;
uniform float u_luma_hi;
uniform vec3 u_color_hsl;
uniform vec3 u_color_ranges;

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

float evaluateMask(vec2 uv, vec3 color) {
  if (u_mask_kind == 0) return 1.0;
  if (u_mask_kind == 1) {
    vec2 p = uv - u_mask_center;
    float c = cos(-u_mask_rotation);
    float s = sin(-u_mask_rotation);
    vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c) / u_mask_radius;
    return 1.0 - smoothstep(1.0 - u_mask_feather, 1.0, length(q));
  }
  if (u_mask_kind == 2) {
    vec2 d = u_mask_p1 - u_mask_p0;
    float t = dot(uv - u_mask_p0, d) / max(dot(d, d), 1e-8);
    return smoothstep(0.5 - u_mask_feather * 0.5, 0.5 + u_mask_feather * 0.5, t);
  }
  if (u_mask_kind == 3) {
    float best = 1e9;
    for (int i = 0; i < 8; i++) {
      if (i >= u_brush_count) break;
      vec4 seg = u_brush_segments[i];
      vec2 a = seg.xy;
      vec2 b = seg.zw;
      vec2 ab = b - a;
      float t = clamp(dot(uv - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
      best = min(best, length(uv - (a + ab * t)));
    }
    float feather = u_brush_radius * (1.0 - u_brush_hardness);
    float coverage = 1.0 - smoothstep(u_brush_radius - feather, u_brush_radius, best);
    return coverage * u_brush_flow;
  }
  if (u_mask_kind == 4) {
    float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float below = smoothstep(u_luma_lo - u_mask_feather, u_luma_lo, l);
    float above = 1.0 - smoothstep(u_luma_hi, u_luma_hi + u_mask_feather, l);
    return below * above;
  }
  vec3 hsl = rgbToHsl(color);
  float hueDistance = abs(hsl.x - u_color_hsl.x);
  hueDistance = min(hueDistance, 360.0 - hueDistance);
  float hue = (u_color_hsl.y < 0.02 || hsl.y < 0.02)
    ? 1.0
    : 1.0 - smoothstep(u_color_ranges.x, u_color_ranges.x * (1.0 + u_mask_feather), hueDistance);
  float sat = 1.0 - smoothstep(u_color_ranges.y, u_color_ranges.y * (1.0 + u_mask_feather), abs(hsl.y - u_color_hsl.y));
  float lum = 1.0 - smoothstep(u_color_ranges.z, u_color_ranges.z * (1.0 + u_mask_feather), abs(hsl.z - u_color_hsl.z));
  return max(hue, 0.0) * max(sat, 0.0) * max(lum, 0.0);
}

void main() {
  vec2 sourceUv = clamp(correctedToSource(v_uv), 0.0, 1.0);
  vec3 color = texture(u_scene, vec2(sourceUv.x, 1.0 - sourceUv.y)).rgb;
  float weight = clamp(evaluateMask(v_uv, color), 0.0, 1.0);
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
uniform vec2 u_focus_center;
uniform float u_focus_radius;
uniform float u_focus_falloff;
uniform float u_max_coc;

void main() {
  vec4 base = texture(u_graded, vec2(v_uv.x, 1.0 - v_uv.y));
  if (u_view != 0) {
    fragColor = base;
    return;
  }
  float distance = length(v_uv - u_focus_center);
  float t = clamp((distance - u_focus_radius) / max(u_focus_falloff, 1e-6), 0.0, 1.0);
  float coc = u_max_coc * t * t * (3.0 - 2.0 * t);
  if (coc < 1e-5) {
    fragColor = base;
    return;
  }
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= u_taps) break;
    vec4 tap = texelFetch(u_psf, ivec2(i, 0), 0);
    vec2 sampleUv = v_uv + tap.xy * coc;
    sum += texture(u_graded, vec2(sampleUv.x, 1.0 - sampleUv.y)) * tap.z;
  }
  sum.a = base.a;
  fragColor = sum;
}`;

interface Surface {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  size: number;
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

class OpticalPoc {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private vao: WebGLVertexArrayObject;
  private sceneProgram: WebGLProgram;
  private geometryProgram: WebGLProgram;
  private bokehProgram: WebGLProgram;
  private sceneSurface: Surface | null = null;
  private sceneKey = '';
  private sceneRenderMs = 0;
  private gradedSurface: Surface | null = null;
  private psfTexture: WebGLTexture;
  private psfKey = '';
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

    const psf = gl.createTexture();
    if (!psf) throw new Error('Failed to allocate PSF texture');
    this.psfTexture = psf;
    gl.bindTexture(gl.TEXTURE_2D, psf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private createSurface(size: number): Surface {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new Error('Failed to allocate framebuffer');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Framebuffer is incomplete');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, size };
  }

  private ensureScene(size: number, scene: PocConfig['scene']): Surface {
    const key = `${size}:${scene}`;
    if (this.sceneSurface && this.sceneKey === key) {
      this.sceneRenderMs = 0;
      return this.sceneSurface;
    }
    if (this.sceneSurface) {
      this.gl.deleteFramebuffer(this.sceneSurface.fbo);
      this.gl.deleteTexture(this.sceneSurface.tex);
    }
    this.sceneSurface = this.createSurface(size);
    this.sceneKey = key;
    const gl = this.gl;
    const surface = this.sceneSurface;
    const start = performance.now();
    gl.bindFramebuffer(gl.FRAMEBUFFER, surface.fbo);
    gl.viewport(0, 0, size, size);
    gl.useProgram(this.sceneProgram);
    gl.uniform1i(gl.getUniformLocation(this.sceneProgram, 'u_scene'), scene === 'grid' ? 0 : scene === 'colour' ? 1 : 2);
    gl.uniform1f(gl.getUniformLocation(this.sceneProgram, 'u_short'), size);
    this.drawQuad();
    this.sync();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.sceneRenderMs = performance.now() - start;
    return surface;
  }

  private ensureGraded(size: number): Surface {
    if (this.gradedSurface && this.gradedSurface.size === size) return this.gradedSurface;
    if (this.gradedSurface) {
      this.gl.deleteFramebuffer(this.gradedSurface.fbo);
      this.gl.deleteTexture(this.gradedSurface.tex);
    }
    this.gradedSurface = this.createSurface(size);
    return this.gradedSurface;
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

  private configureMask(mask: PocMask): void {
    const gl = this.gl;
    const p = this.geometryProgram;
    const kind =
      mask.kind === 'none' ? 0 : mask.kind === 'radial' ? 1 : mask.kind === 'linear' ? 2 : mask.kind === 'brush' ? 3 : mask.kind === 'luma' ? 4 : 5;
    gl.uniform1i(gl.getUniformLocation(p, 'u_mask_kind'), kind);
    gl.uniform1f(gl.getUniformLocation(p, 'u_mask_feather'), 0);
    if (mask.kind === 'radial') {
      gl.uniform2f(gl.getUniformLocation(p, 'u_mask_center'), mask.center[0], mask.center[1]);
      gl.uniform2f(gl.getUniformLocation(p, 'u_mask_radius'), mask.radius[0], mask.radius[1]);
      gl.uniform1f(gl.getUniformLocation(p, 'u_mask_rotation'), mask.rotation);
      gl.uniform1f(gl.getUniformLocation(p, 'u_mask_feather'), mask.feather);
    } else if (mask.kind === 'linear') {
      gl.uniform2f(gl.getUniformLocation(p, 'u_mask_p0'), mask.start[0], mask.start[1]);
      gl.uniform2f(gl.getUniformLocation(p, 'u_mask_p1'), mask.end[0], mask.end[1]);
      gl.uniform1f(gl.getUniformLocation(p, 'u_mask_feather'), mask.feather);
    } else if (mask.kind === 'brush') {
      const segments = new Float32Array(8 * 4);
      const count = Math.min(8, Math.max(0, mask.points.length - 1));
      for (let i = 0; i < count; i++) {
        segments[i * 4] = mask.points[i][0];
        segments[i * 4 + 1] = mask.points[i][1];
        segments[i * 4 + 2] = mask.points[i + 1][0];
        segments[i * 4 + 3] = mask.points[i + 1][1];
      }
      gl.uniform4fv(gl.getUniformLocation(p, 'u_brush_segments[0]'), segments);
      gl.uniform1i(gl.getUniformLocation(p, 'u_brush_count'), count);
      gl.uniform1f(gl.getUniformLocation(p, 'u_brush_radius'), mask.radius);
      gl.uniform1f(gl.getUniformLocation(p, 'u_brush_hardness'), mask.hardness);
      gl.uniform1f(gl.getUniformLocation(p, 'u_brush_flow'), mask.flow);
    } else if (mask.kind === 'luma') {
      gl.uniform1f(gl.getUniformLocation(p, 'u_luma_lo'), mask.lo);
      gl.uniform1f(gl.getUniformLocation(p, 'u_luma_hi'), mask.hi);
      gl.uniform1f(gl.getUniformLocation(p, 'u_mask_feather'), mask.feather);
    } else if (mask.kind === 'color') {
      const hsl = rgbToHsl({ r: mask.color[0], g: mask.color[1], b: mask.color[2] });
      gl.uniform3f(gl.getUniformLocation(p, 'u_color_hsl'), hsl.h, hsl.s, hsl.l);
      gl.uniform3f(gl.getUniformLocation(p, 'u_color_ranges'), mask.hueRange, mask.satRange, mask.lumRange);
      gl.uniform1f(gl.getUniformLocation(p, 'u_mask_feather'), mask.feather);
    }
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
    };
    this.config = config;
    const size = Math.min(2048, Math.max(64, Math.round(config.size)));
    this.canvas.width = size;
    this.canvas.height = size;

    const scene = this.ensureScene(size, config.scene);
    const graded = this.ensureGraded(size);
    this.updatePsf(config.aperture, config.taps);

    const passes = { scene: 0, geometry: 0, bokeh: 0 };
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
    gl.viewport(0, 0, size, size);
    gl.useProgram(this.geometryProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(gl.getUniformLocation(this.geometryProgram, 'u_scene'), 0);
    gl.uniformMatrix3fv(gl.getUniformLocation(this.geometryProgram, 'u_h'), false, columnMajor(h));
    gl.uniform4f(
      gl.getUniformLocation(this.geometryProgram, 'u_dist'),
      config.distortion?.k1 ?? 0,
      config.distortion?.k2 ?? 0,
      config.distortion?.p1 ?? 0,
      config.distortion?.p2 ?? 0
    );
    gl.uniform1i(
      gl.getUniformLocation(this.geometryProgram, 'u_view'),
      config.view === 'mask' ? 1 : 0
    );
    gl.uniform1f(gl.getUniformLocation(this.geometryProgram, 'u_local_exposure'), config.localExposure);
    this.configureMask(config.mask);
    this.drawQuad();
    this.sync();
    passes.geometry = performance.now() - geometryStart;

    const bokehStart = performance.now();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size, size);
    gl.useProgram(this.bokehProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, graded.tex);
    gl.uniform1i(gl.getUniformLocation(this.bokehProgram, 'u_graded'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.psfTexture);
    gl.uniform1i(gl.getUniformLocation(this.bokehProgram, 'u_psf'), 1);
    gl.uniform1i(gl.getUniformLocation(this.bokehProgram, 'u_view'), config.view === 'composite' ? 0 : 2);
    gl.uniform1i(gl.getUniformLocation(this.bokehProgram, 'u_taps'), Math.min(64, config.taps));
    gl.uniform2f(gl.getUniformLocation(this.bokehProgram, 'u_focus_center'), config.focus.center[0], config.focus.center[1]);
    gl.uniform1f(gl.getUniformLocation(this.bokehProgram, 'u_focus_radius'), config.focus.radius);
    gl.uniform1f(gl.getUniformLocation(this.bokehProgram, 'u_focus_falloff'), config.focus.falloff);
    gl.uniform1f(gl.getUniformLocation(this.bokehProgram, 'u_max_coc'), config.focus.maxCoc);
    this.drawQuad();
    this.sync();
    passes.bokeh = performance.now() - bokehStart;

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
