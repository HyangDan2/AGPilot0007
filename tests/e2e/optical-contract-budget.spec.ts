import { test, expect, type Page } from '@playwright/test';
import type { PocConfig, PocMask } from '../../poc/optical/gpu/optical-poc';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Optical contract budget probe is verified on desktop Chromium');
});

async function openPoc(page: Page): Promise<void> {
  await page.goto('/poc/optical/gpu/optical-poc.html');
  await page.waitForFunction(() => window.__opticalPoc?.ready === true, null, { timeout: 30000 });
}

function render(page: Page, config: Partial<PocConfig>) {
  return page.evaluate((patch) => window.__opticalPoc!.render(patch), config);
}

function linePoints(count: number, y: number): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i < count; i++) points.push([0.05 + (0.9 * i) / (count - 1), y]);
  return points;
}

test('measures GL limits and links a 16-mask optical uniform set', async ({ page }) => {
  await openPoc(page);
  const report = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 is not available');

    const vertexSource = `#version 300 es
      layout(location=0) in vec2 a_position;
      void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;
    // Mirrors the geometry pass uniform layout at Q01 MAX_MASKS = 16.
    const fragmentSource = `#version 300 es
      precision highp float;
      uniform sampler2D u_scene;
      uniform sampler2D u_brush;
      uniform mat3 u_h;
      uniform vec4 u_dist;
      uniform int u_view;
      uniform float u_aspect;
      uniform float u_exposure;
      uniform int u_mask_count;
      uniform int u_mask_kind[16];
      uniform int u_mask_blend[16];
      uniform int u_mask_invert[16];
      uniform vec4 u_mask_a[16];
      uniform vec4 u_mask_b[16];
      uniform vec2 u_mask_c[16];
      uniform float u_mask_opacity[16];
      out vec4 fragColor;
      void main() {
        float acc = 0.0;
        for (int i = 0; i < 16; i++) {
          acc += float(u_mask_kind[i] + u_mask_blend[i] + u_mask_invert[i]);
          acc += u_mask_a[i].x + u_mask_b[i].w + u_mask_c[i].x + u_mask_opacity[i];
        }
        acc += u_aspect + u_exposure + float(u_view) + u_h[0][0] + u_dist.x;
        acc += texture(u_scene, vec2(0.5, 0.5)).x + texture(u_brush, vec2(0.5, 0.5)).x;
        acc += float(u_mask_count);
        fragColor = vec4(acc);
      }`;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('shader allocation failed');
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`compile failed: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const program = gl.createProgram();
    if (!program) throw new Error('program allocation failed');
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    const linked = gl.getProgramParameter(program, gl.LINK_STATUS) === true;
    const linkLog = linked ? '' : String(gl.getProgramInfoLog(program));

    const uniforms: Array<{ name: string; size: number; type: number }> = [];
    if (linked) {
      const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
      for (let i = 0; i < count; i++) {
        const info = gl.getActiveUniform(program, i);
        if (info) uniforms.push({ name: info.name, size: info.size, type: info.type });
      }
    }

    const lastMask = {
      a: linked && !!gl.getUniformLocation(program, 'u_mask_a[15]'),
      b: linked && !!gl.getUniformLocation(program, 'u_mask_b[15]'),
      c: linked && !!gl.getUniformLocation(program, 'u_mask_c[15]'),
      kind: linked && !!gl.getUniformLocation(program, 'u_mask_kind[15]'),
      opacity: linked && !!gl.getUniformLocation(program, 'u_mask_opacity[15]'),
    };

    const masks = 16;
    const strokes = 64;
    const strokePoints = 1024;
    const worstSegments = masks * strokes * (strokePoints - 1);
    const worstBytes = worstSegments * 32;
    const texture = { width: 4096, height: 512 };
    const textureBytes = texture.width * texture.height * 16;
    const textureCapacitySegments = (texture.width / 2) * texture.height;
    const pocTable = { width: 512, height: 32 };
    const pocSegments = (pocTable.width / 2) * pocTable.height;

    return {
      linked,
      linkLog,
      lastMask,
      uniforms,
      maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number,
      maxVertexUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) as number,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number,
      conservativeMaskVectors: 3 * masks + 2 * masks + masks + masks / 4,
      brush: {
        worstSegments,
        worstBytes,
        texture,
        textureBytes,
        textureCapacitySegments,
        pocTable,
        pocSegments,
        pocBytes: pocSegments * 32,
      },
    };
  });

  console.log(`[optical-contract] gl_limits=${JSON.stringify(report)}`);
  expect(report.linked).toBe(true);
  expect(report.lastMask).toEqual({ a: true, b: true, c: true, kind: true, opacity: true });
  expect(report.uniforms.some((uniform) => uniform.name.startsWith('u_mask_a') && uniform.size === 16)).toBe(true);
  expect(report.maxFragmentUniformVectors).toBeGreaterThan(report.conservativeMaskVectors);
  expect(report.maxTextureSize).toBeGreaterThanOrEqual(4096);
  expect(report.brush.worstSegments).toBe(16 * 64 * 1023);
  expect(report.brush.textureCapacitySegments).toBeGreaterThanOrEqual(report.brush.worstSegments);
});

test('measures brush segment cost at the PoC per-mask cap', async ({ page }) => {
  await openPoc(page);
  const timings: Record<string, { geometry: number; total: number; segments: number }> = {};

  for (const maskCount of [1, 2, 4]) {
    const masks: PocMask[] = [];
    for (let i = 0; i < maskCount; i++) {
      masks.push({
        kind: 'brush',
        strokes: [{ points: linePoints(1025, 0.2 + i * 0.15), radius: 0.02, hardness: 0.7, flow: 0.9 }],
      });
    }
    const config: Partial<PocConfig> = {
      size: 128,
      aspect: 1,
      scene: 'colour',
      view: 'mask',
      perspective: { vertical: 0, horizontal: 0, strength: 0.15 },
      rotationDeg: 0,
      distortion: null,
      masks,
      mask: { kind: 'none' },
      localExposure: 0,
      focus: { center: [-10, -10], radius: 0, falloff: 1, maxCoc: 0 },
      aperture: { blades: 6, rotation: 0, roundness: 0.2 },
      taps: 32,
      bokehScale: 1,
    };
    await render(page, config);
    let geometry = 0;
    let total = 0;
    const frames = 2;
    for (let i = 0; i < frames; i++) {
      const result = await render(page, config);
      geometry += result.passes.geometry;
      total += result.totalMs;
    }
    timings[maskCount] = {
      geometry: geometry / frames,
      total: total / frames,
      segments: maskCount * 1024,
    };
  }

  const pixels = 128 * 128;
  const perMillion = (timings[4].geometry / (timings[4].segments * pixels)) * 1e6;
  const worstCase = {
    masks: 16,
    segmentsPerMask: 64 * 1023,
    pixels: 512 * 512,
    extrapolatedMs: (perMillion * 16 * 64 * 1023 * 512 * 512) / 1e6,
  };
  console.log(
    `[optical-contract] brush_cost=${JSON.stringify({ timings, perMillionSegmentPixelMs: perMillion, worstCase })}`
  );

  expect(timings[1].geometry).toBeGreaterThan(0);
  expect(timings[2].geometry).toBeGreaterThan(0);
  expect(timings[4].geometry).toBeGreaterThan(0);
  expect(timings[4].geometry).toBeLessThan(30000);
});