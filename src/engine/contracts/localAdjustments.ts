import { ADJUSTMENT_DEFINITIONS } from '../../types/adjustments';
import type { AdjustmentSettings } from '../../types/film';
import {
  MAX_MASKS,
  normalizeMasks,
  validateMasks,
  type MaskBlend,
  type MaskData,
} from './masks';
import type { PipelineStage } from './stages';

export const MAX_LOCAL_GROUPS = 8;
export const LOCAL_ADJUSTMENT_STAGE: PipelineStage = 'local';

/** Adjustments allowed per mask group. Film simulation strength stays global. */
export const LOCAL_ADJUSTMENT_KEYS = [
  'exposure',
  'contrast',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'temperature',
  'tint',
  'saturation',
  'grain',
  'sharpness',
  'vignette',
] as const satisfies readonly (keyof AdjustmentSettings)[];

export type LocalAdjustmentKey = (typeof LOCAL_ADJUSTMENT_KEYS)[number];
export type LocalAdjustmentValues = Partial<Pick<AdjustmentSettings, LocalAdjustmentKey>>;

export interface LocalAdjustmentGroup {
  id: string;
  name: string;
  enabled: boolean;
  masks: MaskData[];
  adjustment: LocalAdjustmentValues;
  opacity: number;
  blend: MaskBlend;
}

/**
 * Local adjustments run after Color Lab and before detail, in corrected image
 * coordinates (post optical + geometry). Mask groups apply in array order;
 * masks inside a group compose in array order. Nothing here is persisted or
 * exposed in the UI until an approved work order activates the local stage.
 */
export interface LocalAdjustmentState {
  enabled: boolean;
  groups: LocalAdjustmentGroup[];
}

export const LOCAL_ADJUSTMENT_COORDINATE_BASIS = 'corrected-nis' as const;
export const LOCAL_ADJUSTMENT_RECIPE_POLICY = 'not-persisted' as const;
export const LOCAL_ADJUSTMENT_EXECUTION_ORDER = [
  'colorLab',
  'local',
  'detail',
] as const;

const DEFINITIONS = new Map(ADJUSTMENT_DEFINITIONS.map((definition) => [definition.key, definition]));
const ALLOWED_KEYS = new Set<string>(LOCAL_ADJUSTMENT_KEYS);

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function normalizeLocalAdjustmentValues(value: unknown): LocalAdjustmentValues {
  if (!isObject(value)) return {};
  const out: LocalAdjustmentValues = {};
  for (const key of LOCAL_ADJUSTMENT_KEYS) {
    if (!ALLOWED_KEYS.has(key)) continue;
    const raw = value[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const definition = DEFINITIONS.get(key)!;
    out[key] = clamp(raw, definition.min, definition.max);
  }
  return out;
}

export function normalizeLocalAdjustments(value: unknown): LocalAdjustmentState {
  if (!isObject(value)) return { enabled: false, groups: [] };
  const rawGroups = Array.isArray(value.groups) ? value.groups.slice(0, MAX_LOCAL_GROUPS) : [];
  const groups: LocalAdjustmentGroup[] = [];
  const groupIds = new Set<string>();
  const maskIds = new Set<string>();
  rawGroups.forEach((raw, index) => {
    if (!isObject(raw)) return;
    const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id.slice(0, 100) : `group-${index}`;
    if (groupIds.has(id)) return;
    groupIds.add(id);
    const masks = normalizeMasks(raw.masks).filter((mask) => {
      if (maskIds.has(mask.id)) return false;
      maskIds.add(mask.id);
      return true;
    });
    groups.push({
      id,
      name: typeof raw.name === 'string' ? raw.name.slice(0, 40) : `Adjustment ${index + 1}`,
      enabled: raw.enabled !== false,
      masks,
      adjustment: normalizeLocalAdjustmentValues(raw.adjustment),
      opacity: clamp(typeof raw.opacity === 'number' && Number.isFinite(raw.opacity) ? raw.opacity : 1, 0, 1),
      blend: raw.blend === 'subtract' || raw.blend === 'intersect' ? raw.blend : 'add',
    });
  });
  return { enabled: value.enabled !== false && groups.length > 0, groups };
}

export function validateLocalAdjustments(value: unknown): asserts value is LocalAdjustmentState {
  if (value === undefined || value === null) return;
  if (!isObject(value)) throw new Error('Invalid local adjustments');
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new Error('Invalid local adjustment enabled value');
  }
  const groups = value.groups;
  if (!Array.isArray(groups)) throw new Error('Invalid local adjustment groups');
  if (groups.length > MAX_LOCAL_GROUPS) throw new Error('Invalid local adjustment group count');
  const groupIds = new Set<string>();
  const maskIds = new Set<string>();
  for (const group of groups) {
    if (!isObject(group)) throw new Error('Invalid local adjustment group');
    if (
      typeof group.id !== 'string' ||
      group.id.length === 0 ||
      group.id.length > 100 ||
      groupIds.has(group.id)
    ) {
      throw new Error('Invalid local adjustment group identity');
    }
    groupIds.add(group.id);
    if (typeof group.name !== 'string' || group.name.length > 40) {
      throw new Error('Invalid local adjustment group name');
    }
    if (group.enabled !== undefined && typeof group.enabled !== 'boolean') {
      throw new Error('Invalid local adjustment enabled value');
    }
    if (group.blend !== undefined && group.blend !== 'add' && group.blend !== 'subtract' && group.blend !== 'intersect') {
      throw new Error('Invalid local adjustment blend');
    }
    if (group.opacity !== undefined) {
      const opacity = group.opacity;
      if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
        throw new Error('Invalid local adjustment opacity');
      }
    }
    if (!Array.isArray(group.masks) || group.masks.length > MAX_MASKS) {
      throw new Error('Invalid local mask stack');
    }
    validateMasks(group.masks);
    for (const mask of group.masks as MaskData[]) {
      if (maskIds.has(mask.id)) throw new Error('Invalid local mask identity across groups');
      maskIds.add(mask.id);
    }
    if (!isObject(group.adjustment)) throw new Error('Invalid local adjustment parameters');
    for (const [key, raw] of Object.entries(group.adjustment)) {
      if (!ALLOWED_KEYS.has(key)) throw new Error(`Invalid local adjustment parameter: ${key}`);
      const definition = DEFINITIONS.get(key as keyof AdjustmentSettings);
      if (
        !definition ||
        typeof raw !== 'number' ||
        !Number.isFinite(raw) ||
        raw < definition.min ||
        raw > definition.max
      ) {
        throw new Error(`Invalid local adjustment value: ${key}`);
      }
    }
  }
}

export function localAdjustmentsActive(value: unknown): boolean {
  if (!isObject(value) || value.enabled === false) return false;
  const groups = value.groups;
  if (!Array.isArray(groups)) return false;
  return groups.some(
    (group) =>
      isObject(group) &&
      group.enabled !== false &&
      Array.isArray(group.masks) &&
      group.masks.some((mask) => isObject(mask) && mask.enabled !== false),
  );
}
