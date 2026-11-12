import { ShareResult } from '../types/export';

/**
 * Checks if the Web Share API is available and supports file sharing.
 */
export function isFileShareSupported(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return false;
  }
  if (typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    const testFile = new File(['test'], 'test.png', { type: 'image/png' });
    return navigator.canShare({ files: [testFile] });
  } catch {
    return false;
  }
}

/**
 * Checks if a specific File can be shared via the Web Share API.
 */
export function canShareFile(file: File): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return false;
  }
  if (typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Triggers the browser's native share workflow for a given File.
 * Note: To satisfy transient user activation constraints (iOS Safari / Android Chrome),
 * this function should be invoked synchronously inside the user's click handler
 * with an already-prepared File object (zero preceding awaits).
 */
export async function sharePreparedFile(
  file: File,
  options?: { title?: string; text?: string }
): Promise<ShareResult> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return {
      success: false,
      error: 'Web Share API is not supported on this browser or platform.',
    };
  }

  const shareData: ShareData = {
    files: [file],
    title: options?.title || file.name,
    text: options?.text || 'Developed with HD2Lab Film Studio',
  };

  try {
    if (typeof navigator.canShare === 'function' && !navigator.canShare(shareData)) {
      return {
        success: false,
        error: 'This device does not support sharing this file format.',
      };
    }

    await navigator.share(shareData);
    return { success: true };
  } catch (err: any) {
    // Handle clean user dismissal of native share sheet
    const isAbort =
      err?.name === 'AbortError' ||
      err?.code === 20 ||
      (typeof err?.message === 'string' &&
        (err.message.toLowerCase().includes('abort') ||
          err.message.toLowerCase().includes('canceled') ||
          err.message.toLowerCase().includes('cancelled')));

    if (isAbort) {
      return { success: false, cancelled: true };
    }

    return {
      success: false,
      error: err?.message || 'Failed to share image through native share sheet.',
    };
  }
}

/**
 * Detects if the current platform is iOS (iPhone/iPad/iPod).
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isAppleTouch =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isAppleTouch;
}

/**
 * Detects if the current platform is Android.
 */
export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent || '');
}
