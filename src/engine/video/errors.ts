export type VideoErrorCode =
  | 'no-video-track'
  | 'decode-unavailable'
  | 'unsupported-container'
  | 'unsupported-codec'
  | 'unsupported-audio';

export class VideoCapabilityError extends Error {
  readonly code: VideoErrorCode;
  constructor(code: VideoErrorCode, message: string) {
    super(message);
    this.name = 'VideoCapabilityError';
    this.code = code;
  }
}

export class MemoryBudgetError extends Error {
  readonly code = 'MemoryBudgetExceeded';
  constructor(message: string, readonly detail: Record<string, number>) {
    super(message);
    this.name = 'MemoryBudgetError';
  }
}

export function abortError(): DOMException {
  return new DOMException('Video export cancelled', 'AbortError');
}
