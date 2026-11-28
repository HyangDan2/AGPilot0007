import { test, expect } from '@playwright/test';

test('local stage GLSL compiles and matches the planned blend order', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'GLSL parity runs in Chromium');
  await page.goto('/');

  const results: any = await page.evaluate(async () => {
    const { LOCAL_STAGE_FRAGMENT } = await import('../../src/engine/local/maskRaster');

    const size = 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) return { error: 'WebGL2 unavailable' };

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
in vec2 vUv;
out vec4 outColor;
${LOCAL_STAGE_FRAGMENT}
void main() {
  outColor = vec4(q02_local_stage(vec3(0.5), vUv), 1.0);
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
    gl.viewport(0, 0, size, size);

    const makeMaskTexture = (coverage: number) => {
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = 1;
      maskCanvas.height = 1;
      const context = maskCanvas.getContext('2d')!;
      const value = Math.round(coverage * 255);
      context.fillStyle = `rgb(${value},${value},${value})`;
      context.fillRect(0, 0, 1, 1);
      const texture = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      return texture;
    };

    const sampleMask = gl.getUniformLocation(program, 'u_q02_local_masks[0]');
    const count = gl.getUniformLocation(program, 'u_q02_local_group_count');
    const opacity = gl.getUniformLocation(program, 'u_q02_local_group_opacity[0]');
    const blend = gl.getUniformLocation(program, 'u_q02_local_group_blend[0]');
    const adjustA = gl.getUniformLocation(program, 'u_q02_local_adjust_a[0]');

    const run = (coverage: number, groupCount: number, exposure: number, blendMode: number) => {
      makeMaskTexture(coverage);
      gl.uniform1i(sampleMask, 0);
      gl.uniform1i(count, groupCount);
      gl.uniform1f(opacity, 1);
      gl.uniform1i(blend, blendMode);
      gl.uniform4f(adjustA, exposure, 0, 0, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const pixel = new Uint8Array(4);
      gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return pixel[0];
    };

    const expected = (coverage: number, groupCount: number, exposure: number, blendMode: number) => {
      const adjusted = Math.min(1, 0.5 * Math.pow(2, exposure));
      if (groupCount === 0 || coverage === 0) return Math.round(0.5 * 255);
      if (blendMode === 1) return Math.round(0.5 * 255);
      return Math.round((0.5 + (adjusted - 0.5) * coverage) * 255);
    };

    const cases = [
      { coverage: 1, count: 0, exposure: 0, blend: 0 },
      { coverage: 1, count: 1, exposure: 0, blend: 0 },
      { coverage: 1, count: 1, exposure: 1, blend: 0 },
      { coverage: 0.5, count: 1, exposure: 1, blend: 0 },
      { coverage: 0, count: 1, exposure: 1, blend: 0 },
      { coverage: 1, count: 1, exposure: 1, blend: 1 },
    ];

    return cases.map((item) => ({
      ...item,
      actual: run(item.coverage, item.count, item.exposure, item.blend),
      expected: expected(item.coverage, item.count, item.exposure, item.blend),
      texture: gl.getError(),
    }));
  });

  expect(results.error).toBeUndefined();
  for (const item of results) {
    expect(item.texture).toBe(0);
    expect(Math.abs(item.actual - item.expected)).toBeLessThanOrEqual(2);
  }
});
