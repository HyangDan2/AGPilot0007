/**
 * Shared export control contract for Q04 batch cancellation (IF-01 / APP-03).
 * Rendering and encoding are synchronous inside prepareExportImage, so callers
 * get stage notifications and an AbortSignal checked at every stage boundary.
 */
export type ExportStage = 'render' | 'encode' | 'complete';

export interface ExportControl {
  signal?: AbortSignal;
  onStage?: (stage: ExportStage) => void;
}

export function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Export cancelled', 'AbortError');
  }
  const error = new Error('Export cancelled');
  error.name = 'AbortError';
  return error;
}

export function throwIfExportAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}
