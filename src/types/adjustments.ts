import { AdjustmentSettings } from './film';

export type AdjustmentCategory = 'film' | 'light' | 'color' | 'texture';

export interface AdjustmentDef {
  key: keyof AdjustmentSettings;
  label: string;
  category: AdjustmentCategory;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit: string;
  description: string;
}

export const ADJUSTMENT_DEFINITIONS: AdjustmentDef[] = [
  // Film
  {
    key: 'filmStrength',
    label: 'Film Strength',
    category: 'film',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 100,
    unit: '%',
    description: 'Intensity of the selected 3D film simulation LUT.',
  },
  // Light & Contrast
  {
    key: 'exposure',
    label: 'Exposure',
    category: 'light',
    min: -3.0,
    max: 3.0,
    step: 0.05,
    defaultValue: 0,
    unit: ' EV',
    description: 'Linear exposure compensation in exposure values.',
  },
  {
    key: 'contrast',
    label: 'Contrast',
    category: 'light',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    unit: '',
    description: 'Perceptual contrast expansion around midtone gray.',
  },
  {
    key: 'highlights',
    label: 'Highlights',
    category: 'light',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    unit: '',
    description: 'Highlight recovery or compression.',
  },
  {
    key: 'shadows',
    label: 'Shadows',
    category: 'light',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    unit: '',
    description: 'Shadow toe lift or compression.',
  },
  ...(['whites', 'blacks'] as const).map(key => ({ key, label: key === 'whites' ? 'Whites' : 'Blacks', category: 'light' as const, min: -100, max: 100, step: 1, defaultValue: 0, unit: '', description: key === 'whites' ? 'Adjust the brightest tonal endpoint.' : 'Adjust the darkest tonal endpoint.' })),
  // Color & White Balance
  {
    key: 'temperature',
    label: 'Temperature',
    category: 'color',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    unit: '',
    description: 'Blue (cool) to Amber (warm) chromatic balance.',
  },
  {
    key: 'tint',
    label: 'Tint',
    category: 'color',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    unit: '',
    description: 'Green to Magenta chromatic balance.',
  },
  {
    key: 'saturation',
    label: 'Saturation',
    category: 'color',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    unit: '',
    description: 'Luminance-preserving global color saturation.',
  },
  // Texture & Optics
  {
    key: 'grain',
    label: 'Film Grain',
    category: 'texture',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 0,
    unit: '',
    description: 'Luminance-modulated silver halide emulsion grain.',
  },
  {
    key: 'sharpness',
    label: 'Sharpness',
    category: 'texture',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 0,
    unit: '',
    description: 'Laplacian high-pass edge micro-contrast.',
  },
  {
    key: 'vignette',
    label: 'Vignette',
    category: 'texture',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 0,
    unit: '',
    description: 'Optical lens periphery falloff.',
  },
];

export const CATEGORY_LABELS: Record<AdjustmentCategory, string> = {
  film: 'Film Simulation',
  light: 'Light & Contrast',
  color: 'Color Balance',
  texture: 'Texture & Optics',
};
