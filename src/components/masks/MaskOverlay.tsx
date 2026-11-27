import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { LocalAdjustmentGroup } from '../../engine/contracts/localAdjustments';
import type { BrushMask, LinearMask, MaskData, RadialMask } from '../../engine/contracts/masks';

export interface MaskOverlayProps {
  group: LocalAdjustmentGroup | null;
  selectedMaskId?: string | null;
  /** Output aspect (width / height) for short-side radius conversion. */
  aspect?: number;
  hidden?: boolean;
  className?: string;
  onMaskChange?: (maskId: string, patch: Partial<MaskData>) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

type DragTarget =
  | { maskId: string; kind: 'linear'; end: 'start' | 'end' }
  | { maskId: string; kind: 'radial'; end: 'center' | 'radius' }
  | { maskId: string; kind: 'brush'; stroke: number; point: number };

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const clampRadius = (value: number): number => Math.min(2, Math.max(0.001, value));

/** Short-side radius expressed in normalized image units for the given aspect. */
export function shortSideRadiusToNis(radius: number, aspect: number, axis: 'x' | 'y'): number {
  return axis === 'x' ? radius * Math.min(1, 1 / aspect) : radius * Math.min(1, aspect);
}

const HANDLE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const;

export function MaskOverlay({
  group,
  selectedMaskId = null,
  aspect = 1,
  hidden = false,
  className = '',
  onMaskChange,
  onDragStart,
  onDragEnd,
}: MaskOverlayProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragTarget | null>(null);
  const [dragging, setDragging] = useState(false);

  if (hidden || !group) return null;

  const selected = group.masks.find((mask) => mask.id === selectedMaskId) ?? null;

  const readPoint = (event: { clientX: number; clientY: number }) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  };

  const applyDrag = (target: DragTarget, point: { x: number; y: number }) => {
    const mask = group.masks.find((candidate) => candidate.id === target.maskId);
    if (!mask) return;
    if (target.kind === 'linear' && mask.kind === 'linear') {
      onMaskChange?.(mask.id, {
        ...(target.end === 'start' ? { start: point } : { end: point }),
      } as Partial<LinearMask>);
      return;
    }
    if (target.kind === 'radial' && mask.kind === 'radial') {
      if (target.end === 'center') {
        onMaskChange?.(mask.id, { center: point } as Partial<RadialMask>);
        return;
      }
      const dx = Math.abs(point.x - mask.center.x) * Math.max(1, aspect);
      const dy = Math.abs(point.y - mask.center.y) * Math.max(1, 1 / aspect);
      onMaskChange?.(mask.id, {
        radiusX: clampRadius(dx),
        radiusY: clampRadius(dy),
      } as Partial<RadialMask>);
      return;
    }
    if (target.kind === 'brush' && mask.kind === 'brush') {
      const strokes = mask.strokes.map((stroke, strokeIndex) =>
        strokeIndex === target.stroke
          ? {
              ...stroke,
              points: stroke.points.map((existing, pointIndex) =>
                pointIndex === target.point ? point : existing,
              ),
            }
          : stroke,
      );
      onMaskChange?.(mask.id, { strokes } as Partial<BrushMask>);
    }
  };

  const beginDrag = (target: DragTarget) => (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    frameRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = target;
    setDragging(true);
    onDragStart?.();
  };

  const handlePointerMove = (event: ReactPointerEvent) => {
    const target = dragRef.current;
    if (!target) return;
    const point = readPoint(event);
    if (point) applyDrag(target, point);
  };

