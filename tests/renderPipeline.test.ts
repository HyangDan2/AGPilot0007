import { describe, expect, it } from 'vitest';
import { DEFAULT_ADJUSTMENTS } from '../src/types/film';
import { createCoreRenderRegistry } from '../src/engine/contracts/renderPlan';
import type { EditModuleRegistry } from '../src/engine/contracts/moduleRegistry';
import {
  assertRenderPlanParity,
  runRenderPipeline,
  runRenderPipelineSync,
  type RenderPipelineBackend,
  type RenderPipelineRequest,
} from '../src/engine/pipeline/renderPipeline';
import { sourceStageWithinLimit } from '../src/engine/renderer/webglPipelineBackend';

const settings = { adjustments: { ...DEFAULT_ADJUSTMENTS }, filmId: 'FS-010' as const };

function request(overrides: Partial<RenderPipelineRequest> = {}): RenderPipelineRequest {
  return { target: 'export', width: 640, height: 480, dpr: 1, settings, ...overrides };
}

function registryWith(executed: string[]): EditModuleRegistry {
  const registry = createCoreRenderRegistry();
  registry.register({
    id: 'test.look',
    stage: 'look',
    contractVersion: 1,
    isActive: () => true,
    execute: () => {
      executed.push('test.look');
    },
  });
  registry.register({
    id: 'test.detail',
    stage: 'detail',
    contractVersion: 1,
    isActive: () => true,
    execute: () => {
      executed.push('test.detail');
    },
  });
  return registry;
}

describe('render pipeline executor', () => {
  it('executes active modules in stage order exactly once and renders the backend', () => {
    const executed: string[] = [];
    const frames: string[] = [];
    const backend: RenderPipelineBackend = {
      render(frame) {
        frames.push(frame.fingerprint);
      },
    };
    const result = runRenderPipelineSync(request({ registry: registryWith(executed) }), backend);
    expect(executed).toEqual(['test.look', 'test.detail']);
    expect(result.executedModules).toEqual(['test.look', 'test.detail']);
    expect(result.fingerprint).toBe(frames[0]);
    expect(result.session.scope.disposed).toBe(true);
  });

  it('awaits asynchronous modules and backend once in stage order', async () => {
    const executed: string[] = [];
    const registry = registryWith(executed);
    registry.register({
      id: 'test.asyncTone',
      stage: 'tone',
      contractVersion: 1,
      isActive: () => true,
      execute: async () => {
        await Promise.resolve();
        executed.push('test.asyncTone');
      },
    });
    const result = await runRenderPipeline(request({ registry }), {
      render: async () => {
        await Promise.resolve();
        executed.push('backend');
      },
    });
    expect(executed).toEqual(['test.asyncTone', 'test.look', 'test.detail', 'backend']);
    expect(result.session.scope.disposed).toBe(true);
  });

  it('rejects asynchronous modules in the synchronous preview path', () => {
    const executed: string[] = [];
    const registry = registryWith(executed);
    registry.register({
      id: 'test.asyncLook',
      stage: 'look',
      contractVersion: 1,
      isActive: () => true,
      execute: async () => {
        executed.push('test.asyncLook');
      },
    });
    expect(() => runRenderPipelineSync(request({ registry }), { render: () => {
      executed.push('backend');
    } })).toThrow(
      'Pipeline module is asynchronous: test.asyncLook',
    );
    expect(executed).toEqual(['test.look', 'test.asyncLook']);
  });

  it('stops before the backend when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    let rendered = false;
    expect(() =>
      runRenderPipelineSync(request({ signal: controller.signal }), { render: () => {
        rendered = true;
      } }),
    ).toThrow(/AbortError|cancel/);
    expect(rendered).toBe(false);
  });

  it('propagates abort raised between stages and cancels the session', () => {
    const controller = new AbortController();
    const executed: string[] = [];
    const registry = createCoreRenderRegistry();
    registry.register({
      id: 'test.abortLook',
      stage: 'look',
      contractVersion: 1,
      isActive: () => true,
      execute: () => {
        executed.push('test.abortLook');
        controller.abort();
      },
    });
    registry.register({
      id: 'test.detail',
      stage: 'detail',
      contractVersion: 1,
      isActive: () => true,
      execute: () => {
        executed.push('test.detail');
      },
    });
    let rendered = false;
    expect(() =>
      runRenderPipelineSync(request({ registry, signal: controller.signal }), {
        render: () => {
          rendered = true;
        },
      }),
    ).toThrow(/AbortError|cancel/);
    expect(executed).toEqual(['test.abortLook']);
    expect(rendered).toBe(false);
  });

  it('cancels the session and rethrows backend failures', async () => {
    await expect(
      runRenderPipeline(request(), {
        render: () => {
          throw new Error('renderer lost');
        },
      }),
    ).rejects.toThrow('renderer lost');
  });

  it('rejects invalid ImageBuffer input at the pipeline boundary', () => {
    expect(() => runRenderPipelineSync(request({ source: { bad: true } as never }), { render: () => {} })).toThrow(
      'Invalid image buffer',
    );
  });

  it('reports preview/export fingerprints as equal for the same settings', () => {
    expect(assertRenderPlanParity(settings)).toBe(
      assertRenderPlanParity({ adjustments: { ...DEFAULT_ADJUSTMENTS }, filmId: 'FS-010' }),
    );
  });

  it('skips the source stage above the 8192px WebGL2 safety limit', () => {
    expect(sourceStageWithinLimit(8192, 8192)).toBe(true);
    expect(sourceStageWithinLimit(8193, 4096)).toBe(false);
    expect(sourceStageWithinLimit(4096, 8193)).toBe(false);
  });
});
