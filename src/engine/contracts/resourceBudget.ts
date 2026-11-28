import { IMAGE_BUFFER_BYTES_PER_PIXEL, type ImageBufferFormat } from './imageBuffer';

export type RenderMode = 'preview' | 'export';
export type RenderQuality = 'proxy' | 'tile' | 'full';

export interface DeviceCapabilities {
  hardwareConcurrency: number;
  deviceMemoryGb?: number;
  mobile: boolean;
  maxTextureSize: number;
  floatRenderTarget: boolean;
}

export interface ResourceBudget {
  maxCpuBytes: number;
  maxGpuBytes: number;
  maxTextureSize: number;
  maxPreviewEdge: number;
  maxConcurrency: number;
  floatRenderTarget: boolean;
}

export interface RenderResourceRequest {
  width: number;
  height: number;
  format: ImageBufferFormat;
  floatIntermediate: boolean;
  mode: RenderMode;
}

export interface TilePlan {
  width: number;
  height: number;
  columns: number;
  rows: number;
}

export type ResourceRejectionReason =
  | 'invalid-request'
  | 'float-render-target-unsupported'
  | 'budget-exceeded'
  | 'concurrency-limit';

export interface ResourceDecision {
  allowed: boolean;
  quality: RenderQuality;
  width: number;
  height: number;
  estimatedBytes: number;
  scale: number;
  tile?: TilePlan;
  reason?: ResourceRejectionReason;
  message?: string;
}

export const RESOURCE_GUIDANCE: Readonly<Record<ResourceRejectionReason, string>> = Object.freeze({
  'invalid-request': 'The requested image size is invalid. Choose a different image.',
  'float-render-target-unsupported':
    'High-precision rendering is unavailable on this device. Export in standard precision or use a supported browser.',
  'budget-exceeded':
    'This image exceeds the available graphics memory. Close other tabs or export at a smaller size.',
  'concurrency-limit':
    'Another export is already running. Wait for it to finish or reduce the batch size.',
});

export const DEFAULT_RESOURCE_BUDGET: ResourceBudget = Object.freeze({
  maxCpuBytes: 512 * 1024 * 1024,
  maxGpuBytes: 512 * 1024 * 1024,
  maxTextureSize: 8192,
  maxPreviewEdge: 2048,
  maxConcurrency: 2,
  floatRenderTarget: true,
});

const MIN_TILE_EDGE = 256;
const MIN_PREVIEW_EDGE = 16;
const MB = 1024 * 1024;

export function createResourceBudget(overrides: Partial<ResourceBudget> = {}): ResourceBudget {
  const concurrency = Math.floor(overrides.maxConcurrency ?? DEFAULT_RESOURCE_BUDGET.maxConcurrency);
  return {
    ...DEFAULT_RESOURCE_BUDGET,
    ...overrides,
    maxConcurrency: Math.max(1, Number.isFinite(concurrency) ? concurrency : 1),
  };
}

export function detectDeviceCapabilities(input: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const mobile =
    input.mobile ??
    (typeof nav !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || ''));
  return {
    hardwareConcurrency: Math.max(
      1,
      Math.floor(input.hardwareConcurrency ?? nav?.hardwareConcurrency ?? 4),
    ),
    deviceMemoryGb: input.deviceMemoryGb ?? (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory,
    mobile,
    maxTextureSize: input.maxTextureSize ?? (mobile ? 4096 : 8192),
    floatRenderTarget: input.floatRenderTarget ?? true,
  };
}

/** Conservative per-device budget used by both the batch queue and renderer. */
export function budgetForDevice(capabilities: DeviceCapabilities = detectDeviceCapabilities()): ResourceBudget {
  const memory = capabilities.deviceMemoryGb;
  const gpu = memory === undefined ? (capabilities.mobile ? 256 : 512) : Math.min(1024, Math.max(128, memory * 64));
  const cpu = capabilities.mobile ? 256 : 512;
  const concurrency = Math.min(4, Math.max(1, capabilities.hardwareConcurrency - 1), capabilities.mobile ? 2 : 3);
  return createResourceBudget({
    maxGpuBytes: gpu * MB,
    maxCpuBytes: cpu * MB,
    maxTextureSize: capabilities.maxTextureSize,
    maxPreviewEdge: capabilities.mobile ? 1536 : 2048,
    maxConcurrency: concurrency,
    floatRenderTarget: capabilities.floatRenderTarget,
  });
}

export function estimateFrameBytes(width: number, height: number, format: ImageBufferFormat): number {
  return width * height * IMAGE_BUFFER_BYTES_PER_PIXEL[format];
}

function rejected(
  reason: ResourceRejectionReason,
  quality: RenderQuality,
  width: number,
  height: number,
  estimatedBytes: number,
  scale = 1,
): ResourceDecision {
  return {
    allowed: false,
    quality,
    width,
    height,
    estimatedBytes,
    scale,
    reason,
    message: RESOURCE_GUIDANCE[reason],
  };
}

