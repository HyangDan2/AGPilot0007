import type { RenderSettings } from '../pipeline/renderSettings';
import { PIPELINE_STAGES, stageIndex, type PipelineStage } from './stages';

export type ModuleRole = 'feature' | 'stage';
export type ModuleRenderTarget = 'preview' | 'export';

export interface ModuleResourceUsage {
  gpuBytes?: number;
  cpuBytes?: number;
  floatIntermediate?: boolean;
  textures?: number;
}

export interface ModuleExecutionContext {
  target: ModuleRenderTarget;
  settings: RenderSettings;
}

export interface EditModule<TSettings = unknown> {
  readonly id: string;
  readonly stage: PipelineStage;
  readonly requires?: readonly string[];
  readonly contractVersion: 1;
  readonly role?: ModuleRole;
  isActive?(settings: RenderSettings): boolean;
  resourceUsage?(settings: RenderSettings): ModuleResourceUsage;
  execute?(context: ModuleExecutionContext): void | Promise<void>;
  normalize?(value: unknown): TSettings;
  validate?(value: unknown): void;
}

export interface RegisteredModule {
  readonly id: string;
  readonly stage: PipelineStage;
  readonly requires: readonly string[];
  readonly contractVersion: 1;
  readonly role: ModuleRole;
}

/**
 * Shared module registry. Feature work orders register modules here instead of
 * editing the renderer; the core resolves a deterministic dependency order.
 * Registered metadata is copied and frozen so callers cannot mutate the
 * registry through a retained module reference.
 */
export class EditModuleRegistry {
  private readonly modules = new Map<string, Readonly<EditModule<any>>>();

  register(module: EditModule<any>): void {
    if (!module || typeof module.id !== 'string' || module.id.length === 0) {
      throw new Error('Invalid module id');
    }
    if (this.modules.has(module.id)) throw new Error(`Duplicate module: ${module.id}`);
    if (!PIPELINE_STAGES.includes(module.stage)) throw new Error(`Unknown module stage: ${module.stage}`);
    if (module.contractVersion !== 1) throw new Error(`Unsupported module contract version: ${module.contractVersion}`);
    const requires = Object.freeze([...(module.requires ?? [])]);
    for (const dependency of requires) {
      const target = this.modules.get(dependency);
      if (!target) continue;
      if (stageIndex(target.stage) > stageIndex(module.stage)) {
        throw new Error(`Module dependency crosses later stage: ${dependency}`);
      }
    }
    this.modules.set(module.id, Object.freeze({ ...module, requires }));
  }

  get<T = unknown>(id: string): EditModule<T> | undefined {
    return this.modules.get(id) as EditModule<T> | undefined;
  }

  list(stage?: PipelineStage): RegisteredModule[] {
    return [...this.modules.values()]
      .filter((module) => stage === undefined || module.stage === stage)
      .map(({ id, stage: moduleStage, requires, contractVersion, role }) => ({
        id,
        stage: moduleStage,
        requires: [...(requires ?? [])],
        contractVersion,
        role: role ?? 'feature',
      }));
  }

  resolveOrder(stage?: PipelineStage): string[] {
    const ids = [...this.modules.keys()];
    for (const id of ids) {
      for (const dependency of this.modules.get(id)!.requires ?? []) {
        const target = this.modules.get(dependency);
        if (!target) throw new Error(`Unknown module dependency: ${dependency}`);
        if (stageIndex(target.stage) > stageIndex(this.modules.get(id)!.stage)) {
          throw new Error(`Module dependency crosses later stage: ${dependency}`);
        }
      }
    }
    const position = new Map(ids.map((id, index) => [id, index]));
    const indegree = new Map(ids.map((id) => [id, 0]));
    const dependents = new Map<string, string[]>();
    for (const id of ids) {
      for (const dependency of this.modules.get(id)!.requires ?? []) {
        indegree.set(id, (indegree.get(id) ?? 0) + 1);
        const list = dependents.get(dependency) ?? [];
        list.push(id);
        dependents.set(dependency, list);
      }
    }
    const priority = (a: string, b: string): number => {
      const stageDelta = stageIndex(this.modules.get(a)!.stage) - stageIndex(this.modules.get(b)!.stage);
      return stageDelta !== 0 ? stageDelta : (position.get(a) ?? 0) - (position.get(b) ?? 0);
    };
    const queue = ids.filter((id) => indegree.get(id) === 0);
    const order: string[] = [];
    while (queue.length > 0) {
      queue.sort(priority);
      const id = queue.shift()!;
      order.push(id);
      for (const dependent of dependents.get(id) ?? []) {
        const next = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, next);
        if (next === 0) queue.push(dependent);
      }
    }
    if (order.length !== ids.length) throw new Error('Circular module dependency');
    return stage === undefined ? order : order.filter((id) => this.modules.get(id)!.stage === stage);
  }
}

export const createModuleRegistry = (): EditModuleRegistry => new EditModuleRegistry();
