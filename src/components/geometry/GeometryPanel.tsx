import React, { useCallback } from 'react';
import {
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
  RotateCw,
  Undo2,
} from 'lucide-react';
import { type GeometryTransform, MAX_STRAIGHTEN_DEGREES } from '../../engine/contracts/geometry';
import { type OpticalTransform } from '../../engine/contracts/optical';
import { createPerspectiveTransform, normalizeOpticalTransform } from '../../engine/optical/transform';

export interface GeometryPanelProps {
  geometry: GeometryTransform;
  optical: OpticalTransform | null;
  onGeometryChange: (patch: Partial<GeometryTransform>) => void;
  onOpticalChange: (next: OpticalTransform | null) => void;
  /** History grouping hooks; the host owns commit semantics. */
  onCommitStart?: () => void;
  onCommitEnd?: () => void;
  disabled?: boolean;
  className?: string;
}

const PERSPECTIVE_RANGE = 1;
const PERSPECTIVE_STRENGTH = 0.15;

function perspectiveControls(optical: OpticalTransform | null): { vertical: number; horizontal: number } {
  const quad = optical?.perspective;
  if (!quad) return { vertical: 0, horizontal: 0 };
  const vertical = quad[0].x / PERSPECTIVE_STRENGTH;
  const horizontal = quad[1].y / PERSPECTIVE_STRENGTH;
  return {
    vertical: Math.min(PERSPECTIVE_RANGE, Math.max(-PERSPECTIVE_RANGE, vertical)),
    horizontal: Math.min(PERSPECTIVE_RANGE, Math.max(-PERSPECTIVE_RANGE, horizontal)),
  };
}

function withPerspective(
  optical: OpticalTransform | null,
  vertical: number,
  horizontal: number,
): OpticalTransform | null {
  if (Math.abs(vertical) <= 1e-6 && Math.abs(horizontal) <= 1e-6) {
    if (!optical) return null;
    if (!optical.distortion) return null;
    return normalizeOpticalTransform({
      version: 1,
      homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      distortion: { ...optical.distortion },
    });
  }
  const transform = createPerspectiveTransform(vertical, horizontal);
  if (!optical?.distortion) return transform;
  return normalizeOpticalTransform({
    version: 1,
    homography: [...transform.homography],
    perspective: transform.perspective,
    distortion: { ...optical.distortion },
  });
}

const buttonClass =
  'inline-flex h-8 w-8 items-center justify-center rounded border border-[color:var(--ui-border-1e2430)] bg-[var(--ui-bg-11141a)] text-[color:var(--ui-text-c8cfda)] hover:border-[color:var(--ui-accent)] disabled:opacity-40 disabled:cursor-not-allowed';

const rowClass = 'flex items-center gap-2';
const labelClass = 'w-16 shrink-0 text-[11px] text-[color:var(--ui-text-8a94a6)]';

