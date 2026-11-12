export type CameraEffect = 'dateStamp' | 'glow' | 'halation' | 'softness';
export interface DateStampSettings {
  enabled: boolean;
  date: string;
  source: 'manual' | 'exif' | 'today';
  format: 'compact' | 'padded' | 'full';
  position: 'bottom-right' | 'bottom-left';
  size: number;
  color: string;
  glow: number;
  opacity: number;
}
export interface OpticalSettings {
  glow: number;
  halation: number;
  softness: number;
  quality: 'standard' | 'high';
}
export interface CameraSettings {
  dateStamp: DateStampSettings;
  optics: OpticalSettings;
}
export const DEFAULT_CAMERA: CameraSettings = {
  dateStamp: { enabled: false, date: '', source: 'manual', format: 'compact', position: 'bottom-right', size: 3, color: '#ff792b', glow: 35, opacity: 85 },
  optics: { glow: 0, halation: 0, softness: 0, quality: 'standard' },
};
export function isValidStampDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d] = value.split('-').map(Number);
  const date = new Date(0); date.setUTCFullYear(y,m-1,d); date.setUTCHours(0,0,0,0);
  return y >= 1 && y <= 9999 && date.getUTCFullYear() === y && date.getUTCMonth() === m-1 && date.getUTCDate() === d;
}
export function normalizeCamera(value?: Partial<CameraSettings> | null): CameraSettings {
  const stamp = value?.dateStamp, optics = value?.optics;
  const clamp = (v: unknown, min: number, max: number, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max,Math.max(min,v)) : fallback;
  const date = isValidStampDate(stamp?.date) ? stamp.date : '';
  return {
    dateStamp: {
      enabled: stamp?.enabled === true && !!date, date,
      source: stamp?.source === 'exif' || stamp?.source === 'today' ? stamp.source : 'manual',
      format: stamp?.format === 'padded' || stamp?.format === 'full' ? stamp.format : 'compact',
      position: stamp?.position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
      size: clamp(stamp?.size, 1, 6, DEFAULT_CAMERA.dateStamp.size),
      color: typeof stamp?.color === 'string' && /^#[0-9a-f]{6}$/i.test(stamp.color) ? stamp.color : DEFAULT_CAMERA.dateStamp.color,
      glow: clamp(stamp?.glow,0,100,35), opacity: clamp(stamp?.opacity,0,100,85),
    },
    optics: {
      glow: clamp(optics?.glow,0,100,0), halation: clamp(optics?.halation,0,100,0), softness: clamp(optics?.softness,0,100,0),
      quality: optics?.quality === 'high' ? 'high' : 'standard',
    },
  };
}
export function localCalendarDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
