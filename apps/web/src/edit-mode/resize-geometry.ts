import type { ManualEditStyles } from './types';

export type ResizeHandleDirection = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const RESIZE_HANDLE_DIRECTIONS: readonly ResizeHandleDirection[] = [
  'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
];

const MIN_SIZE = 8;

// Placement-only floor: on a zero/near-zero-sized element all 8 handle centers
// would collapse onto one point and only the last-rendered button stays clickable.
// Spread the placement box to at least this many px so every handle stays reachable
// (does not affect committed size, which comes from resizeDragSize).
const MIN_HANDLE_SPREAD = 20;

// Sign of deltaX/deltaY contribution to width/height growth per direction.
// 0 means that axis is not affected by this direction.
const DELTA_SIGN: Record<ResizeHandleDirection, { x: number; y: number }> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
};

const IS_CORNER: Record<ResizeHandleDirection, boolean> = {
  nw: true, n: false, ne: true, e: false, se: true, s: false, sw: true, w: false,
};

export function resizeHandlePositions(
  rect: { left: number; top: number; width: number; height: number },
): Record<ResizeHandleDirection, { left: number; top: number }> {
  const { left, top } = rect;
  const width = Math.max(rect.width, MIN_HANDLE_SPREAD);
  const height = Math.max(rect.height, MIN_HANDLE_SPREAD);
  const midX = left + width / 2;
  const midY = top + height / 2;
  const right = left + width;
  const bottom = top + height;
  return {
    nw: { left, top },
    n: { left: midX, top },
    ne: { left: right, top },
    e: { left: right, top: midY },
    se: { left: right, top: bottom },
    s: { left: midX, top: bottom },
    sw: { left, top: bottom },
    w: { left, top: midY },
  };
}

export function resizeDragSize(args: {
  direction: ResizeHandleDirection;
  startWidth: number;
  startHeight: number;
  deltaX: number;
  deltaY: number;
  scale: number;
  lockAspect: boolean;
}): { width: number; height: number } {
  const { direction, startWidth, startHeight, deltaX, deltaY, lockAspect } = args;
  const scale = args.scale > 0 ? args.scale : 1;
  const sign = DELTA_SIGN[direction];

  const scaledDeltaX = (deltaX / scale) * sign.x;
  const scaledDeltaY = (deltaY / scale) * sign.y;

  let width = startWidth + scaledDeltaX;
  let height = startHeight + scaledDeltaY;

  if (lockAspect && IS_CORNER[direction] && startWidth > 0 && startHeight > 0) {
    const ratio = startWidth / startHeight;
    if (Math.abs(scaledDeltaX) >= Math.abs(scaledDeltaY)) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
  }

  width = Math.max(MIN_SIZE, Math.round(width));
  height = Math.max(MIN_SIZE, Math.round(height));

  return { width, height };
}

export function resizeCommitStyles(
  direction: ResizeHandleDirection,
  size: { width: number; height: number },
): Partial<ManualEditStyles> {
  const affectsX = DELTA_SIGN[direction].x !== 0;
  const affectsY = DELTA_SIGN[direction].y !== 0;
  const styles: Partial<ManualEditStyles> = {};
  if (affectsX) {
    styles.width = `${size.width}px`;
  }
  if (affectsY) {
    styles.height = `${size.height}px`;
  }
  return styles;
}
