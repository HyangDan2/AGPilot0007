import type { ImageBuffer } from './imageBuffer';
import type { MaskData } from './masks';

export const AI_CONTRACT_VERSION = 1;
export const AI_PHASE = 'phase-2';

/**
 * Phase 2 extension points only. No AI runtime is implemented, registered or
 * exposed in Phase 1; CORE_AI_MODULES must stay empty until an approved
 * Phase 2 work order adds a real implementation and UI.
 */
export const AI_CAPABILITIES = [
  'enhance',
  'denoise',
  'upscale',
  'subject-mask',
  'sky-replace',
  'style-transfer',
] as const;

export type AICapability = (typeof AI_CAPABILITIES)[number];

export const AI_OUTPUT_KINDS = [
  'image-buffer',
  'mask',
  'depth-map',
  'embedding',
  'recommendation',
] as const;

export type AIOutputKind = (typeof AI_OUTPUT_KINDS)[number];

export interface AIDepthMap {
  width: number;
  height: number;
  data: Float32Array;
  near: number;
  far: number;
  sourceId: string;
}

export interface AIEmbedding {
  modelId: string;
  dimensions: number;
  vector: Float32Array;
}

export interface AIRecommendation {
  id: string;
  kind: 'film' | 'adjustment' | 'crop' | 'style';
  score: number;
  payload: Record<string, string | number | boolean>;
}

export interface AIModuleDescriptor {
  id: string;
  version: string;
  capability: AICapability;
  requiresGpu: boolean;
  input: 'image-buffer';
  output: AIOutputKind | readonly AIOutputKind[];
}

export interface AIRequest {
  source: ImageBuffer;
  signal?: AbortSignal;
}

export interface AIResult {
  image?: ImageBuffer;
  mask?: MaskData;
  depthMap?: AIDepthMap;
  embedding?: AIEmbedding;
  recommendations?: AIRecommendation[];
  metadata?: Record<string, string | number>;
}

export interface AIModule {
  readonly descriptor: AIModuleDescriptor;
  prepare?(): Promise<void>;
  run(request: AIRequest): Promise<AIResult>;
  dispose?(): void;
}

export const CORE_AI_MODULES: readonly AIModule[] = Object.freeze([]);

export const isAIModuleAvailable = (): false => false;

export function validateAIModuleDescriptor(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid AI module descriptor');
  const descriptor = value as AIModuleDescriptor;
  if (typeof descriptor.id !== 'string' || descriptor.id.length === 0 || descriptor.id.length > 100) {
    throw new Error('Invalid AI module descriptor');
  }
  if (typeof descriptor.version !== 'string' || descriptor.version.length === 0) {
    throw new Error('Invalid AI module descriptor');
  }
  if (!AI_CAPABILITIES.includes(descriptor.capability)) throw new Error('Invalid AI module capability');
  if (typeof descriptor.requiresGpu !== 'boolean') throw new Error('Invalid AI module descriptor');
  if (descriptor.input !== 'image-buffer') throw new Error('Invalid AI module input');
  const outputs = Array.isArray(descriptor.output) ? descriptor.output : [descriptor.output];
  if (
    outputs.length === 0 ||
    new Set(outputs).size !== outputs.length ||
    outputs.some((output) => !AI_OUTPUT_KINDS.includes(output as AIOutputKind))
  ) {
    throw new Error('Invalid AI module output');
  }
}
