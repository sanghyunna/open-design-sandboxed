import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import styles from './ManualEditMoveFrame.module.css';

type Rect = { left: number; top: number; width: number; height: number };
type Delta = { x: number; y: number };
type Region = 'ring' | 'interior';

export type ManualEditMoveFrameProps = {
  rect: Rect; // overlay rect in canvas space (host passes manualEditResizeRect)
  scale: number; // overlayPreviewScale (client px per rect px)
  mode: 'editing' | 'selected';
  interactive: boolean; // interior click can re-enter text edit (kind text|link)
  label: string; // aria-label for the move surface
  onMoveStart: () => void; // drag threshold crossed
  onMovePreview: (delta: Delta) => void; // rect-space delta, per rAF frame
  onMoveCommit: (delta: Delta) => void; // pointerup after a real drag
  onMoveCancel: () => void; // Esc / pointercancel mid-drag
  onSurfaceClick: (region: Region) => void; // pointerup with NO drag
};

// px, unscaled — the frame lives in canvas-space overlay coords.
const RING_SELECTED = 10;
// Editing mode's ring overlays the editable element's own edge (PPT keeps the
// frame outside the text box); a thinner band leaves more of the content edge
// clickable for caret placement instead of hitting the move ring.
const RING_EDITING = 4;
// client px; hypot distance before a press becomes a drag (vs a click).
const DRAG_THRESHOLD = 3;

type DragState = {
  region: Region;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
  target: HTMLElement;
};

export function ManualEditMoveFrame({
  rect,
  scale,
  mode,
  interactive,
  label,
  onMoveStart,
  onMovePreview,
  onMoveCommit,
  onMoveCancel,
  onSurfaceClick,
}: ManualEditMoveFrameProps) {
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef<number | null>(null);
  // Tracked separately from the rAF id: a synchronously-executing
  // requestAnimationFrame (test stubs, polyfills) runs flushPreview BEFORE the
  // id is assigned, so the id alone cannot answer "is a flush still queued".
  const flushScheduledRef = useRef(false);
  const pendingDeltaRef = useRef<Delta | null>(null);

  useEffect(() => () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
  }, []);

  const flushPreview = () => {
    flushScheduledRef.current = false;
    rafRef.current = null;
    const drag = dragRef.current;
    const delta = pendingDeltaRef.current;
    if (!drag || !delta) return;
    onMovePreview(delta);
  };

  const scheduleFlush = (delta: Delta) => {
    pendingDeltaRef.current = delta;
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    const id = requestAnimationFrame(flushPreview);
    // A sync rAF already ran flushPreview here; don't resurrect the id.
    if (flushScheduledRef.current) rafRef.current = id;
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    flushScheduledRef.current = false;
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

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const region = (target.getAttribute('data-region') as Region | null) ?? 'interior';
    if (typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // jsdom / unsupported: fall back to plain listener-based dragging.
      }
    }
    // preventDefault() above suppresses implicit focus, so focus explicitly;
    // otherwise the Escape-cancels-drag onKeyDown never lands here.
    if (typeof target.focus === 'function') target.focus({ preventScroll: true });
    dragRef.current = {
      region,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      target,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dxClient = event.clientX - drag.startX;
    const dyClient = event.clientY - drag.startY;
    if (!drag.dragging) {
      if (Math.hypot(dxClient, dyClient) < DRAG_THRESHOLD) return;
      drag.dragging = true;
      onMoveStart();
    }
    scheduleFlush({ x: dxClient / scale, y: dyClient / scale });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = pendingDeltaRef.current;
    const finalFrameUnsent = flushScheduledRef.current;
    const dragging = drag.dragging;
    const region = drag.region;
    endDrag();
    pendingDeltaRef.current = null;
    if (dragging && delta) {
      // endDrag() cancelled any queued rAF flush; without this the last mouse
      // move dies in that queue — the element never renders the committed delta.
      if (finalFrameUnsent) onMovePreview(delta);
      onMoveCommit(delta);
    } else if (region !== 'interior' || interactive) {
      // Non-interactive elements (host-side gate) can't re-enter text edit;
      // an interior click on them is a no-op. Ring clicks always report —
      // they only ever promote editing -> selected, never re-enter edit.
      onSurfaceClick(region);
    }
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dragging = drag.dragging;
    endDrag();
    pendingDeltaRef.current = null;
    if (dragging) onMoveCancel();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !dragRef.current) return;
    const dragging = dragRef.current.dragging;
    event.preventDefault();
    event.stopPropagation();
    endDrag();
    pendingDeltaRef.current = null;
    if (dragging) onMoveCancel();
  };

  const surfaceProps = (region: Region) => ({
    'data-region': region,
    tabIndex: -1,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onKeyDown: handleKeyDown,
  });

  const ringSize = mode === 'editing' ? RING_EDITING : RING_SELECTED;

  return (
    <div
      className={`${styles.container} ${mode === 'editing' ? styles.editing : styles.selected}`}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      role="group"
      aria-label={label}
    >
      <div className={`${styles.ring} ${styles.ringTop}`} style={{ height: ringSize }} {...surfaceProps('ring')} />
      <div className={`${styles.ring} ${styles.ringBottom}`} style={{ height: ringSize }} {...surfaceProps('ring')} />
      <div className={`${styles.ring} ${styles.ringLeft}`} style={{ width: ringSize }} {...surfaceProps('ring')} />
      <div className={`${styles.ring} ${styles.ringRight}`} style={{ width: ringSize }} {...surfaceProps('ring')} />
      {mode === 'selected' ? (
        <div className={styles.interior} style={{ inset: ringSize }} {...surfaceProps('interior')} />
      ) : null}
    </div>
  );
}
