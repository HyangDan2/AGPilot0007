import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { BrushMask, MaskData } from '../../engine/contracts/masks';

export interface LensBlurOverlayProps {
  depthMask: MaskData[] | null;
  onDepthMaskChange: (next: MaskData[] | null) => void;
  hidden?: boolean;
  className?: string;
  /** Short-side brush radius (same units as mask strokes). */
  brushRadius?: number;
  brushFlow?: number;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

const MASK_ID = 'lens-depth-brush';
const MIN_POINT_DISTANCE = 0.004;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function depthBrush(depthMask: MaskData[] | null): BrushMask {
  const existing = depthMask?.find(
    (mask): mask is BrushMask => mask.kind === 'brush' && mask.id === MASK_ID,
  );
  if (existing) return existing;
  return {
    id: MASK_ID,
    name: 'Depth brush',
    enabled: true,
    blend: 'add',
    opacity: 1,
    inverted: false,
    kind: 'brush',
    strokes: [],
  };
}

function withBrush(depthMask: MaskData[] | null, brush: BrushMask): MaskData[] {
  if (!depthMask || depthMask.length === 0) return [brush];
  const index = depthMask.findIndex((mask) => mask.id === MASK_ID);
  if (index < 0) return [...depthMask, brush];
  return depthMask.map((mask, maskIndex) => (maskIndex === index ? brush : mask));
}

/**
 * Paints the manual depth/focus mask as brush strokes. Coordinates and stroke
 * fields match the shared mask schema, so the rasterizer treats the coverage as
 * normalized depth (0 near, 1 far). Painting starts a new stroke on every press.
 */
export function LensBlurOverlay({
  depthMask,
  onDepthMaskChange,
  hidden = false,
  className = '',
  brushRadius = 0.12,
  brushFlow = 0.8,
  onDragStart,
  onDragEnd,
}: LensBlurOverlayProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const paintingRef = useRef(false);
  const strokeRef = useRef<{ stroke: number; point: number } | null>(null);
  const [painting, setPainting] = useState(false);

  if (hidden) return null;

  const brush = depthBrush(depthMask);

  const readPoint = (event: { clientX: number; clientY: number }) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  };

  const commit = (nextBrush: BrushMask) => {
    onDepthMaskChange(withBrush(depthMask, nextBrush));
  };

  const beginStroke = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    const point = readPoint(event);
    if (!point) return;
    event.preventDefault();
    frameRef.current?.setPointerCapture(event.pointerId);
    const strokes = [
      ...brush.strokes,
      { points: [point], radius: brushRadius, hardness: 0.6, flow: brushFlow },
    ];
    commit({ ...brush, strokes });
    strokeRef.current = { stroke: strokes.length - 1, point: 0 };
    paintingRef.current = true;
    setPainting(true);
    onDragStart?.();
  };

  const extendStroke = (event: ReactPointerEvent) => {
    if (!paintingRef.current || !strokeRef.current) return;
    const point = readPoint(event);
    if (!point) return;
    const { stroke: strokeIndex } = strokeRef.current;
    const stroke = brush.strokes[strokeIndex];
    if (!stroke) return;
    const last = stroke.points[stroke.points.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < MIN_POINT_DISTANCE) return;
    const strokes = brush.strokes.map((candidate, index) =>
      index === strokeIndex ? { ...candidate, points: [...candidate.points, point] } : candidate,
    );
    commit({ ...brush, strokes });
  };

  const endStroke = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    strokeRef.current = null;
    setPainting(false);
    onDragEnd?.();
  };

  const strokeCount = brush.strokes.length;

  return (
    <div
      ref={frameRef}
      data-testid="lens-blur-overlay"
      className={`absolute inset-0 touch-none select-none ${painting ? 'cursor-crosshair' : ''} ${className}`}
      onPointerDown={beginStroke}
      onPointerMove={extendStroke}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
        {brush.strokes.map((stroke, index) => (
          <polyline
            key={index}
            data-testid="lens-blur-stroke"
            points={stroke.points.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke="rgba(250,204,21,0.55)"
            strokeWidth={stroke.radius * 2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-2 py-1 text-[11px] text-amber-200">
        {strokeCount === 0
          ? 'Paint depth: near (dark) → far (light)'
          : `Depth mask · ${strokeCount} stroke${strokeCount === 1 ? '' : 's'}`}
      </div>
    </div>
  );
}

