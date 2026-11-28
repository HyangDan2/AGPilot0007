import { Plus, Trash2 } from 'lucide-react';
import {
  LOCAL_ADJUSTMENT_KEYS,
  MAX_LOCAL_GROUPS,
  type LocalAdjustmentGroup,
  type LocalAdjustmentKey,
  type LocalAdjustmentState,
} from '../../engine/contracts/localAdjustments';
import { MAX_MASKS, type MaskData } from '../../engine/contracts/masks';
import { ADJUSTMENT_DEFINITIONS } from '../../types/adjustments';
import type { MaskKind } from '../../stores/maskUiStore';

export interface MaskListPanelProps {
  local: LocalAdjustmentState;
  selectedGroupId: string | null;
  selectedMaskId: string | null;
  notice?: string | null;
  disabled?: boolean;
  className?: string;
  onToggleLocal: (enabled: boolean) => void;
  onSelectGroup: (groupId: string) => void;
  onAddGroup: () => void;
  onRemoveGroup: (groupId: string) => void;
  onUpdateGroup: (groupId: string, patch: Partial<Omit<LocalAdjustmentGroup, 'id'>>) => void;
  onGroupAdjustment: (groupId: string, key: LocalAdjustmentKey, value: number | null) => void;
  onAddMask: (groupId: string, kind: MaskKind) => void;
  onRemoveMask: (groupId: string, maskId: string) => void;
  onSelectMask: (maskId: string) => void;
  onUpdateMask: (groupId: string, maskId: string, patch: Partial<MaskData>) => void;
  onDismissNotice?: () => void;
}

const MASK_KINDS: MaskKind[] = ['brush', 'linear', 'radial', 'luminance', 'color'];
const BLENDS: MaskData['blend'][] = ['add', 'subtract', 'intersect'];

const labelClass = 'w-24 shrink-0 text-[11px] text-[color:var(--ui-text-8a94a6)]';
const rowClass = 'flex items-center gap-2';
const buttonClass =
  'rounded border border-[color:var(--ui-border-1e2430)] px-2 py-1 text-[11px] text-[color:var(--ui-text-c8cfda)] hover:border-[color:var(--ui-accent)] disabled:opacity-40';

