import { test, expect } from '@playwright/test';

test('Q02 lens blur chunk matches the CPU gather', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'GLSL parity runs in Chromium');
  await page.goto('/');

  const result: any = await page.evaluate(async () => {
    const {
      LENS_BLUR_FRAGMENT,
      blurRgbaReference,
      normalizeLensBlurState,
      planLensBlur,
    } = await import('../../src/engine/optical/lensBlur');

    const W = 64;
    const H = 64;
    const plan = planLensBlur(
      normalizeLensBlurState({
        enabled: true,
        focusPlane: 0.5,
        focusRange: 0.1,
        aperture: 1,
        bladeCount: 6,
        rotationDeg: 0,
        quality: 'export',
        highlightBoost: 0,
        depthMask: null,
      }),
      { width: W, height: H },
      { maxTextureSize: 4096 },
    );
    if (!plan) return { error: 'plan unexpectedly null' };

    const bytes = new Uint8Array(W * H * 4);
    const src = new Float32Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const index = (y * W + x) * 4;
        const value = Math.round(
          255 * Math.min(1, Math.max(0, 0.1 + (0.6 * x) / (W - 1) + (0.2 * y) / (H - 1))),
        );
        bytes[index] = value;
        bytes[index + 1] = value;
        bytes[index + 2] = value;
        bytes[index + 3] = 255;
        src[index] = value / 255;
        src[index + 1] = value / 255;
        src[index + 2] = value / 255;
        src[index + 3] = 1;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) return { error: 'WebGL2 unavailable' };

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
      }
      return shader;
    };

    const vertex = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;
    const fragment = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;
${LENS_BLUR_FRAGMENT}
void main() {
  vec3 base = texture(u_q02_lens_scene, vUv).rgb;
  outColor = vec4(q02_lens_blur(base, vUv), 1.0);
}`;

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
    }
    gl.useProgram(program);
    gl.viewport(0, 0, W, H);

    const scene = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const psf = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, psf);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 64, 1, 0, gl.RGBA, gl.FLOAT, plan.psf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    const depth = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, depth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([0.5]));

    gl.uniform1i(gl.getUniformLocation(program, 'u_q02_lens_scene'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_q02_lens_psf'), 1);
    gl.uniform1i(gl.getUniformLocation(program, 'u_q02_lens_depth'), 2);
    gl.uniform1i(gl.getUniformLocation(program, 'u_q02_lens_taps'), plan.tapCount);
    gl.uniform1i(gl.getUniformLocation(program, 'u_q02_lens_use_depth'), 0);
    gl.uniform1f(gl.getUniformLocation(program, 'u_q02_lens_aspect'), 1);
    gl.uniform1f(gl.getUniformLocation(program, 'u_q02_lens_focus_plane'), plan.focusPlane);
    gl.uniform1f(gl.getUniformLocation(program, 'u_q02_lens_focus_range'), plan.focusRange);
    gl.uniform1f(gl.getUniformLocation(program, 'u_q02_lens_falloff'), plan.falloff);
    gl.uniform1f(gl.getUniformLocation(program, 'u_q02_lens_max_coc'), plan.maxCocShortSide);
    gl.uniform4f(
      gl.getUniformLocation(program, 'u_q02_lens_guard'),
      plan.guardBand,
      0,
      0,
      0,
    );
    gl.uniform1f(gl.getUniformLocation(program, 'u_q02_lens_highlight_boost'), 0);

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixels = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const cpu = blurRgbaReference(src, W, H, plan);
    let maxError = 0;
    let sumError = 0;
    let count = 0;
    for (let y = 6; y < H - 6; y++) {
      // vUv = pos, so framebuffer row 0 is v=0 and matches texture row 0 (no flip).
      const readRow = y;
      for (let x = 6; x < W - 6; x++) {
        const offset = (readRow * W + x) * 4;
        const diff = Math.abs(pixels[offset] / 255 - cpu[(y * W + x) * 4]);
        maxError = Math.max(maxError, diff);
        sumError += diff;
        count++;
      }
    }

    const glError = gl.getError();
    return {
      maxError,
      meanError: sumError / count,
      tapCount: plan.tapCount,
      error: glError === gl.NO_ERROR ? undefined : `GL error ${glError}`,
    };
  });

  expect(result.error).toBeUndefined();
  expect(result.tapCount).toBeGreaterThan(1);
  expect(result.meanError).toBeLessThan(0.005);
  expect(result.maxError).toBeLessThan(0.02);
});
