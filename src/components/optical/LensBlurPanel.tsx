import React from 'react';
import type { LensBlurQuality, LensBlurState } from '../../engine/optical/lensBlur';

export interface LensBlurPanelProps {
  state: LensBlurState;
  onChange: (patch: Partial<LensBlurState>) => void;
  /** History grouping hooks; the host owns commit semantics. */
  onCommitStart?: () => void;
  onCommitEnd?: () => void;
  disabled?: boolean;
  className?: string;
}

const rowClass = 'flex items-center gap-2';
const labelClass = 'w-24 shrink-0 text-[11px] text-[color:var(--ui-text-8a94a6)]';
const valueClass = 'w-12 shrink-0 text-right text-[11px] tabular-nums text-[color:var(--ui-text-c8cfda)]';
const rangeClass = 'h-1 flex-1 accent-[var(--ui-accent)]';

const percent = (value: number): string => `${Math.round(value * 100)}%`;

export const LensBlurPanel: React.FC<LensBlurPanelProps> = ({
  state,
  onChange,
  onCommitStart,
  onCommitEnd,
  disabled = false,
  className = '',
}) => {
  const patch = (extra: Partial<LensBlurState>) => {
    if (disabled) return;
    onChange(extra);
  };

  const commit = {
    onPointerDown: onCommitStart,
    onPointerUp: onCommitEnd,
    onPointerCancel: onCommitEnd,
    onKeyDown: onCommitStart,
    onKeyUp: onCommitEnd,
    onBlur: onCommitEnd,
  };

  const depthStrokes = (state.depthMask ?? []).reduce(
    (count, mask) => count + (mask.enabled && mask.kind === 'brush' ? mask.strokes.length : 0),
    0,
  );

  return (
    <div className={`flex flex-col gap-3 p-3 ${className}`} data-testid="lens-blur-panel">
      <div className={rowClass}>
        <span className={labelClass}>Lens blur</span>
        <label className="flex items-center gap-2 text-[11px] text-[color:var(--ui-text-c8cfda)]">
          <input
            type="checkbox"
            data-testid="lens-blur-enabled"
            className="accent-[var(--ui-accent)]"
            checked={state.enabled}
            disabled={disabled}
            onChange={(event) => {
              onCommitStart?.();
              patch({ enabled: event.target.checked });
              onCommitEnd?.();
            }}
          />
          Enabled
        </label>
        <span className="ml-auto text-[11px] text-[color:var(--ui-text-8a94a6)]">
          f/{state.aperture.toFixed(1)}
        </span>
      </div>

      <div className={rowClass}>
        <span className={labelClass}>Focus plane</span>
        <input
          type="range"
          data-testid="lens-focus-plane"
          className={rangeClass}
          min={0}
          max={1}
          step={0.01}
          value={state.focusPlane}
          disabled={disabled}
          {...commit}
          onChange={(event) => patch({ focusPlane: Number(event.target.value) })}
        />
        <span className={valueClass} data-testid="lens-focus-plane-value">
          {percent(state.focusPlane)}
        </span>
      </div>

      <div className={rowClass}>
        <span className={labelClass}>Focus range</span>
        <input
          type="range"
          data-testid="lens-focus-range"
          className={rangeClass}
          min={0}
          max={1}
          step={0.01}
          value={state.focusRange}
          disabled={disabled}
          {...commit}
          onChange={(event) => patch({ focusRange: Number(event.target.value) })}
        />
        <span className={valueClass} data-testid="lens-focus-range-value">
          {percent(state.focusRange)}
        </span>
      </div>

      <div className={rowClass}>
        <span className={labelClass}>Aperture</span>
        <input
          type="range"
          data-testid="lens-aperture"
          className={rangeClass}
          min={1}
          max={22}
          step={0.1}
          value={state.aperture}
          disabled={disabled}
          {...commit}
          onChange={(event) => patch({ aperture: Number(event.target.value) })}
        />
        <span className={valueClass} data-testid="lens-aperture-value">
          f/{state.aperture.toFixed(1)}
        </span>
      </div>

      <div className={rowClass}>
        <span className={labelClass}>Blades</span>
        <input
          type="range"
          data-testid="lens-blades"
          className={rangeClass}
          min={5}
          max={9}
          step={1}
          value={state.bladeCount}
          disabled={disabled}
          {...commit}
          onChange={(event) => patch({ bladeCount: Number(event.target.value) })}
        />
        <span className={valueClass} data-testid="lens-blades-value">
          {state.bladeCount}
        </span>
      </div>

      <div className={rowClass}>
        <span className={labelClass}>Rotation</span>
        <input
          type="range"
          data-testid="lens-rotation"
          className={rangeClass}
          min={-180}
          max={180}
          step={1}
          value={state.rotationDeg}
          disabled={disabled}
          {...commit}
          onChange={(event) => patch({ rotationDeg: Number(event.target.value) })}
        />
        <span className={valueClass} data-testid="lens-rotation-value">
          {Math.round(state.rotationDeg)}°
        </span>
      </div>

      <div className={rowClass}>
        <span className={labelClass}>Highlight boost</span>
        <input
          type="range"
          data-testid="lens-highlight-boost"
          className={rangeClass}
          min={0}
          max={2}
          step={0.05}
          value={state.highlightBoost}
          disabled={disabled}
          {...commit}
          onChange={(event) => patch({ highlightBoost: Number(event.target.value) })}
        />
        <span className={valueClass} data-testid="lens-highlight-boost-value">
          {state.highlightBoost.toFixed(2)}
        </span>
      </div>

      <div className={rowClass}>
        <span className={labelClass}>Quality</span>
        <select
          data-testid="lens-quality"
          className="flex-1 rounded border border-[color:var(--ui-border-1e2430)] bg-[var(--ui-bg-11141a)] px-2 py-1 text-[11px] text-[color:var(--ui-text-c8cfda)]"
          value={state.quality}
          disabled={disabled}
          onChange={(event) => {
            onCommitStart?.();
            patch({ quality: event.target.value as LensBlurQuality });
            onCommitEnd?.();
          }}
        >
          <option value="preview">Preview (half res)</option>
          <option value="export">Export (full res)</option>
        </select>
      </div>

      <div className={rowClass}>
        <span className={labelClass}>Depth</span>
        <span className="flex-1 text-[11px] text-[color:var(--ui-text-8a94a6)]" data-testid="lens-depth-status">
          {state.depthMask ? `Manual mask · ${depthStrokes} stroke${depthStrokes === 1 ? '' : 's'}` : 'Procedural (radial)'}
        </span>
        <button
          type="button"
          data-testid="lens-depth-clear"
          className="rounded border border-[color:var(--ui-border-1e2430)] px-2 py-1 text-[11px] text-[color:var(--ui-text-c8cfda)] hover:border-[color:var(--ui-accent)] disabled:opacity-40"
          disabled={disabled || !state.depthMask}
          onClick={() => {
            onCommitStart?.();
            patch({ depthMask: null });
            onCommitEnd?.();
          }}
        >
          Clear mask
        </button>
      </div>
    </div>
  );
};