export const GeometryPanel: React.FC<GeometryPanelProps> = ({
  geometry,
  optical,
  onGeometryChange,
  onOpticalChange,
  onCommitStart,
  onCommitEnd,
  disabled = false,
  className = '',
}) => {
  const perspective = perspectiveControls(optical);

  const updatePerspective = useCallback(
    (vertical: number, horizontal: number) => {
      onOpticalChange(withPerspective(optical, vertical, horizontal));
    },
    [onOpticalChange, optical],
  );

  const rotate = (direction: 90 | 270) => {
    if (disabled) return;
    onCommitStart?.();
    onGeometryChange({
      rotation: (((geometry.rotation + direction) % 360) as GeometryTransform['rotation']),
    });
    onCommitEnd?.();
  };

  const flip = (axis: 'flipHorizontal' | 'flipVertical') => {
    if (disabled) return;
    onCommitStart?.();
    onGeometryChange({ [axis]: !geometry[axis] });
    onCommitEnd?.();
  };

  return (
    <div className={`flex flex-col gap-3 p-3 ${className}`} data-testid="geometry-panel">
      <div className={rowClass}>
        <span className={labelClass}>Rotate</span>
        <button
          type="button"
          className={buttonClass}
          aria-label="Rotate left 90 degrees"
          disabled={disabled}
          onClick={() => rotate(270)}
        >
          <RotateCcw size={15} />
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label="Rotate right 90 degrees"
          disabled={disabled}
          onClick={() => rotate(90)}
        >
          <RotateCw size={15} />
        </button>
        <button
          type="button"
          className={`${buttonClass} ${geometry.flipHorizontal ? 'border-[color:var(--ui-accent)]' : ''}`}
          aria-label="Flip horizontal"
          aria-pressed={geometry.flipHorizontal}
          disabled={disabled}
          onClick={() => flip('flipHorizontal')}
        >
          <FlipHorizontal2 size={15} />
        </button>
        <button
          type="button"
          className={`${buttonClass} ${geometry.flipVertical ? 'border-[color:var(--ui-accent)]' : ''}`}
          aria-label="Flip vertical"
          aria-pressed={geometry.flipVertical}
          disabled={disabled}
          onClick={() => flip('flipVertical')}
        >
          <FlipVertical2 size={15} />
        </button>
        <button
          type="button"
          className={`${buttonClass} ml-auto`}
          aria-label="Reset geometry"
          disabled={disabled}
          onClick={() => {
            onCommitStart?.();
            onGeometryChange({
              rotation: 0,
              straighten: 0,
              flipHorizontal: false,
              flipVertical: false,
              crop: null,
            });
            onCommitEnd?.();
          }}
        >
          <Undo2 size={15} />
        </button>
      </div>

      <label className={rowClass}>
        <span className={labelClass}>Straighten</span>
        <input
          type="range"
          className="h-1 min-w-0 flex-1 accent-[var(--ui-accent)]"
          aria-label="Straighten"
          min={-MAX_STRAIGHTEN_DEGREES}
          max={MAX_STRAIGHTEN_DEGREES}
          step={0.1}
          value={geometry.straighten}
          disabled={disabled}
          onPointerDown={onCommitStart}
          onKeyDown={onCommitStart}
          onChange={(event) => onGeometryChange({ straighten: Number(event.target.value) })}
          onPointerUp={onCommitEnd}
          onBlur={onCommitEnd}
        />
        <span className="w-12 text-right text-[11px] tabular-nums text-[color:var(--ui-text-c8cfda)]">
          {geometry.straighten.toFixed(1)}°
        </span>
      </label>

      <label className={rowClass}>
        <span className={labelClass}>Vertical</span>
        <input
          type="range"
          className="h-1 min-w-0 flex-1 accent-[var(--ui-accent)]"
          aria-label="Perspective vertical"
          min={-PERSPECTIVE_RANGE}
          max={PERSPECTIVE_RANGE}
          step={0.01}
          value={perspective.vertical}
          disabled={disabled}
          onPointerDown={onCommitStart}
          onKeyDown={onCommitStart}
          onChange={(event) => updatePerspective(Number(event.target.value), perspective.horizontal)}
          onPointerUp={onCommitEnd}
          onBlur={onCommitEnd}
        />
        <span className="w-12 text-right text-[11px] tabular-nums text-[color:var(--ui-text-c8cfda)]">
          {perspective.vertical.toFixed(2)}
        </span>
      </label>

      <label className={rowClass}>
        <span className={labelClass}>Horizontal</span>
        <input
          type="range"
          className="h-1 min-w-0 flex-1 accent-[var(--ui-accent)]"
          aria-label="Perspective horizontal"
          min={-PERSPECTIVE_RANGE}
          max={PERSPECTIVE_RANGE}
          step={0.01}
          value={perspective.horizontal}
          disabled={disabled}
          onPointerDown={onCommitStart}
          onKeyDown={onCommitStart}
          onChange={(event) => updatePerspective(perspective.vertical, Number(event.target.value))}
          onPointerUp={onCommitEnd}
          onBlur={onCommitEnd}
        />
        <span className="w-12 text-right text-[11px] tabular-nums text-[color:var(--ui-text-c8cfda)]">
          {perspective.horizontal.toFixed(2)}
        </span>
      </label>

      <div className={rowClass}>
        <span className="flex-1 text-[11px] text-[color:var(--ui-text-8a94a6)]">
          Perspective is applied in corrected NIS; crop stays post-straighten.
        </span>
        <button
          type="button"
          className="rounded border border-[color:var(--ui-border-1e2430)] px-2 py-1 text-[11px] text-[color:var(--ui-text-c8cfda)] hover:border-[color:var(--ui-accent)] disabled:opacity-40"
          aria-label="Reset perspective"
          disabled={disabled}
          onClick={() => {
            onCommitStart?.();
            onOpticalChange(withPerspective(optical, 0, 0));
            onCommitEnd?.();
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
};
