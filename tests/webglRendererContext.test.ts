import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebGL2FilmRenderer } from '../src/engine/renderer/webglRenderer';

const harness = () => {
  const lose = vi.fn();
  const gl: any = {
    deleteTexture: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteVertexArray: vi.fn(),
    deleteProgram: vi.fn(),
    getExtension: vi.fn((name: string) =>
      name === 'WEBGL_lose_context' ? { loseContext: lose } : null,
    ),
  };
  const listeners: Record<string, (event?: any) => void> = {};
  const canvas: any = {
    width: 1,
    height: 1,
    isConnected: false,
    getContext: vi.fn(() => gl),
    addEventListener: vi.fn((type: string, handler: (event?: any) => void) => {
      listeners[type] = handler;
    }),
  };
  vi.spyOn(WebGL2FilmRenderer.prototype as any, 'initPipeline').mockImplementation(function (
    this: any,
  ) {
    this.isInitialized = true;
    this.program = { id: 'fake-program' };
  });
  return { canvas, gl, lose, listeners };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WebGL2FilmRenderer context lifecycle', () => {
  it('releases the WebGL context exactly once on destroy', () => {
    const { canvas, lose } = harness();
    const renderer = new WebGL2FilmRenderer(canvas);
    expect(renderer.isReady()).toBe(true);

    renderer.destroy();
    expect(lose).toHaveBeenCalledTimes(1);
    expect(renderer.isReady()).toBe(false);

    renderer.destroy();
    expect(lose).toHaveBeenCalledTimes(1);
  });

  it('ignores webglcontextrestored after destroy', () => {
    const { canvas, listeners } = harness();
    const onRestored = vi.fn();
    const renderer = new WebGL2FilmRenderer(canvas, onRestored);
    const contextCalls = canvas.getContext.mock.calls.length;

    renderer.destroy();
    listeners.webglcontextrestored();

    expect(canvas.getContext).toHaveBeenCalledTimes(contextCalls);
    expect(onRestored).not.toHaveBeenCalled();
    expect(renderer.isReady()).toBe(false);
  });

  it('keeps the context restorable when the canvas is still attached', () => {
    const { canvas, lose } = harness();
    canvas.isConnected = true;
    const renderer = new WebGL2FilmRenderer(canvas);

    renderer.destroy();
    expect(lose).not.toHaveBeenCalled();
    expect(renderer.isReady()).toBe(false);
  });
});
