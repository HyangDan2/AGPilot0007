import React, { useCallback, useMemo, useRef, useState } from 'react';
import { type GeometryTransform } from '../../engine/contracts/geometry';
import { rotatedAspect } from '../../engine/contracts/geometryMappings';
import {
  CROP_HANDLES,
  fullFrameCrop,
  isFullFrameCrop,
  nudgeCrop,
  resizeCrop,
  type CropHandle,
  type CropResizeHandle,
} from './cropGeometry';

export interface GeometryOverlayProps {
  geometry: GeometryTransform;
  onChange: (patch: Partial<GeometryTransform>) => void;
  /** Fired once per gesture so the host can open a single history entry. */
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** Compare/original mode hides every overlay. */
  hidden?: boolean;
  className?: string;
}

/**
 * Frame aspect of the uncropped corrected image. The host must size its preview
 * frame to this aspect while crop editing is active so the overlay and image
 * share one coordinate space.
 */
export function geometryOverlayAspect(
  geometry: GeometryTransform,
  sourceAspect: number,
): number {
  return rotatedAspect(geometry.rotation, sourceAspect);
}

interface DragState {
  handle: CropHandle;
  startX: number;
  startY: number;
  startCrop: { x: number; y: number; width: number; height: number };
  pointerId: number;
}

const HANDLE_STYLE: Record<CropResizeHandle, React.CSSProperties> = {
  nw: { left: '0%', top: '0%', transform: 'translate(-50%, -50%)', cursor: 'nwse-resize' },
  n: { left: '50%', top: '0%', transform: 'translate(-50%, -50%)', cursor: 'ns-resize' },
  ne: { left: '100%', top: '0%', transform: 'translate(-50%, -50%)', cursor: 'nesw-resize' },
  e: { left: '100%', top: '50%', transform: 'translate(-50%, -50%)', cursor: 'ew-resize' },
  se: { left: '100%', top: '100%', transform: 'translate(-50%, -50%)', cursor: 'nwse-resize' },
  s: { left: '50%', top: '100%', transform: 'translate(-50%, -50%)', cursor: 'ns-resize' },
  sw: { left: '0%', top: '100%', transform: 'translate(-50%, -50%)', cursor: 'nesw-resize' },
  w: { left: '0%', top: '50%', transform: 'translate(-50%, -50%)', cursor: 'ew-resize' },
};

const HANDLE_LABEL: Record<CropResizeHandle, string> = {
  nw: 'Crop top-left',
  n: 'Crop top edge',
  ne: 'Crop top-right',
  e: 'Crop right edge',
  se: 'Crop bottom-right',
  s: 'Crop bottom edge',
  sw: 'Crop bottom-left',
  w: 'Crop left edge',
};

export const GeometryOverlay: React.FC<GeometryOverlayProps> = ({
  geometry,
  onChange,
  onDragStart,
  onDragEnd,
  hidden = false,
  className = '',
}) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const crop = useMemo(() => geometry.crop ?? fullFrameCrop(), [geometry.crop]);

  const emit = useCallback(
    (next: { x: number; y: number; width: number; height: number }) => {
      onChange({ crop: isFullFrameCrop(next) ? null : next });
    },
    [onChange],
  );

  const endDrag = useCallback(
    (event?: React.PointerEvent) => {
      if (!dragRef.current) return;
      if (event && frameRef.current?.hasPointerCapture?.(event.pointerId)) {
        frameRef.current.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
      setDragging(false);
      onDragEnd?.();
    },
    [onDragEnd],
  );

  const handlePointerDown = useCallback(
    (handle: CropHandle) => (event: React.PointerEvent) => {
      if (event.button !== undefined && event.button !== 0) return;
      const frame = frameRef.current;
      if (!frame) return;
      event.preventDefault();
      event.stopPropagation();
      frame.setPointerCapture?.(event.pointerId);
      dragRef.current = {
        handle,
        startX: event.clientX,
        startY: event.clientY,
        startCrop: { ...crop },
        pointerId: event.pointerId,
      };
      setDragging(true);
      onDragStart?.();
    },
    [crop, onDragStart],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      const frame = frameRef.current;
      if (!drag || !frame) return;
      const rect = frame.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const deltaX = (event.clientX - drag.startX) / rect.width;
      const deltaY = (event.clientY - drag.startY) / rect.height;
      emit(resizeCrop(drag.startCrop, drag.handle, deltaX, deltaY));
    },
    [emit],
  );

  const handleKeyDown = useCallback(
    (handle: CropHandle) => (event: React.KeyboardEvent) => {
      const next = nudgeCrop(crop, handle, event.key, event.shiftKey);
      if (!next) return;
      event.preventDefault();
      onDragStart?.();
      emit(next);
      onDragEnd?.();
    },
    [crop, emit, onDragEnd, onDragStart],
  );

  if (hidden) return null;

  return (
    <div
      ref={frameRef}
      className={`absolute inset-0 touch-none select-none ${className}`}
      data-testid="geometry-overlay"
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className="absolute"
        style={{
          left: `${crop.x * 100}%`,
          top: `${crop.y * 100}%`,
          width: `${crop.width * 100}%`,
          height: `${crop.height * 100}%`,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.45)',
          outline: dragging ? '2px solid var(--ui-accent, #f5c451)' : '1px solid rgba(255,255,255,0.85)',
        }}
      >
        <div
          role="button"
          tabIndex={0}
          aria-label="Move crop"
          className="absolute inset-0 cursor-move"
          data-testid="geometry-crop-move"
          onPointerDown={handlePointerDown('move')}
          onKeyDown={handleKeyDown('move')}
        >
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/3 top-0 h-full w-px bg-white/30" />
            <div className="absolute left-2/3 top-0 h-full w-px bg-white/30" />
            <div className="absolute top-1/3 left-0 h-px w-full bg-white/30" />
            <div className="absolute top-2/3 left-0 h-px w-full bg-white/30" />
          </div>
        </div>
        {CROP_HANDLES.map((handle) => (
          <div
            key={handle}
            role="button"
            tabIndex={0}
            aria-label={HANDLE_LABEL[handle]}
            data-testid={`geometry-handle-${handle}`}
            className="absolute h-4 w-4 rounded-full border border-white bg-[var(--ui-accent,#f5c451)] shadow"
            style={{ ...HANDLE_STYLE[handle], touchAction: 'none' }}
            onPointerDown={handlePointerDown(handle)}
            onKeyDown={handleKeyDown(handle)}
          />
        ))}
      </div>
    </div>
  );
};
