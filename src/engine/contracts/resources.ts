export type ResourceKind = 'texture' | 'buffer' | 'program' | 'render-target' | 'worker';

export interface GpuResource {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly bytes: number;
  dispose(): void;
}

export interface ResourceScope {
  readonly disposed: boolean;
  readonly resources: readonly GpuResource[];
  acquire<T extends GpuResource>(factory: () => T): T;
  release(resource: GpuResource): void;
  disposeAll(): void;
  /** Mark the scope dead without calling GL deletes, e.g. after context loss. */
  abandon(): void;
}

export interface Releasable {
  release(): void;
}

export interface RenderSession {
  readonly scope: ResourceScope;
  readonly active: boolean;
  finish(): void;
  cancel(): void;
}

/**
 * Explicit ownership for GPU/worker resources. Modules acquire through the
 * scope and the renderer disposes it on context loss, inactive teardown and
 * destroy; disposal runs in reverse acquisition order.
 */
export function createResourceScope(): ResourceScope {
  const owned = new Set<GpuResource>();
  let disposed = false;
  return {
    get disposed() {
      return disposed;
    },
    get resources() {
      return [...owned];
    },
    acquire<T extends GpuResource>(factory: () => T): T {
      if (disposed) throw new Error('Resource scope disposed');
      const resource = factory();
      owned.add(resource);
      return resource;
    },
    release(resource: GpuResource): void {
      if (owned.delete(resource)) resource.dispose();
    },
    disposeAll(): void {
      if (disposed) return;
      disposed = true;
      for (const resource of [...owned].reverse()) {
        try {
          resource.dispose();
        } catch {
          // Continue releasing the remaining resources.
        }
      }
      owned.clear();
    },
    abandon(): void {
      if (disposed) return;
      disposed = true;
      owned.clear();
    },
  };
}

/**
 * Acquires a group atomically from the scope's point of view: if any factory
 * throws, already-acquired resources are disposed in reverse order and the
 * original error is rethrown.
 */
export function acquireAll<T extends GpuResource>(
  scope: ResourceScope,
  factories: readonly (() => T)[],
): T[] {
  const acquired: T[] = [];
  try {
    for (const factory of factories) acquired.push(scope.acquire(factory));
    return acquired;
  } catch (error) {
    for (const resource of [...acquired].reverse()) {
      try {
        scope.release(resource);
      } catch {
        // Keep unwinding: the allocation error is the actionable failure.
      }
    }
    throw error;
  }
}

/**
 * One render/cancel lifecycle. Both finish and cancel are idempotent so a
 * repeated run cannot leak the previous scope or its resource budget lease.
 */
export function createRenderSession(lease?: Releasable): RenderSession {
  const scope = createResourceScope();
  let active = true;
  const end = (): void => {
    if (!active) return;
    active = false;
    try {
      scope.disposeAll();
    } finally {
      lease?.release();
    }
  };
  return {
    get scope() {
      return scope;
    },
    get active() {
      return active;
    },
    finish: end,
    cancel: end,
  };
}
