import { DEFAULT_ADJUSTMENTS, FilmProfile } from '../types/film';
export const RETRO90: FilmProfile = {
  cameraEffects: ['dateStamp', 'glow', 'halation', 'softness'],
  id: 'FS-010', code: 'RETRO90', name: 'RETRO 90', style: 'Night Amber',
  description: 'Deep night shadows, warm amber lamps and gentle compact-camera character.',
  technicalTarget: 'Warm midtones, restrained yellow-green highlights and a smooth highlight shoulder.',
  lutFile: 'luts/FS-010_RETRO90.cube', lutSize: 33, version: '1.0.0',
  defaultAdjustments: { ...DEFAULT_ADJUSTMENTS, exposure: -.35, contrast: 22, highlights: -30, shadows: -28, temperature: 24, tint: -8, saturation: -12, grain: 28, sharpness: 0, vignette: 32, filmStrength: 100 },
  grain: { amount: 28, size: 24, roughness: 45 },
  provenance: { source: 'HD2Lab original compact-camera interpretation', license: 'MIT / HD2Lab Original Formula', methodology: 'Original sRGB tone and luminance-weighted amber color transform; not an inverse reconstruction.' },
};
