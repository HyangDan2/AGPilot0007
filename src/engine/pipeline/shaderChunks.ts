import { MIXER_SHADER } from '../color/colorMixer';
import { RGB_BASE_SHADER } from '../color/rgbBase';
import { SHARPENING_SHADER } from '../color/sharpening';

/**
 * Ordered GLSL helper chunks for render features. New feature shaders must be
 * registered here so the single shared fragment program composes them once.
 */
export const FRAGMENT_FEATURE_CHUNKS: readonly string[] = [MIXER_SHADER, RGB_BASE_SHADER, SHARPENING_SHADER];

export const FRAGMENT_FEATURE_SOURCE = FRAGMENT_FEATURE_CHUNKS.join('\n');