export function MaskListPanel({
  local,
  selectedGroupId,
  selectedMaskId,
  notice,
  disabled,
  className = '',
  onToggleLocal,
  onSelectGroup,
  onAddGroup,
  onRemoveGroup,
  onUpdateGroup,
  onGroupAdjustment,
  onAddMask,
  onRemoveMask,
  onSelectMask,
  onUpdateMask,
  onDismissNotice,
}: MaskListPanelProps) {
  const group = local.groups.find((candidate) => candidate.id === selectedGroupId) ?? null;
  const selectedMask = group?.masks.find((mask) => mask.id === selectedMaskId) ?? null;

  return (
    <div
      data-testid="mask-panel"
      className={`flex w-[320px] flex-col gap-3 rounded-lg border border-[color:var(--ui-border-1e2430)] bg-[color:var(--ui-surface-121722)] p-3 text-[color:var(--ui-text-c8cfda)] ${className}`}
    >
      <div className={rowClass}>
        <span className="flex-1 text-xs font-semibold tracking-wide">Local Adjustments</span>
        <label className="flex items-center gap-1 text-[11px]">
          <input
            type="checkbox"
            data-testid="mask-stage-enabled"
            aria-label="Enable local adjustments"
            checked={local.enabled}
            disabled={disabled || local.groups.length === 0}
            onChange={(event) => onToggleLocal(event.target.checked)}
          />
          On
        </label>
      </div>

      <div className={rowClass}>
        <span className="flex-1 text-[11px] text-[color:var(--ui-text-8a94a6)]">
          {local.groups.length}/{MAX_LOCAL_GROUPS} groups
        </span>
        <button
          type="button"
          data-testid="mask-add-group"
          className={`${buttonClass} inline-flex items-center gap-1`}
          disabled={disabled}
          onClick={onAddGroup}
        >
          <Plus size={12} /> Group
        </button>
      </div>

      {local.groups.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {local.groups.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              data-testid={`mask-group-${index}`}
              className={`rounded px-2 py-1 text-[11px] ${
                candidate.id === group?.id
                  ? 'bg-[color:var(--ui-accent)] text-[color:var(--ui-bg)]'
                  : 'bg-[color:var(--ui-surface-1b2130)]'
              }`}
              disabled={disabled}
              onClick={() => onSelectGroup(candidate.id)}
            >
              {candidate.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-[color:var(--ui-text-8a94a6)]">
          Add a group, then paint or place a mask on the image.
        </p>
      )}

      {notice ? (
        <p
          role="status"
          data-testid="mask-notice"
          className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200"
          onClick={onDismissNotice}
        >
          {notice}
        </p>
      ) : null}

      {group ? (
        <div className="flex flex-col gap-2 border-t border-[color:var(--ui-border-1e2430)] pt-2">
          <div className={rowClass}>
            <span className={labelClass}>Group</span>
            <input
              className="min-w-0 flex-1 rounded border border-[color:var(--ui-border-1e2430)] bg-transparent px-2 py-1 text-[11px]"
              aria-label="Group name"
              value={group.name}
              disabled={disabled}
              onChange={(event) => onUpdateGroup(group.id, { name: event.target.value.slice(0, 40) })}
            />
            <label className="flex items-center gap-1 text-[11px]">
              <input
                type="checkbox"
                aria-label="Enable group"
                checked={group.enabled}
                disabled={disabled}
                onChange={(event) => onUpdateGroup(group.id, { enabled: event.target.checked })}
              />
              On
            </label>
            <button
              type="button"
              aria-label="Delete group"
              data-testid="mask-delete-group"
              className={buttonClass}
              disabled={disabled}
              onClick={() => onRemoveGroup(group.id)}
            >
              <Trash2 size={12} />
            </button>
          </div>

          <div className={rowClass}>
            <span className={labelClass}>Masks</span>
            <span className="flex-1 text-[11px] text-[color:var(--ui-text-8a94a6)]">
              {group.masks.length}/{MAX_MASKS}
            </span>
            {MASK_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                data-testid={`mask-add-${kind}`}
                className={buttonClass}
                disabled={disabled}
                onClick={() => onAddMask(group.id, kind)}
              >
                {kind[0].toUpperCase()}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            {group.masks.map((mask) => (
              <button
                key={mask.id}
                type="button"
                data-testid={`mask-row-${mask.kind}`}
                className={`flex items-center gap-2 rounded px-2 py-1 text-left text-[11px] ${
                  mask.id === selectedMaskId
                    ? 'bg-[color:var(--ui-accent)]/20 ring-1 ring-[color:var(--ui-accent)]'
                    : 'bg-[color:var(--ui-surface-1b2130)]/60'
                }`}
                disabled={disabled}
                onClick={() => onSelectMask(mask.id)}
              >
                <span className="flex-1 truncate">{mask.name}</span>
                <span className="text-[color:var(--ui-text-8a94a6)]">{mask.kind}</span>
                {mask.inverted ? <span className="text-[10px]">inv</span> : null}
                {!mask.enabled ? <span className="text-[10px]">off</span> : null}
              </button>
            ))}
          </div>

          {selectedMask ? (
            <div className="flex flex-col gap-2 rounded bg-[color:var(--ui-surface-1b2130)]/50 p-2">
              <div className={rowClass}>
                <span className={labelClass}>Name</span>
                <input
                  className="min-w-0 flex-1 rounded border border-[color:var(--ui-border-1e2430)] bg-transparent px-2 py-1 text-[11px]"
                  aria-label="Mask name"
                  value={selectedMask.name}
                  disabled={disabled}
                  onChange={(event) =>
                    onUpdateMask(group.id, selectedMask.id, { name: event.target.value.slice(0, 40) })
                  }
                />
                <button
                  type="button"
                  aria-label="Delete mask"
                  data-testid="mask-delete"
                  className={buttonClass}
                  disabled={disabled}
                  onClick={() => onRemoveMask(group.id, selectedMask.id)}
                >
                  <Trash2 size={12} />
                </button>
              </div>

              <div className={rowClass}>
                <label className="flex items-center gap-1 text-[11px]">
                  <input
                    type="checkbox"
                    aria-label="Enable mask"
                    data-testid="mask-enabled"
                    checked={selectedMask.enabled}
                    disabled={disabled}
                    onChange={(event) =>
                      onUpdateMask(group.id, selectedMask.id, { enabled: event.target.checked })
                    }
                  />
                  Enabled
                </label>
                <label className="flex items-center gap-1 text-[11px]">
                  <input
                    type="checkbox"
                    aria-label="Invert mask"
                    data-testid="mask-inverted"
                    checked={selectedMask.inverted}
                    disabled={disabled}
                    onChange={(event) =>
                      onUpdateMask(group.id, selectedMask.id, { inverted: event.target.checked })
                    }
                  />
                  Invert
                </label>
                <select
                  aria-label="Mask blend"
                  data-testid="mask-blend"
                  className="rounded border border-[color:var(--ui-border-1e2430)] bg-transparent px-1 py-1 text-[11px]"
                  value={selectedMask.blend}
                  disabled={disabled}
                  onChange={(event) =>
                    onUpdateMask(group.id, selectedMask.id, {
                      blend: event.target.value as MaskData['blend'],
                    })
                  }
                >
                  {BLENDS.map((blend) => (
                    <option key={blend} value={blend}>
                      {blend}
                    </option>
                  ))}
                </select>
              </div>

              <label className={rowClass}>
                <span className={labelClass}>Opacity</span>
                <input
                  type="range"
                  className="h-1 min-w-0 flex-1 accent-[var(--ui-accent)]"
                  aria-label="Mask opacity"
                  data-testid="mask-opacity"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedMask.opacity}
                  disabled={disabled}
                  onChange={(event) =>
                    onUpdateMask(group.id, selectedMask.id, { opacity: Number(event.target.value) })
                  }
                />
                <span className="w-10 text-right text-[11px] tabular-nums">
                  {Math.round(selectedMask.opacity * 100)}%
                </span>
              </label>
            </div>
          ) : null}

          <div className="flex flex-col gap-1 border-t border-[color:var(--ui-border-1e2430)] pt-2">
            <div className={rowClass}>
              <span className={labelClass}>Group adj.</span>
              <span className="flex-1 text-[11px] text-[color:var(--ui-text-8a94a6)]">
                Applied inside the group mask
              </span>
              <label className="flex items-center gap-1 text-[11px]">
                <input
                  type="checkbox"
                  aria-label="Enable group adjustments"
                  data-testid="mask-group-enabled"
                  checked={group.enabled}
                  disabled={disabled}
                  onChange={(event) => onUpdateGroup(group.id, { enabled: event.target.checked })}
                />
                On
              </label>
            </div>
            {LOCAL_ADJUSTMENT_KEYS.map((key) => {
              const definition = ADJUSTMENT_DEFINITIONS.find((candidate) => candidate.key === key);
              if (!definition) return null;
              const value = group.adjustment[key] ?? 0;
              return (
                <label key={key} className={rowClass}>
                  <span className={labelClass}>{definition.label}</span>
                  <input
                    type="range"
                    className="h-1 min-w-0 flex-1 accent-[var(--ui-accent)]"
                    aria-label={`Group ${definition.label}`}
                    data-testid={`mask-adjust-${key}`}
                    min={definition.min}
                    max={definition.max}
                    step={definition.step}
                    value={value}
                    disabled={disabled}
                    onChange={(event) =>
                      onGroupAdjustment(group.id, key, Number(event.target.value))
                    }
                    onDoubleClick={() => onGroupAdjustment(group.id, key, null)}
                  />
                  <span className="w-12 text-right text-[11px] tabular-nums">
                    {value.toFixed(2)}
                  </span>
                </label>
              );
            })}
            <span className="text-[10px] text-[color:var(--ui-text-8a94a6)]">
              Double-click a slider to reset it. Masks and adjustments stay in corrected NIS.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
