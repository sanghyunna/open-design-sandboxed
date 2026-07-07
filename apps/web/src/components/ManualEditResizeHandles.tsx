import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  RESIZE_HANDLE_DIRECTIONS,
  resizeDragSize,
  resizeHandlePositions,
  type ResizeHandleDirection,
} from '../edit-mode/resize-geometry';
import styles from './ManualEditResizeHandles.module.css';

type Rect = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };

export type ManualEditResizeHandlesProps = {
  rect: Rect;
  startSize: Size;
  scale: number;
  labels: Record<ResizeHandleDirection, string>;
  // Sizes are rect-space (getBoundingClientRect px). The host owns the
  // conversion to CSS width/height (see resizeCssCommitStyles) because it
  // needs the target's computed styles and rectScale, which this component
  // deliberately knows nothing about.
  onResizePreview: (direction: ResizeHandleDirection, size: Size, startSize: Size) => void;
  onResizeCommit: (direction: ResizeHandleDirection, size: Size, startSize: Size) => void;
  onResizeCancel: () => void;
};

type DragState = {
  direction: ResizeHandleDirection;
  pointerId: number;
  startX: number;
  startY: number;
  // Snapshot the baseline size at pointerdown: the live `startSize` prop can change
  // mid-drag when the iframe re-broadcasts target rects (window resize / ancestor
  // scroll), which would jump the delta baseline and snap the dragged size.
  startSize: Size;
  target: HTMLButtonElement;
};

// ponytail: no drag-image element; handles resize the overlay rect itself via optimistic
// local state, so there is nothing extra to render during a drag beyond size updates.
export function ManualEditResizeHandles({
  rect,
  startSize,
  scale,
  labels,
  onResizePreview,
  onResizeCommit,
  onResizeCancel,
}: ManualEditResizeHandlesProps) {
  const [liveSize, setLiveSize] = useState<Size | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingSizeRef = useRef<Size | null>(null);

  useEffect(() => () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
  }, []);

  const flushPreview = () => {
    rafRef.current = null;
    const drag = dragRef.current;
    const size = pendingSizeRef.current;
    if (!drag || !size) return;
    setLiveSize(size);
    onResizePreview(drag.direction, size, drag.startSize);
  };

  const scheduleFlush = (size: Size) => {
    pendingSizeRef.current = size;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(flushPreview);
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const target = drag.target;
    if (typeof target.releasePointerCapture === 'function') {
      try {
        target.releasePointerCapture(drag.pointerId);
      } catch {
        // jsdom / unsupported: pointer capture was never actually taken.
      }
    }
    return drag;
  };

  const handlePointerDown = (direction: ResizeHandleDirection) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    if (typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // jsdom / unsupported: fall back to plain listener-based dragging.
      }
    }
    // preventDefault() above suppresses the implicit mousedown-focus, so focus the
    // handle explicitly; otherwise the Escape-cancels-drag onKeyDown never fires
    // because keydown routes to whatever was previously focused.
    if (typeof target.focus === 'function') target.focus({ preventScroll: true });
    dragRef.current = {
      direction,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startSize,
      target,
    };
    setLiveSize(startSize);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const size = resizeDragSize({
      direction: drag.direction,
      startWidth: drag.startSize.width,
      startHeight: drag.startSize.height,
      deltaX: event.clientX - drag.startX,
      deltaY: event.clientY - drag.startY,
      scale,
      lockAspect: event.shiftKey,
    });
    scheduleFlush(size);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const size = pendingSizeRef.current;
    endDrag();
    setLiveSize(null);
    pendingSizeRef.current = null;
    if (size && (size.width !== drag.startSize.width || size.height !== drag.startSize.height)) {
      onResizeCommit(drag.direction, size, drag.startSize);
    } else {
      onResizeCancel();
    }
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    endDrag();
    setLiveSize(null);
    pendingSizeRef.current = null;
    onResizeCancel();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Escape' || !dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    endDrag();
    setLiveSize(null);
    pendingSizeRef.current = null;
    onResizeCancel();
  };

  const size = liveSize ?? startSize;
  const positions = resizeHandlePositions({
    left: rect.left,
    top: rect.top,
    width: size.width * scale,
    height: size.height * scale,
  });

  return (
    <div className={styles.container} style={{ left: rect.left, top: rect.top }}>
      {RESIZE_HANDLE_DIRECTIONS.map((direction) => {
        const position = positions[direction];
        return (
          <button
            key={direction}
            type="button"
            tabIndex={-1}
            aria-label={labels[direction]}
            data-direction={direction}
            className={`${styles.handle} ${styles[`handle-${direction}`]}`}
            style={{ left: position.left - rect.left, top: position.top - rect.top }}
            onPointerDown={handlePointerDown(direction)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onKeyDown={handleKeyDown}
          />
        );
      })}
    </div>
  );
}
