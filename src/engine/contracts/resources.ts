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
  };
}
