import { test, expect } from '@playwright/test';

test('CPU and GPU geometry inverse mappings agree for the shared transform order', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'GLSL reference parity runs in Chromium');
  await page.goto('/');

  const result: any = await page.evaluate(async () => {
    const { geometryToSource, rotatedAspect } = await import('../../src/engine/contracts/geometryMappings');

    const POINTS = 8;
    const sourceAspect = 4 / 3;
    const scenarios = [
      { name: 'identity', geometry: { rotation: 0, straighten: 0, flipHorizontal: false, flipVertical: false, crop: null }, aspect: sourceAspect },
      { name: 'flips', geometry: { rotation: 0, straighten: 0, flipHorizontal: true, flipVertical: true, crop: null }, aspect: sourceAspect },
      { name: 'rotate90', geometry: { rotation: 90, straighten: 0, flipHorizontal: false, flipVertical: false, crop: null }, aspect: sourceAspect },
      { name: 'straighten', geometry: { rotation: 0, straighten: 12, flipHorizontal: false, flipVertical: false, crop: null }, aspect: sourceAspect },
      { name: 'crop', geometry: { rotation: 0, straighten: 0, flipHorizontal: false, flipVertical: false, crop: { x: 0.2, y: 0.15, width: 0.55, height: 0.65 } }, aspect: sourceAspect },
      { name: 'compound', geometry: { rotation: 270, straighten: -8, flipHorizontal: false, flipVertical: false, crop: { x: 0.2, y: 0.15, width: 0.55, height: 0.65 } }, aspect: sourceAspect },
    ] as const;

    const canvas = document.createElement('canvas');
    canvas.width = POINTS;
    canvas.height = 1;
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
uniform float uRotation;
uniform float uStraighten;
uniform float uFlipH;
uniform float uFlipV;
uniform vec4 uCrop;
uniform float uAspect;
out vec4 outColor;
void main() {
  vec2 p = vUv;
  if (uCrop.z > 0.0) p = p * uCrop.zw + uCrop.xy;
  if (abs(uStraighten) > 1e-6) {
    float rad = radians(uStraighten);
    float c = cos(rad);
    float s = sin(rad);
    float scale = max(abs(c) + abs(s) / uAspect, uAspect * abs(s) + abs(c));
    float cx = (p.x - 0.5) * uAspect;
    float cy = p.y - 0.5;
    float x = (c * cx + s * cy) / scale;
    float y = (-s * cx + c * cy) / scale;
    p = vec2(x / uAspect + 0.5, y + 0.5);
  }
  if (abs(uRotation - 90.0) < 0.5) p = vec2(p.y, 1.0 - p.x);
  else if (abs(uRotation - 180.0) < 0.5) p = vec2(1.0 - p.x, 1.0 - p.y);
  else if (abs(uRotation - 270.0) < 0.5) p = vec2(1.0 - p.y, p.x);
  if (uFlipH > 0.5) p.x = 1.0 - p.x;
  if (uFlipV > 0.5) p.y = 1.0 - p.y;
  outColor = vec4(p, 0.0, 1.0);
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
    gl.viewport(0, 0, POINTS, 1);

    const setFloat = (name: string, value: number) => gl.uniform1f(gl.getUniformLocation(program, name), value);
    const pixels = new Uint8Array(POINTS * 4);
    const output: Array<{ name: string; maxError: number; points: Array<{ gpu: [number, number]; cpu: [number, number] }> }> = [];

    for (const scenario of scenarios) {
      const geometry = { ...scenario.geometry, crop: scenario.geometry.crop ? { ...scenario.geometry.crop } : null };
      setFloat('uRotation', geometry.rotation);
      setFloat('uStraighten', geometry.straighten);
      setFloat('uFlipH', geometry.flipHorizontal ? 1 : 0);
      setFloat('uFlipV', geometry.flipVertical ? 1 : 0);
      setFloat('uAspect', rotatedAspect(geometry.rotation, scenario.aspect));
      const crop = geometry.crop ?? { x: 0, y: 0, width: 0, height: 0 };
      gl.uniform4f(gl.getUniformLocation(program, 'uCrop'), crop.x, crop.y, crop.width, crop.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, POINTS, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      let maxError = 0;
      const points: Array<{ gpu: [number, number]; cpu: [number, number] }> = [];
      for (let index = 0; index < POINTS; index++) {
        const gpu: [number, number] = [pixels[index * 4] / 255, pixels[index * 4 + 1] / 255];
        const cpuPoint = geometryToSource({ x: (index + 0.5) / POINTS, y: 0.5 }, geometry, scenario.aspect);
        const cpu: [number, number] = [cpuPoint.x, cpuPoint.y];
        maxError = Math.max(maxError, Math.abs(gpu[0] - cpu[0]), Math.abs(gpu[1] - cpu[1]));
        points.push({ gpu, cpu });
      }
      output.push({ name: scenario.name, maxError, points });
    }

    const glError = gl.getError();
    return { output, error: glError === gl.NO_ERROR ? undefined : `GL error ${glError}` };
  });

  expect(result.error).toBeUndefined();
  for (const scenario of result.output!) {
    expect(scenario.maxError, `${scenario.name} mapping`).toBeLessThan(0.012);
  }
});