  const stopDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    onDragEnd?.();
  };

  const appendBrushPoint = (event: ReactPointerEvent) => {
    if (event.target !== frameRef.current) return;
    if (!selected || selected.kind !== 'brush') return;
    const point = readPoint(event);
    if (!point) return;
    const strokes = selected.strokes.length
      ? selected.strokes.map((stroke, index) =>
          index === selected.strokes.length - 1
            ? { ...stroke, points: [...stroke.points, point] }
            : stroke,
        )
      : [{ points: [point], radius: 0.15, hardness: 0.5, flow: 1 }];
    const strokeIndex = strokes.length - 1;
    onMaskChange?.(selected.id, { strokes } as Partial<BrushMask>);
    dragRef.current = {
      maskId: selected.id,
      kind: 'brush',
      stroke: strokeIndex,
      point: strokes[strokeIndex].points.length - 1,
    };
    frameRef.current?.setPointerCapture(event.pointerId);
    setDragging(true);
    onDragStart?.();
  };

  const nudge = (target: DragTarget, mask: MaskData) => (event: ReactKeyboardEvent) => {
    if (!HANDLE_KEYS.includes(event.key as (typeof HANDLE_KEYS)[number])) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.05 : 0.01;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (target.kind === 'linear' && mask.kind === 'linear') {
      const base = target.end === 'start' ? mask.start : mask.end;
      applyDrag(target, { x: clamp01(base.x + dx), y: clamp01(base.y + dy) });
    } else if (target.kind === 'radial' && mask.kind === 'radial') {
      if (target.end === 'center') {
        applyDrag(target, { x: clamp01(mask.center.x + dx), y: clamp01(mask.center.y + dy) });
      } else {
        const radiusX = clampRadius(mask.radiusX + dx * Math.max(1, aspect));
        const radiusY = clampRadius(mask.radiusY + dy * Math.max(1, 1 / aspect));
        onMaskChange?.(mask.id, { radiusX, radiusY } as Partial<RadialMask>);
      }
    } else if (target.kind === 'brush' && mask.kind === 'brush') {
      const current = mask.strokes[target.stroke]?.points[target.point];
      if (current) {
        applyDrag(target, { x: clamp01(current.x + dx), y: clamp01(current.y + dy) });
      }
    }
  };

  const handle = (label: string, x: number, y: number, testId: string, target: DragTarget) => {
    const mask = group.masks.find((candidate) => candidate.id === target.maskId);
    return (
      <button
        key={testId}
        type="button"
        aria-label={label}
        data-testid={testId}
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-sky-400/80 shadow"
        style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: 14, height: 14 }}
        onPointerDown={beginDrag(target)}
        onKeyDown={mask ? nudge(target, mask) : undefined}
      />
    );
  };

  return (
    <div
      ref={frameRef}
      data-testid="mask-overlay"
      className={`absolute inset-0 touch-none select-none ${dragging ? 'cursor-grabbing' : ''} ${className}`}
      onPointerDown={appendBrushPoint}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
        {group.masks.map((mask) => renderShape(mask, aspect, mask.id === selectedMaskId))}
      </svg>
      {selected?.kind === 'linear'
        ? [
            handle('Linear start', selected.start.x, selected.start.y, 'mask-handle-start', {
              maskId: selected.id,
              kind: 'linear',
              end: 'start',
            }),
            handle('Linear end', selected.end.x, selected.end.y, 'mask-handle-end', {
              maskId: selected.id,
              kind: 'linear',
              end: 'end',
            }),
          ]
        : null}
      {selected?.kind === 'radial'
        ? [
            handle('Radial center', selected.center.x, selected.center.y, 'mask-handle-center', {
              maskId: selected.id,
              kind: 'radial',
              end: 'center',
            }),
            handle(
              'Radial radius',
              clamp01(selected.center.x + shortSideRadiusToNis(selected.radiusX, aspect, 'x')),
              clamp01(selected.center.y + shortSideRadiusToNis(selected.radiusY, aspect, 'y')),
              'mask-handle-radius',
              { maskId: selected.id, kind: 'radial', end: 'radius' },
            ),
          ]
        : null}
      {selected?.kind === 'brush'
        ? selected.strokes.flatMap((stroke, strokeIndex) =>
            stroke.points.slice(0, 24).map((point, pointIndex) =>
              handle(
                `Brush point ${strokeIndex + 1}-${pointIndex + 1}`,
                point.x,
                point.y,
                `mask-handle-brush-${strokeIndex}-${pointIndex}`,
                { maskId: selected.id, kind: 'brush', stroke: strokeIndex, point: pointIndex },
              ),
            ),
          )
        : null}
    </div>
  );
}

function renderShape(mask: MaskData, aspect: number, active: boolean) {
  const stroke = active ? 'rgba(125,211,252,0.9)' : 'rgba(148,163,184,0.45)';
  const fill = active ? 'rgba(56,189,248,0.16)' : 'rgba(148,163,184,0.08)';
  const dash = mask.enabled ? undefined : '4 4';
  switch (mask.kind) {
    case 'linear': {
      const dx = mask.end.x - mask.start.x;
      const dy = mask.end.y - mask.start.y;
      const length = Math.hypot(dx, dy) || 1;
      const normal = { x: -dy / length, y: dx / length };
      const reach = 2;
      const points = [
        `${mask.start.x},${mask.start.y}`,
        `${mask.start.x + normal.x * reach},${mask.start.y + normal.y * reach}`,
        `${mask.end.x + normal.x * reach},${mask.end.y + normal.y * reach}`,
        `${mask.end.x},${mask.end.y}`,
      ].join(' ');
      return (
        <g key={mask.id}>
          <polygon points={points} fill={fill} />
          <line
            x1={mask.start.x}
            y1={mask.start.y}
            x2={mask.end.x}
            y2={mask.end.y}
            stroke={stroke}
            strokeWidth={0.006}
            strokeDasharray={dash}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      );
    }
    case 'radial':
      return (
        <ellipse
          key={mask.id}
          cx={mask.center.x}
          cy={mask.center.y}
          rx={shortSideRadiusToNis(mask.radiusX, aspect, 'x')}
          ry={shortSideRadiusToNis(mask.radiusY, aspect, 'y')}
          transform={`rotate(${mask.rotation} ${mask.center.x} ${mask.center.y})`}
          fill={fill}
          stroke={stroke}
          strokeWidth={0.006}
          strokeDasharray={dash}
          vectorEffect="non-scaling-stroke"
        />
      );
    case 'brush':
      return (
        <g key={mask.id}>
          {mask.strokes.map((brushStroke, index) => (
            <polyline
              key={index}
              points={brushStroke.points.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke={stroke}
              strokeWidth={brushStroke.radius * 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={dash}
            />
          ))}
        </g>
      );
    case 'luminance':
      return (
        <rect
          key={mask.id}
          x={0}
          y={0}
          width={1}
          height={1}
          fill={fill}
          stroke={stroke}
          strokeWidth={0.006}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
      );
    case 'color':
      return (
        <g key={mask.id}>
          <rect
            x={4}
            y={4}
            width={12}
            height={12}
            fill={`rgb(${Math.round(mask.color.r * 255)},${Math.round(mask.color.g * 255)},${Math.round(mask.color.b * 255)})`}
            stroke={stroke}
            strokeWidth={0.006}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      );
    default:
      return null;
  }
}
