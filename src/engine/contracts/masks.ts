/**
 * Shared local-mask contract. Coordinates are normalized image coordinates
 * (0..1, top-left origin); radii/feather follow the corrected image short side.
 * Q02's optical PoC must adopt this shape before masks are wired into a render
 * stage. Nothing persists or renders masks in Recipe v8 yet.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export type MaskBlend = 'add' | 'subtract' | 'intersect';

interface MaskBase {
  id: string;
  name: string;
  enabled: boolean;
  blend: MaskBlend;
  opacity: number;
  inverted: boolean;
}

export interface BrushStroke {
  points: Vec2[];
  radius: number;
  hardness: number;
  flow: number;
}

export interface BrushMask extends MaskBase {
  kind: 'brush';
  strokes: BrushStroke[];
}

export interface LinearMask extends MaskBase {
  kind: 'linear';
  start: Vec2;
  end: Vec2;
  feather: number;
}

export interface RadialMask extends MaskBase {
  kind: 'radial';
  center: Vec2;
  radiusX: number;
  radiusY: number;
  rotation: number;
  feather: number;
}

export interface LuminanceMask extends MaskBase {
  kind: 'luminance';
  lo: number;
  hi: number;
  feather: number;
}

export interface ColorMask extends MaskBase {
  kind: 'color';
  color: RGBColor;
  hueRange: number;
  satRange: number;
  lumRange: number;
  feather: number;
}

export type MaskData = BrushMask | LinearMask | RadialMask | LuminanceMask | ColorMask;

export const MAX_MASKS = 16;
export const MAX_STROKES = 64;
export const MAX_STROKE_POINTS = 1024;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const inUnit = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const axis = (value: unknown, fallback = 0.5): number => clamp(finite(value, fallback), 0, 1);
const feather = (value: unknown): number => clamp(finite(value, 0.5), 0, 1);

function normalizeStroke(value: unknown): BrushStroke | null {
  if (!isObject(value)) return null;
  const points = Array.isArray(value.points)
    ? value.points
        .slice(0, MAX_STROKE_POINTS)
        .filter(isObject)
        .map((point) => ({ x: axis(point.x), y: axis(point.y) }))
    : [];
  if (points.length === 0) return null;
  return {
    points,
    radius: clamp(finite(value.radius, 0.1), 0.001, 2),
    hardness: clamp(finite(value.hardness, 0.5), 0, 1),
    flow: clamp(finite(value.flow, 1), 0, 1),
  };
}

function common(raw: Record<string, unknown>, index: number): MaskBase {
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id.slice(0, 100) : `mask-${index}`,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 40) : `Mask ${index + 1}`,
    enabled: raw.enabled !== false,
    blend: raw.blend === 'subtract' || raw.blend === 'intersect' ? raw.blend : 'add',
    opacity: clamp(finite(raw.opacity, 1), 0, 1),
    inverted: raw.inverted === true,
  };
}

function normalizeMask(raw: unknown, index: number): MaskData | null {
  if (!isObject(raw)) return null;
  const base = common(raw, index);
  switch (raw.kind) {
    case 'brush': {
      const strokes = Array.isArray(raw.strokes)
        ? raw.strokes
            .slice(0, MAX_STROKES)
            .map(normalizeStroke)
            .filter((stroke): stroke is BrushStroke => stroke !== null)
        : [];
      return strokes.length > 0 ? { ...base, kind: 'brush', strokes } : null;
    }
    case 'linear': {
      const start = isObject(raw.start) ? raw.start : {};
      const end = isObject(raw.end) ? raw.end : {};
      return {
        ...base,
        kind: 'linear',
        start: { x: axis(start.x), y: axis(start.y) },
        end: { x: axis(end.x), y: axis(end.y) },
        feather: feather(raw.feather),
      };
    }
    case 'radial': {
      const center = isObject(raw.center) ? raw.center : {};
      return {
        ...base,
        kind: 'radial',
        center: { x: axis(center.x), y: axis(center.y) },
        radiusX: clamp(finite(raw.radiusX, 0.25), 0.001, 2),
        radiusY: clamp(finite(raw.radiusY, 0.25), 0.001, 2),
        rotation: clamp(finite(raw.rotation, 0), -180, 180),
        feather: feather(raw.feather),
      };
    }
    case 'luminance': {
      const a = clamp(finite(raw.lo, 0), 0, 1);
      const b = clamp(finite(raw.hi, 1), 0, 1);
      return { ...base, kind: 'luminance', lo: Math.min(a, b), hi: Math.max(a, b), feather: feather(raw.feather) };
    }
    case 'color': {
      const color = isObject(raw.color) ? raw.color : {};
      return {
        ...base,
        kind: 'color',
        color: { r: axis(color.r, 0.5), g: axis(color.g, 0.5), b: axis(color.b, 0.5) },
        hueRange: clamp(finite(raw.hueRange, 30), 0, 180),
        satRange: clamp(finite(raw.satRange, 0.35), 0, 1),
        lumRange: clamp(finite(raw.lumRange, 0.35), 0, 1),
        feather: feather(raw.feather),
      };
    }
    default:
      return null;
  }
}

export function normalizeMasks(value: unknown): MaskData[] {
  if (!Array.isArray(value)) return [];
  const out: MaskData[] = [];
  const ids = new Set<string>();
  for (const [index, raw] of value.slice(0, MAX_MASKS).entries()) {
    const mask = normalizeMask(raw, index);
    if (!mask || ids.has(mask.id)) continue;
    ids.add(mask.id);
    out.push(mask);
  }
  return out;
}

function validateStroke(value: unknown): void {
  if (!isObject(value)) throw new Error('Invalid mask stroke');
  if (!Array.isArray(value.points) || value.points.length === 0 || value.points.length > MAX_STROKE_POINTS) {
    throw new Error('Invalid mask stroke');
  }
  for (const point of value.points) {
    if (!isObject(point) || !inUnit(point.x) || !inUnit(point.y)) throw new Error('Invalid mask stroke');
  }
  if (
    typeof value.radius !== 'number' ||
    !Number.isFinite(value.radius) ||
    value.radius <= 0 ||
    value.radius > 2 ||
    !inUnit(value.hardness) ||
    !inUnit(value.flow)
  ) {
    throw new Error('Invalid mask stroke');
  }
}

function validateShape(mask: Record<string, unknown>): void {
  switch (mask.kind) {
    case 'brush': {
      if (!Array.isArray(mask.strokes) || mask.strokes.length === 0 || mask.strokes.length > MAX_STROKES) {
        throw new Error('Invalid mask shape');
      }
      for (const stroke of mask.strokes) validateStroke(stroke);
      return;
    }
    case 'linear': {
      const start = mask.start;
      const end = mask.end;
      if (!isObject(start) || !isObject(end) || !inUnit(start.x) || !inUnit(start.y) || !inUnit(end.x) || !inUnit(end.y)) {
        throw new Error('Invalid mask shape');
      }
      if (mask.feather !== undefined && !inUnit(mask.feather)) throw new Error('Invalid mask feather');
      return;
    }
    case 'radial': {
      const center = mask.center;
      if (
        !isObject(center) ||
        !inUnit(center.x) ||
        !inUnit(center.y) ||
        typeof mask.radiusX !== 'number' ||
        typeof mask.radiusY !== 'number' ||
        !Number.isFinite(mask.radiusX) ||
        !Number.isFinite(mask.radiusY) ||
        mask.radiusX <= 0 ||
        mask.radiusY <= 0 ||
        mask.radiusX > 2 ||
        mask.radiusY > 2 ||
        typeof mask.rotation !== 'number' ||
        !Number.isFinite(mask.rotation) ||
        Math.abs(mask.rotation) > 180
      ) {
        throw new Error('Invalid mask shape');
      }
      if (mask.feather !== undefined && !inUnit(mask.feather)) throw new Error('Invalid mask feather');
      return;
    }
    case 'luminance': {
      if (!inUnit(mask.lo) || !inUnit(mask.hi) || (mask.lo as number) >= (mask.hi as number)) {
        throw new Error('Invalid mask shape');
      }
      if (mask.feather !== undefined && !inUnit(mask.feather)) throw new Error('Invalid mask feather');
      return;
    }
    case 'color': {
      const color = mask.color;
      if (
        !isObject(color) ||
        !inUnit(color.r) ||
        !inUnit(color.g) ||
        !inUnit(color.b) ||
        typeof mask.hueRange !== 'number' ||
        !Number.isFinite(mask.hueRange) ||
        mask.hueRange < 0 ||
        mask.hueRange > 180 ||
        !inUnit(mask.satRange) ||
        !inUnit(mask.lumRange)
      ) {
        throw new Error('Invalid mask shape');
      }
      if (mask.feather !== undefined && !inUnit(mask.feather)) throw new Error('Invalid mask feather');
      return;
    }
    default:
      throw new Error('Invalid mask shape');
  }
}

export function validateMasks(value: unknown): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value) || value.length > MAX_MASKS) throw new Error('Invalid masks');
  const ids = new Set<string>();
  for (const mask of value) {
    if (!isObject(mask)) throw new Error('Invalid mask');
    if (typeof mask.id !== 'string' || mask.id.length === 0 || mask.id.length > 100 || ids.has(mask.id)) {
      throw new Error('Invalid mask identity');
    }
    ids.add(mask.id);
    if (typeof mask.name !== 'string' || mask.name.length > 40) throw new Error('Invalid mask name');
    if (mask.enabled !== undefined && typeof mask.enabled !== 'boolean') throw new Error('Invalid mask enabled value');
    if (mask.inverted !== undefined && typeof mask.inverted !== 'boolean') throw new Error('Invalid mask inverted value');
    if (mask.blend !== undefined && mask.blend !== 'add' && mask.blend !== 'subtract' && mask.blend !== 'intersect') {
      throw new Error('Invalid mask blend');
    }
    if (mask.opacity !== undefined && !inUnit(mask.opacity)) throw new Error('Invalid mask opacity');
    validateShape(mask);
  }
}
