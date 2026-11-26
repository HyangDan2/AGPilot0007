import { ADJUSTMENT_DEFINITIONS } from '../../types/adjustments';
import { DEFAULT_ADJUSTMENTS, type AdjustmentSettings, type CustomRecipe } from '../../types/film';
import { defaultCurves, normalizeCurves } from '../../types/curves';
import { normalizeCamera } from '../../types/camera';
import { defaultColorMixer, normalizeColorMixer } from '../../types/colorMixer';
import { DEFAULT_SHARPENING, normalizeSharpening } from '../../types/sharpening';
import { FILM_PROFILES } from '../../films/registry';
import { CURRENT_SCHEMA_VERSION } from '../../stores/recipeStore';
import type { EditState, ParameterClip, ParameterGroup } from './types';

const TONE_KEYS = [
  'exposure',
  'contrast',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'temperature',
  'tint',
  'saturation',
] as const;

const GRAIN_KEYS = ['grain', 'vignette', 'filmStrength'] as const;

export function cloneEditState(state: EditState): EditState {
  return JSON.parse(JSON.stringify(state)) as EditState;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function sanitizeAdjustments(value?: Partial<AdjustmentSettings> | null): AdjustmentSettings {
  const result: AdjustmentSettings = { ...DEFAULT_ADJUSTMENTS };
  for (const def of ADJUSTMENT_DEFINITIONS) {
    const raw = value?.[def.key];
    if (typeof raw === 'number' && Number.isFinite(raw)) result[def.key] = Math.min(def.max, Math.max(def.min, raw));
  }
  return result;
}

export function createEditState(init: Partial<EditState> = {}, legacySharpness = 0): EditState {
  return {
    activeFilmId: init.activeFilmId && init.activeFilmId in FILM_PROFILES ? init.activeFilmId : 'FS-001',
    activePresetId: init.activePresetId ?? null,
    adjustments: sanitizeAdjustments(init.adjustments),
    curves: init.curves ? normalizeCurves(init.curves) : defaultCurves(),
    camera: normalizeCamera(init.camera),
    colorMixer: init.colorMixer ? normalizeColorMixer(init.colorMixer) : defaultColorMixer(),
    sharpening: init.sharpening || legacySharpness > 0 ? normalizeSharpening(init.sharpening, legacySharpness) : { ...DEFAULT_SHARPENING },
  };
}

/** Builds the same snapshot editorStore.applyRecipe produces, without touching the store. */
export function editStateFromRecipe(recipe: CustomRecipe): EditState {
  return createEditState(
    {
      activeFilmId: recipe.baseFilmId,
      activePresetId: recipe.presetId ?? null,
      adjustments: recipe.adjustments,
      curves: recipe.curves,
      camera: recipe.camera,
      colorMixer: recipe.colorMixer,
      sharpening: recipe.sharpening,
    },
    recipe.adjustments.sharpness,
  );
}

/** Inverse of editStateFromRecipe for saving one image's edit as a Recipe v7. */
export function recipeFromEditState(
  state: EditState,
  meta: { id: string; name: string; profileVersion?: string; createdAt?: number; updatedAt?: number },
): CustomRecipe {
  const now = Date.now();
  return {
    id: meta.id,
    name: meta.name,
    baseFilmId: state.activeFilmId,
    ...(state.activePresetId ? { presetId: state.activePresetId } : {}),
    profileVersion: meta.profileVersion ?? FILM_PROFILES[state.activeFilmId]?.version ?? '1.0.0',
    adjustments: { ...state.adjustments },
    createdAt: meta.createdAt ?? now,
    updatedAt: meta.updatedAt ?? now,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    sharpening: { ...state.sharpening },
    colorMixer: JSON.parse(JSON.stringify(state.colorMixer)),
    curves: JSON.parse(JSON.stringify(state.curves)),
    camera: JSON.parse(JSON.stringify(state.camera)),
  };
}

export function copyParameters(sourceId: string, state: EditState, groups: readonly ParameterGroup[]): ParameterClip {
  const wanted = new Set(groups);
  const clip: ParameterClip = { sourceId, groups: [...wanted] };
  if (wanted.has('film')) clip.film = { activeFilmId: state.activeFilmId, activePresetId: state.activePresetId };
  if (wanted.has('tone')) {
    const tone: Partial<AdjustmentSettings> = {};
    for (const key of TONE_KEYS) tone[key] = state.adjustments[key];
    clip.tone = tone;
  }
  if (wanted.has('grain')) {
    const grain = {} as NonNullable<ParameterClip['grain']>;
    for (const key of GRAIN_KEYS) grain[key] = state.adjustments[key];
    clip.grain = grain;
  }
  if (wanted.has('curves')) clip.curves = JSON.parse(JSON.stringify(state.curves));
  if (wanted.has('camera')) clip.camera = JSON.parse(JSON.stringify(state.camera));
  if (wanted.has('colorMixer')) clip.colorMixer = JSON.parse(JSON.stringify(state.colorMixer));
  if (wanted.has('sharpening')) clip.sharpening = { ...state.sharpening };
  return clip;
}

/**
 * Applies only the groups recorded in the clip. Untouched groups keep the
 * target image's own values, which is the core requirement for selective paste.
 */
export function pasteParameters(target: EditState, clip: ParameterClip): EditState {
  const groups = new Set(clip.groups);
  const next: EditState = cloneEditState(target);
  let adjustments = { ...next.adjustments };

  if (groups.has('film') && clip.film) {
    next.activeFilmId = clip.film.activeFilmId;
    next.activePresetId = clip.film.activePresetId;
  }
  if (groups.has('tone') && clip.tone) adjustments = { ...adjustments, ...clip.tone };
  if (groups.has('grain') && clip.grain) adjustments = { ...adjustments, ...clip.grain };
  if (groups.has('curves') && clip.curves) next.curves = normalizeCurves(JSON.parse(JSON.stringify(clip.curves)));
  if (groups.has('camera') && clip.camera) next.camera = normalizeCamera(JSON.parse(JSON.stringify(clip.camera)));
  if (groups.has('colorMixer') && clip.colorMixer) next.colorMixer = normalizeColorMixer(JSON.parse(JSON.stringify(clip.colorMixer)));
  if (groups.has('sharpening') && clip.sharpening) next.sharpening = normalizeSharpening({ ...clip.sharpening });

  next.adjustments = sanitizeAdjustments(adjustments);
  return next;
}

export interface EditStateChange {
  id: string;
  /** Frozen snapshot after the change; null for delete/clear. */
  state: EditState | null;
  kind: 'create' | 'set' | 'delete' | 'clear';
}

type EditStateListener = (change: EditStateChange) => void;

/**
 * In-memory per-image edit registry used by the CP1 PoC. Deliberately separate
 * from editorStore/workspaceStore; Q01 owns the eventual shared interface.
 *
 * Snapshots are deep-frozen and shared per image id. Every mutation builds a
 * new normalized state, notifies subscribers and replaces the stored snapshot,
 * so consumer code cannot mutate another image's edit state by accident.
 */
export class EditStateRegistry {
  private states = new Map<string, EditState>();
  private listeners = new Set<EditStateListener>();

  constructor(private readonly seed: () => EditState = () => createEditState()) {}

  has(id: string): boolean {
    return this.states.has(id);
  }

  get size(): number {
    return this.states.size;
  }

  ids(): string[] {
    return [...this.states.keys()];
  }

  /** Immutable snapshot; mutate through update()/set()/pasteTo() instead. */
  get(id: string): EditState | undefined {
    return this.states.get(id);
  }

  subscribe(listener: EditStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ensure(id: string): EditState {
    let state = this.states.get(id);
    if (!state) {
      state = deepFreeze(createEditState(this.seed()));
      this.states.set(id, state);
      this.emit({ id, state, kind: 'create' });
    }
    return state;
  }

  set(id: string, state: EditState): EditState {
    const normalized = deepFreeze(createEditState(state));
    this.states.set(id, normalized);
    this.emit({ id, state: normalized, kind: 'set' });
    return normalized;
  }

  update(id: string, patch: Partial<EditState>): EditState {
    return this.set(id, { ...this.ensure(id), ...patch });
  }

  updateAdjustment<K extends keyof AdjustmentSettings>(id: string, key: K, value: AdjustmentSettings[K]): EditState {
    const state = this.ensure(id);
    return this.update(id, { adjustments: { ...state.adjustments, [key]: value } });
  }

  delete(id: string): boolean {
    const removed = this.states.delete(id);
    if (removed) this.emit({ id, state: null, kind: 'delete' });
    return removed;
  }

  clear(): void {
    this.states.clear();
    this.emit({ id: '', state: null, kind: 'clear' });
  }

  /** Deep-copies the snapshot per image so edits on one image never leak into another. */
  applyToMany(ids: readonly string[], state: EditState): number {
    let applied = 0;
    for (const id of ids) {
      const snapshot = deepFreeze(createEditState(state));
      this.states.set(id, snapshot);
      this.emit({ id, state: snapshot, kind: 'set' });
      applied++;
    }
    return applied;
  }

  copyFrom(id: string, groups: readonly ParameterGroup[]): ParameterClip | null {
    const state = this.states.get(id);
    return state ? copyParameters(id, state, groups) : null;
  }

  pasteTo(id: string, clip: ParameterClip): EditState {
    const next = pasteParameters(this.ensure(id), clip);
    return this.set(id, next);
  }

  pasteToMany(ids: readonly string[], clip: ParameterClip): number {
    for (const id of ids) this.pasteTo(id, clip);
    return ids.length;
  }

  private emit(change: EditStateChange): void {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch {
        // A consumer listener must not break registry consistency.
      }
    }
  }
}
