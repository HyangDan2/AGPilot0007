import type { ImageBuffer } from '../contracts/imageBuffer';
import { validateImageBuffer } from '../contracts/imageBuffer';
import type { EditModuleRegistry } from '../contracts/moduleRegistry';
import {
  createCoreRenderRegistry,
  renderPlanFingerprint,
  resolveRenderPlan,
  type RenderPlan,
  type RenderTargetKind,
} from '../contracts/renderPlan';
import { createRenderSession, type RenderSession } from '../contracts/resources';
import { createAbortError } from '../contracts/exportControl';
import type { RenderSettings } from './renderSettings';

/** Preview-only flags that never influence exported pixels. */
export interface PreviewRequestFlags {
  compareMode: 'none' | 'original' | 'split';
  splitPos: number;
  seed?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  sharpeningMask?: boolean;
  sharpeningDraft?: boolean;
  mixerReference?: boolean;
  mixerVisualize?: string | null;
}

export interface RenderPipelineFrame {
  target: RenderTargetKind;
  width: number;
  height: number;
  dpr: number;
  settings: RenderSettings;
  plan: RenderPlan;
  fingerprint: string;
  source?: ImageBuffer;
  signal?: AbortSignal;
  extras?: PreviewRequestFlags;
}

export interface RenderPipelineBackend {
  render(frame: RenderPipelineFrame): void | Promise<void>;
}

export interface RenderPipelineRequest {
  target: RenderTargetKind;
  width: number;
  height: number;
  dpr: number;
  settings: RenderSettings;
  source?: ImageBuffer;
  signal?: AbortSignal;
  registry?: EditModuleRegistry;
  extras?: PreviewRequestFlags;
}

export interface RenderPipelineResult {
  plan: RenderPlan;
  fingerprint: string;
  executedModules: string[];
  session: RenderSession;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  !!value && typeof (value as PromiseLike<unknown>).then === 'function';

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function prepare(request: RenderPipelineRequest) {
  const registry = request.registry ?? createCoreRenderRegistry();
  const plan = resolveRenderPlan(request.settings, request.target, registry);
  if (request.source !== undefined) {
    validateImageBuffer(request.source);
    throwIfAborted(request.signal);
  }
  return {
    registry,
    plan,
    fingerprint: renderPlanFingerprint(plan),
    frame: {
      target: request.target,
      width: request.width,
      height: request.height,
      dpr: request.dpr,
      settings: request.settings,
      plan,
      fingerprint: renderPlanFingerprint(plan),
      source: request.source,
      signal: request.signal,
      extras: request.extras,
    } satisfies RenderPipelineFrame,
  };
}

function modulesForStage(registry: EditModuleRegistry, plan: RenderPlan, stage: string): string[] {
  const active = new Set(plan.activeModules);
  return plan.activeModules.filter(
    (id) => active.has(id) && registry.get(id)?.stage === stage && !!registry.get(id)?.execute,
  );
}

function renderContext(request: RenderPipelineRequest) {
  return { target: request.target, settings: request.settings };
}

function endSession(session: RenderSession): void {
  session.finish();
}

/**
 * Executes the resolved render plan against a backend. Stage order comes from
 * RenderPlan; modules participate only through EditModuleRegistry.execute.
 * The render session owns the resource scope and is finished or cancelled
 * exactly once.
 */
export function runRenderPipelineSync(
  request: RenderPipelineRequest,
  backend: RenderPipelineBackend,
): RenderPipelineResult {
  const { registry, plan, fingerprint, frame } = prepare(request);
  const session = createRenderSession();
  const executedModules: string[] = [];
  try {
    for (const stage of plan.stages) {
      throwIfAborted(request.signal);
      for (const id of modulesForStage(registry, plan, stage)) {
        throwIfAborted(request.signal);
        const pending = registry.get(id)!.execute!(renderContext(request));
        if (isThenable(pending)) {
          throw new Error(`Pipeline module is asynchronous: ${id}`);
        }
        executedModules.push(id);
      }
    }
    throwIfAborted(request.signal);
    const pending = backend.render(frame);
    if (isThenable(pending)) throw new Error('Render backend is asynchronous in a sync pipeline run');
    endSession(session);
    return { plan, fingerprint, executedModules, session };
  } catch (error) {
    session.cancel();
    throw error;
  }
}

/** Async variant for backends or modules that await GPU work or workers. */
export async function runRenderPipeline(
  request: RenderPipelineRequest,
  backend: RenderPipelineBackend,
): Promise<RenderPipelineResult> {
  const { registry, plan, fingerprint, frame } = prepare(request);
  const session = createRenderSession();
  const executedModules: string[] = [];
  try {
    for (const stage of plan.stages) {
      throwIfAborted(request.signal);
      for (const id of modulesForStage(registry, plan, stage)) {
        throwIfAborted(request.signal);
        await registry.get(id)!.execute!(renderContext(request));
        executedModules.push(id);
      }
    }
    throwIfAborted(request.signal);
    await backend.render(frame);
    endSession(session);
    return { plan, fingerprint, executedModules, session };
  } catch (error) {
    session.cancel();
    throw error;
  }
}

/**
 * Preview and export must resolve the same feature set for the same persisted
 * settings. Target and preview-only flags are excluded from the fingerprint.
 */
export function assertRenderPlanParity(
  settings: RenderSettings,
  registry: EditModuleRegistry = createCoreRenderRegistry(),
): string {
  const preview = renderPlanFingerprint(resolveRenderPlan(settings, 'preview', registry));
  const exported = renderPlanFingerprint(resolveRenderPlan(settings, 'export', registry));
  if (preview !== exported) {
    throw new Error(`Preview and export render plans diverge: ${preview} != ${exported}`);
  }
  return preview;
}
