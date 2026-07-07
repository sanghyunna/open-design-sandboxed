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

const PX_VALUE = /^(-?\d+(?:\.\d+)?)px$/;

function parsePx(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = PX_VALUE.exec(value.trim());
  if (!match?.[1]) return undefined;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cssAxisPx(
  size: number,
  startSize: number,
  base: string | undefined,
  scale: number | undefined,
): string {
  const k = typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
  const baseCss = parsePx(base);
  // Applying the drag as a delta on the element's current CSS size keeps
  // box-sizing out of the math: padding/border constants cancel in the delta.
  const value = baseCss !== undefined ? baseCss + (size - startSize) / k : size / k;
  return `${Math.max(1, Math.round(value))}px`;
}

/**
 * Convert a drag result from rect space (getBoundingClientRect px, which
 * ancestor CSS transforms — e.g. a deck's fit-to-canvas scale — inflate by
 * rectScale) into the CSS width/height property space the inspector shows and
 * the source file stores. Per-axis: edge handles commit one axis, corners both.
 */
export function resizeCssCommitStyles(args: {
  direction: ResizeHandleDirection;
  size: { width: number; height: number };
  startSize: { width: number; height: number };
  baseStyles?: { width?: string; height?: string };
  rectScale?: { x: number; y: number };
  flexItemAxis?: 'row' | 'column' | null;
}): Partial<ManualEditStyles> {
  const { direction, size, startSize, baseStyles, rectScale, flexItemAxis } = args;
  const styles: Partial<ManualEditStyles> = {};
  if (DELTA_SIGN[direction].x !== 0) {
    styles.width = cssAxisPx(size.width, startSize.width, baseStyles?.width, rectScale?.x);
  }
  if (DELTA_SIGN[direction].y !== 0) {
    styles.height = cssAxisPx(size.height, startSize.height, baseStyles?.height, rectScale?.y);
  }
  // A main-axis size on a flex item is only a suggestion: flex-grow/shrink win
  // and the drag result silently snaps back. Pin the item (flex: none — the
  // Figma "fill → fixed" semantic) so the written size actually holds. Cross
  // axis needs no pin: an explicit size already beats align-items stretch.
  if (
    (flexItemAxis === 'row' && styles.width !== undefined) ||
    (flexItemAxis === 'column' && styles.height !== undefined)
  ) {
    styles.flex = 'none';
  }
  return styles;
}
