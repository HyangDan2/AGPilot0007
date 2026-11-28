import { MemoryBudgetError } from './errors';

export function videoMemoryBudgetMB(requested?: number): { budgetMB: number; heapLimitMB: number | null } {
  if (requested && requested > 0) return { budgetMB: requested, heapLimitMB: null };
  const limit = (performance as unknown as { memory?: { jsHeapSizeLimit?: number } }).memory?.jsHeapSizeLimit;
  const budgetMB = limit ? Math.min(512, Math.floor((limit / 1048576) * 0.3)) : 256;
  return { budgetMB, heapLimitMB: limit ? Math.round(limit / 1048576) : null };
}

/** Encoded output plus three RGBA frame surfaces (decode, grade, encoder copy). */
export function estimateVideoExportBytes(input: {
  bitrate: number;
  durationSec: number;
  audioBitrate: number;
  frameWidth: number;
  frameHeight: number;
}): { encoded: number; frameBytes: number; total: number } {
  const encoded = Math.ceil(((input.bitrate + input.audioBitrate) / 8) * input.durationSec * 1.25);
  const frameBytes = input.frameWidth * input.frameHeight * 4 * 3;
  return { encoded, frameBytes, total: encoded + frameBytes };
}

export function assertVideoBudget(estimateBytes: number, budgetMB: number): void {
  const budgetBytes = budgetMB * 1048576;
  if (estimateBytes <= budgetBytes) return;
  throw new MemoryBudgetError(
    `estimated video export ${(estimateBytes / 1048576).toFixed(1)} MB exceeds the ${budgetMB} MB budget`,
    { estimateMB: Number((estimateBytes / 1048576).toFixed(1)), budgetMB },
  );
}
