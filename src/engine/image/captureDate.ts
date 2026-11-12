import { isValidStampDate } from '../../types/camera';

export function parseCaptureDate(value: unknown): string | undefined {
  // Preserve the camera's recorded calendar day. No implicit UTC/local conversion.
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{4})[:\-](\d{2})[:\-](\d{2})(?:[ T]|$)/.exec(value);
  if (!match) return undefined;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return isValidStampDate(date) ? date : undefined;
}
export async function readCaptureDate(file: Blob): Promise<{ captureDate?: string; captureDateStatus: 'available'|'missing'|'unreadable' }> {
  try {
    const { parse } = await import('exifr');
    const metadata = await parse(file, { pick: ['DateTimeOriginal'], reviveValues: false });
    const captureDate = parseCaptureDate(metadata?.DateTimeOriginal);
    return { captureDate, captureDateStatus: captureDate ? 'available' : metadata?.DateTimeOriginal ? 'unreadable' : 'missing' };
  } catch { return { captureDateStatus: 'unreadable' }; }
}