export function decideResourceAllocation(
  request: RenderResourceRequest,
  budget: ResourceBudget,
): ResourceDecision {
  const fallbackQuality: RenderQuality = request.mode === 'preview' ? 'proxy' : 'tile';
  if (
    !Number.isSafeInteger(request.width) ||
    !Number.isSafeInteger(request.height) ||
    request.width <= 0 ||
    request.height <= 0 ||
    !(request.format in IMAGE_BUFFER_BYTES_PER_PIXEL)
  ) {
    return rejected('invalid-request', fallbackQuality, request.width, request.height, 0);
  }

  const buffers = request.floatIntermediate ? 2 : 1;
  const estimatedBytes = estimateFrameBytes(request.width, request.height, request.format) * buffers;
  if (request.floatIntermediate && !budget.floatRenderTarget) {
    return rejected('float-render-target-unsupported', fallbackQuality, request.width, request.height, estimatedBytes);
  }

  if (request.mode === 'preview') {
    const maxEdge = Math.min(budget.maxTextureSize, budget.maxPreviewEdge);
    let scale = Math.min(1, maxEdge / Math.max(request.width, request.height));
    if (estimatedBytes * scale * scale > budget.maxGpuBytes && budget.maxGpuBytes > 0) {
      scale = Math.min(scale, Math.sqrt(budget.maxGpuBytes / estimatedBytes));
    }
    const width = Math.max(1, Math.floor(request.width * scale));
    const height = Math.max(1, Math.floor(request.height * scale));
    if (Math.max(width, height) < MIN_PREVIEW_EDGE) {
      return rejected('budget-exceeded', 'proxy', request.width, request.height, estimatedBytes, scale);
    }
    return {
      allowed: true,
      quality: scale < 1 ? 'proxy' : 'full',
      width,
      height,
      estimatedBytes,
      scale,
    };
  }

  if (Math.max(request.width, request.height) <= budget.maxTextureSize && estimatedBytes <= budget.maxGpuBytes) {
    return {
      allowed: true,
      quality: 'full',
      width: request.width,
      height: request.height,
      estimatedBytes,
      scale: 1,
    };
  }

  const perPixel = IMAGE_BUFFER_BYTES_PER_PIXEL[request.format] * buffers;
  const tilePixels = Math.floor(budget.maxGpuBytes / Math.max(1, perPixel * 2));
  const tileEdge = Math.min(budget.maxTextureSize, Math.floor(Math.sqrt(Math.max(1, tilePixels))));
  if (tileEdge < MIN_TILE_EDGE) {
    return rejected('budget-exceeded', 'tile', request.width, request.height, estimatedBytes);
  }
  return {
    allowed: true,
    quality: 'tile',
    width: request.width,
    height: request.height,
    estimatedBytes,
    scale: 1,
    tile: {
      width: tileEdge,
      height: tileEdge,
      columns: Math.ceil(request.width / tileEdge),
      rows: Math.ceil(request.height / tileEdge),
    },
  };
}

export interface ResourceGrant {
  readonly id: number;
  readonly decision: ResourceDecision;
  readonly released: boolean;
  release(): void;
}

export type ResourceRequestResult =
  | { allowed: true; grant: ResourceGrant }
  | { allowed: false; decision: ResourceDecision };

/**
 * Shared allocation point for the batch queue and interactive renderer. A grant
 * reserves budget until release; callers must release after export, cancel or
 * failure so a later job can proceed.
 */
export class ResourceBroker {
  private readonly grants = new Map<number, { decision: ResourceDecision }>();
  private nextId = 1;
  private bytes = 0;

  constructor(readonly budget: ResourceBudget = createResourceBudget()) {}

  get activeCount(): number {
    return this.grants.size;
  }

  get usedBytes(): number {
    return this.bytes;
  }

  request(request: RenderResourceRequest): ResourceRequestResult {
    const decision = decideResourceAllocation(request, this.budget);
    if (!decision.allowed) return { allowed: false, decision };
    if (this.activeCount >= this.budget.maxConcurrency) {
      return {
        allowed: false,
        decision: { ...decision, allowed: false, reason: 'concurrency-limit', message: RESOURCE_GUIDANCE['concurrency-limit'] },
      };
    }
    if (this.bytes + decision.estimatedBytes > this.budget.maxGpuBytes) {
      return {
        allowed: false,
        decision: { ...decision, allowed: false, reason: 'budget-exceeded', message: RESOURCE_GUIDANCE['budget-exceeded'] },
      };
    }

    const id = this.nextId++;
    const entry = { decision };
    this.grants.set(id, entry);
    this.bytes += decision.estimatedBytes;
    const broker = this;
    let released = false;
    return {
      allowed: true,
      grant: {
        id,
        decision,
        get released() {
          return released;
        },
        release() {
          if (released) return;
          released = true;
          if (broker.grants.delete(id)) broker.bytes -= entry.decision.estimatedBytes;
        },
      },
    };
  }

  releaseAll(): void {
    this.grants.clear();
    this.bytes = 0;
  }
}

export const createResourceBroker = (budget?: ResourceBudget): ResourceBroker => new ResourceBroker(budget);
