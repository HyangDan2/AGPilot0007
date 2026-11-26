import { PIPELINE_STAGES, stageIndex, type PipelineStage } from './stages';

export interface EditModule<TSettings = unknown> {
  readonly id: string;
  readonly stage: PipelineStage;
  readonly requires?: readonly string[];
  readonly contractVersion: 1;
  normalize?(value: unknown): TSettings;
  validate?(value: unknown): void;
}

export interface RegisteredModule {
  readonly id: string;
  readonly stage: PipelineStage;
  readonly requires: readonly string[];
  readonly contractVersion: 1;
}

/**
 * Shared module registry. Feature work orders register modules here instead of
 * editing the renderer; the core resolves a deterministic dependency order.
 */
export class EditModuleRegistry {
  private readonly modules = new Map<string, EditModule<any>>();

  register(module: EditModule<any>): void {
    if (!module || typeof module.id !== 'string' || module.id.length === 0) {
      throw new Error('Invalid module id');
    }
    if (this.modules.has(module.id)) throw new Error(`Duplicate module: ${module.id}`);
    if (!PIPELINE_STAGES.includes(module.stage)) throw new Error(`Unknown module stage: ${module.stage}`);
    if (module.contractVersion !== 1) throw new Error(`Unsupported module contract version: ${module.contractVersion}`);
    for (const dependency of module.requires ?? []) {
      const target = this.modules.get(dependency);
      if (!target) continue;
      if (stageIndex(target.stage) > stageIndex(module.stage)) {
        throw new Error(`Module dependency crosses later stage: ${dependency}`);
      }
    }
    this.modules.set(module.id, module);
  }

  get<T = unknown>(id: string): EditModule<T> | undefined {
    return this.modules.get(id) as EditModule<T> | undefined;
  }

  list(stage?: PipelineStage): RegisteredModule[] {
    return [...this.modules.values()]
      .filter((module) => stage === undefined || module.stage === stage)
      .map(({ id, stage: moduleStage, requires, contractVersion }) => ({
        id,
        stage: moduleStage,
        requires: requires ?? [],
        contractVersion,
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
    const queue = ids.filter((id) => indegree.get(id) === 0);
    const order: string[] = [];
    while (queue.length > 0) {
      queue.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
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
