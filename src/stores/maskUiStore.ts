import { create } from 'zustand';
import {
  MAX_LOCAL_GROUPS,
  normalizeLocalAdjustments,
  type LocalAdjustmentGroup,
  type LocalAdjustmentKey,
  type LocalAdjustmentState,
} from '../engine/contracts/localAdjustments';
import {
  MAX_MASKS,
  normalizeMasksDetailed,
  type MaskData,
} from '../engine/contracts/masks';

export type MaskKind = MaskData['kind'];

let idCounter = 0;
const nextId = (prefix: string): string => {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
};

const DEFAULT_COLOR_FIELDS = {
  color: { r: 0.9, g: 0.55, b: 0.35 },
  hueRange: 30,
  satRange: 0.35,
  lumRange: 0.35,
  feather: 0.5,
} as const;

/** Fresh mask with valid geometry so it survives contract normalization. */
export function createDefaultMask(kind: MaskKind, index: number): MaskData {
  const base = {
    id: nextId('mask'),
    name: `${kind[0].toUpperCase()}${kind.slice(1)} ${index + 1}`,
    enabled: true,
    blend: 'add' as const,
    opacity: 1,
    inverted: false,
  };
  switch (kind) {
    case 'brush':
      return {
        ...base,
        kind,
        strokes: [{ points: [{ x: 0.5, y: 0.5 }], radius: 0.15, hardness: 0.5, flow: 1 }],
      };
    case 'linear':
      return { ...base, kind, start: { x: 0.5, y: 0.1 }, end: { x: 0.5, y: 0.9 }, feather: 0.5 };
    case 'radial':
      return {
        ...base,
        kind,
        center: { x: 0.5, y: 0.5 },
        radiusX: 0.25,
        radiusY: 0.25,
        rotation: 0,
        feather: 0.5,
      };
    case 'luminance':
      return { ...base, kind, lo: 0.5, hi: 1, feather: 0.3 };
    case 'color':
      return { ...base, kind, ...DEFAULT_COLOR_FIELDS };
    default:
      return { ...base, kind: 'color', ...DEFAULT_COLOR_FIELDS };
  }
}

export function createDefaultGroup(index: number): LocalAdjustmentGroup {
  return {
    id: nextId('group'),
    name: `Adjustment ${index + 1}`,
    enabled: true,
    masks: [],
    adjustment: {},
    opacity: 1,
    blend: 'add',
  };
}

function countDroppedOnImport(value: unknown): { masks: number; strokes: number; points: number } {
  const totals = { masks: 0, strokes: 0, points: 0 };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return totals;
  const groups = (value as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return totals;
  const keptGroupIds = new Set<string>();
  const keptMaskIds = new Set<string>();
  for (const group of groups.slice(0, MAX_LOCAL_GROUPS)) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    const id = (group as { id?: unknown }).id;
    if (typeof id === 'string' && keptGroupIds.has(id)) continue;
    if (typeof id === 'string') keptGroupIds.add(id);
    const { masks, dropped } = normalizeMasksDetailed((group as { masks?: unknown }).masks);
    totals.masks += dropped.masks;
    totals.strokes += dropped.strokes;
    totals.points += dropped.points;
    for (const mask of masks) {
      if (keptMaskIds.has(mask.id)) continue;
      keptMaskIds.add(mask.id);
    }
  }
  return totals;
}

export interface MaskUiStore {
  local: LocalAdjustmentState;
  selectedGroupId: string | null;
  selectedMaskId: string | null;
  notice: string | null;
  setLocal: (local: LocalAdjustmentState) => void;
  setEnabled: (enabled: boolean) => void;
  importLocal: (value: unknown) => void;
  addGroup: () => void;
  removeGroup: (groupId: string) => void;
  selectGroup: (groupId: string) => void;
  updateGroup: (groupId: string, patch: Partial<Omit<LocalAdjustmentGroup, 'id'>>) => void;
  setGroupAdjustment: (groupId: string, key: LocalAdjustmentKey, value: number | null) => void;
  addMask: (groupId: string, kind: MaskKind) => void;
  removeMask: (groupId: string, maskId: string) => void;
  selectMask: (maskId: string | null) => void;
  updateMask: (groupId: string, maskId: string, patch: Partial<MaskData>) => void;
  setMaskEnabled: (groupId: string, maskId: string, enabled: boolean) => void;
  setMaskInverted: (groupId: string, maskId: string, inverted: boolean) => void;
  setMaskBlend: (groupId: string, maskId: string, blend: MaskData['blend']) => void;
  setMaskOpacity: (groupId: string, maskId: string, opacity: number) => void;
  clearNotice: () => void;
}

const emptyLocal: LocalAdjustmentState = { enabled: false, groups: [] };

