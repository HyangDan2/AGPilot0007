import { FILM_PROFILES } from './registry';
import type { FilmId } from '../types/film';
import { CameraSettings, DEFAULT_CAMERA, normalizeCamera } from '../types/camera';

export function getCameraEffects(filmId?: FilmId) {
  return filmId ? FILM_PROFILES[filmId]?.cameraEffects || [] : [];
}
export function supportsCameraEffects(filmId?: FilmId) {
  return getCameraEffects(filmId).length > 0;
}
// Fail closed for unsupported/unspecified profiles, including restored recipes.
export function getEffectiveCamera(filmId: FilmId | undefined, settings?: CameraSettings): CameraSettings {
  const effects = getCameraEffects(filmId);
  if (!effects.length) return DEFAULT_CAMERA;
  const camera = normalizeCamera(settings);
  if (!effects.includes('dateStamp')) camera.dateStamp.enabled = false;
  for (const key of ['glow', 'halation', 'softness'] as const) if (!effects.includes(key)) camera.optics[key] = 0;
  return camera;
}
