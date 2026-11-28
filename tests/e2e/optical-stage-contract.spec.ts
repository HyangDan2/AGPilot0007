import { test, expect } from '@playwright/test';

test('Q02 geometry stage chunk matches the CPU inverse mapping', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'GLSL parity runs in Chromium');
  await page.goto('/');

  const result: any = await page.evaluate(async () => {
    const { geometryOutputToSource, geometryUniforms, GEOMETRY_SHADER_CHUNK } = await import(
      '../../src/engine/optical/geometry'
    );
    const { normalizeGeometry } = await import('../../src/engine/contracts/geometry');

    const W = 64;
    const H = 48;
    const sourceAspect = 4 / 3;
    const scenarios = [
      normalizeGeometry({
        rotation: 90,
        straighten: 3,
        flipHorizontal: true,
        crop: { x: 0.08, y: 0.04, width: 0.84, height: 0.8 },
      }),
      normalizeGeometry({
        rotation: 270,
        straighten: -5,
        flipHorizontal: true,
        flipVertical: true,
        crop: { x: 0.1, y: 0.12, width: 0.7, height: 0.75 },
      }),
    ];

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) return { error: 'WebGL2 unavailable' };

    const vertex = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(pos.x, 1.0 - pos.y);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;
    const fragment = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${GEOMETRY_SHADER_CHUNK}
void main() {
  vec2 p = q02_geometry_output_to_source(vUv);
  outColor = vec4(clamp(p, 0.0, 1.0), 0.0, 1.0);
}`;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
      }
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
    }
    gl.useProgram(program);
    gl.viewport(0, 0, W, H);

    const setFloat = (name: string, value: number) =>
      gl.uniform1f(gl.getUniformLocation(program, name), value);
    const pixels = new Uint8Array(W * H * 4);
    const output: Array<{ index: number; maxError: number }> = [];

    for (const [scenarioIndex, geometry] of scenarios.entries()) {
      const uniforms = geometryUniforms(geometry, sourceAspect);
      setFloat('u_q02_geometry_rotation', uniforms.rotation);
      setFloat('u_q02_geometry_straighten', uniforms.straighten);
      setFloat('u_q02_geometry_aspect', uniforms.aspect);
      gl.uniform2f(gl.getUniformLocation(program, 'u_q02_geometry_flip'), uniforms.flip[0], uniforms.flip[1]);
      gl.uniform4f(
        gl.getUniformLocation(program, 'u_q02_geometry_crop'),
        uniforms.crop[0],
        uniforms.crop[1],
        uniforms.crop[2],
        uniforms.crop[3],
      );
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      let maxError = 0;
      for (let y = 0; y < H; y++) {
        const readRow = H - 1 - y;
        for (let x = 0; x < W; x++) {
          const offset = (readRow * W + x) * 4;
          const cpu = geometryOutputToSource({ x: (x + 0.5) / W, y: (y + 0.5) / H }, geometry, sourceAspect);
          maxError = Math.max(
            maxError,
            Math.abs(pixels[offset] / 255 - Math.min(1, Math.max(0, cpu.x))),
            Math.abs(pixels[offset + 1] / 255 - Math.min(1, Math.max(0, cpu.y))),
          );
        }
      }
      output.push({ index: scenarioIndex, maxError });
    }

    const glError = gl.getError();
    return { output, error: glError === gl.NO_ERROR ? undefined : `GL error ${glError}` };
  });

  expect(result.error).toBeUndefined();
  for (const scenario of result.output!) {
    expect(scenario.maxError, `geometry scenario ${scenario.index}`).toBeLessThan(0.012);
  }
});

test('Q02 optical stage chunk matches the CPU mapping and the preview/export plan', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'GLSL parity runs in Chromium');
  await page.goto('/');

  const result: any = await page.evaluate(async () => {
    const { opticalCorrectedToSource, opticalUniforms, OPTICAL_SHADER_CHUNK } = await import(
      '../../src/engine/optical/transform'
    );
    const { createOpticalTransform, createPerspectiveQuad } = await import(
      '../../src/engine/contracts/optical'
    );
    const { createQ02RenderRegistry } = await import('../../src/engine/optical/modules');
    const { renderPlanFingerprint, resolveRenderPlan } = await import('../../src/engine/contracts/renderPlan');
    const { DEFAULT_ADJUSTMENTS } = await import('../../src/types/film');

    const W = 64;
    const H = 64;
    const transform = createOpticalTransform({
      homography: [1.01, 0.005, -0.004, -0.002, 0.99, 0.006, 0.0002, -0.0001, 1],
      distortion: { k1: -0.05, k2: 0.01, p1: 0.003, p2: -0.002 },
      perspective: createPerspectiveQuad(0.2, -0.15),
    });

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) return { error: 'WebGL2 unavailable' };

    const vertex = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(pos.x, 1.0 - pos.y);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;
    const fragment = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${OPTICAL_SHADER_CHUNK}
void main() {
  vec2 p = q02_optical_corrected_to_source(vUv);
  outColor = vec4(clamp(p, 0.0, 1.0), 0.0, 1.0);
}`;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
      }
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
    }
    gl.useProgram(program);
    gl.viewport(0, 0, W, H);

    const uniforms = opticalUniforms(transform);
    gl.uniformMatrix3fv(gl.getUniformLocation(program, 'u_q02_optical_h'), false, uniforms.homography);
    gl.uniform4f(
      gl.getUniformLocation(program, 'u_q02_optical_radial'),
      uniforms.radial[0],
      uniforms.radial[1],
      uniforms.radial[2],
      uniforms.radial[3],
    );
    gl.uniform2f(gl.getUniformLocation(program, 'u_q02_optical_tangential'), uniforms.tangential[0], uniforms.tangential[1]);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixels = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let maxError = 0;
    for (let y = 0; y < H; y++) {
      const readRow = H - 1 - y;
      for (let x = 0; x < W; x++) {
        const offset = (readRow * W + x) * 4;
        const cpu = opticalCorrectedToSource({ x: (x + 0.5) / W, y: (y + 0.5) / H }, transform);
        maxError = Math.max(
          maxError,
          Math.abs(pixels[offset] / 255 - Math.min(1, Math.max(0, cpu.x))),
          Math.abs(pixels[offset + 1] / 255 - Math.min(1, Math.max(0, cpu.y))),
        );
      }
    }

    const registry = createQ02RenderRegistry();
    const settings = { adjustments: DEFAULT_ADJUSTMENTS, optical: transform };
    const preview = resolveRenderPlan(settings, 'preview', registry);
    const exported = resolveRenderPlan(settings, 'export', registry);

    const glError = gl.getError();
    return {
      maxError,
      fingerprintPreview: renderPlanFingerprint(preview),
      fingerprintExport: renderPlanFingerprint(exported),
      features: preview.features,
      stages: preview.stages,
      error: glError === gl.NO_ERROR ? undefined : `GL error ${glError}`,
    };
  });

  expect(result.error).toBeUndefined();
  expect(result.maxError).toBeLessThan(0.012);
  expect(result.fingerprintExport).toBe(result.fingerprintPreview);
  expect(result.features).toContain('q02.optical.lens');
});