export const useMaskUiStore = create<MaskUiStore>((set, get) => {
  const patchGroup = (
    groupId: string,
    patch: (group: LocalAdjustmentGroup) => LocalAdjustmentGroup,
  ) =>
    set((store) => ({
      local: {
        ...store.local,
        groups: store.local.groups.map((group) => (group.id === groupId ? patch(group) : group)),
      },
    }));

  return {
    local: emptyLocal,
    selectedGroupId: null,
    selectedMaskId: null,
    notice: null,

    setLocal: (local) =>
      set((store) => {
        const groups = local.groups;
        const selectedGroupId = groups.some((group) => group.id === store.selectedGroupId)
          ? store.selectedGroupId
          : (groups[0]?.id ?? null);
        const selected = groups.find((group) => group.id === selectedGroupId);
        const selectedMaskId = selected?.masks.some((mask) => mask.id === store.selectedMaskId)
          ? store.selectedMaskId
          : (selected?.masks[0]?.id ?? null);
        return { local, selectedGroupId, selectedMaskId };
      }),

    setEnabled: (enabled) => set((store) => ({ local: { ...store.local, enabled } })),

    importLocal: (value) => {
      const local = normalizeLocalAdjustments(value);
      const dropped = countDroppedOnImport(value);
      const parts = [
        dropped.masks > 0 ? `${dropped.masks} masks` : '',
        dropped.strokes > 0 ? `${dropped.strokes} brush strokes` : '',
        dropped.points ? `${dropped.points} stroke points` : '',
      ].filter(Boolean);
      get().setLocal(local);
      set({
        notice:
          parts.length > 0
            ? `Imported with capacity limits — dropped ${parts.join(', ')}.`
            : null,
      });
    },

    addGroup: () => {
      const store = get();
      if (store.local.groups.length >= MAX_LOCAL_GROUPS) {
        set({ notice: `Local adjustments are limited to ${MAX_LOCAL_GROUPS} groups.` });
        return;
      }
      const group = createDefaultGroup(store.local.groups.length);
      set({
        local: { enabled: true, groups: [...store.local.groups, group] },
        selectedGroupId: group.id,
        selectedMaskId: null,
        notice: null,
      });
    },

    removeGroup: (groupId) =>
      set((store) => {
        const groups = store.local.groups.filter((group) => group.id !== groupId);
        const selectedGroupId =
          store.selectedGroupId === groupId ? (groups[0]?.id ?? null) : store.selectedGroupId;
        const selected = groups.find((group) => group.id === selectedGroupId);
        return {
          local: { enabled: groups.length > 0 && store.local.enabled, groups },
          selectedGroupId,
          selectedMaskId:
            selected?.masks.some((mask) => mask.id === store.selectedMaskId)
              ? store.selectedMaskId
              : (selected?.masks[0]?.id ?? null),
        };
      }),

    selectGroup: (groupId) =>
      set((store) => {
        const group = store.local.groups.find((candidate) => candidate.id === groupId);
        return {
          selectedGroupId: groupId,
          selectedMaskId: group?.masks[0]?.id ?? null,
        };
      }),

    updateGroup: (groupId, patch) => patchGroup(groupId, (group) => ({ ...group, ...patch })),

    setGroupAdjustment: (groupId, key, value) =>
      patchGroup(groupId, (group) => {
        const adjustment = { ...group.adjustment };
        if (value === null || !Number.isFinite(value)) delete adjustment[key];
        else adjustment[key] = value;
        return { ...group, adjustment };
      }),

    addMask: (groupId, kind) => {
      const store = get();
      const group = store.local.groups.find((candidate) => candidate.id === groupId);
      if (!group) return;
      if (group.masks.length >= MAX_MASKS) {
        set({ notice: `Each group is limited to ${MAX_MASKS} masks. Delete one first.` });
        return;
      }
      const mask = createDefaultMask(kind, group.masks.length);
      patchGroup(groupId, (current) => ({ ...current, masks: [...current.masks, mask] }));
      set({ selectedMaskId: mask.id, notice: null });
    },

    removeMask: (groupId, maskId) =>
      set((store) => {
        const groups = store.local.groups.map((group) =>
          group.id === groupId
            ? { ...group, masks: group.masks.filter((mask) => mask.id !== maskId) }
            : group,
        );
        const group = groups.find((candidate) => candidate.id === groupId);
        return {
          local: { ...store.local, groups },
          selectedMaskId:
            store.selectedMaskId === maskId
              ? (group?.masks[0]?.id ?? null)
              : store.selectedMaskId,
        };
      }),

    selectMask: (maskId) => set({ selectedMaskId: maskId }),

    updateMask: (groupId, maskId, patch) =>
      patchGroup(groupId, (group) => ({
        ...group,
        masks: group.masks.map((mask) =>
          mask.id === maskId ? ({ ...mask, ...patch } as MaskData) : mask,
        ),
      })),

    setMaskEnabled: (groupId, maskId, enabled) =>
      get().updateMask(groupId, maskId, { enabled }),

    setMaskInverted: (groupId, maskId, inverted) =>
      get().updateMask(groupId, maskId, { inverted }),

    setMaskBlend: (groupId, maskId, blend) => get().updateMask(groupId, maskId, { blend }),

    setMaskOpacity: (groupId, maskId, opacity) =>
      get().updateMask(groupId, maskId, {
        opacity: Math.min(1, Math.max(0, opacity)),
      }),

    clearNotice: () => set({ notice: null }),
  };
});
