import { moveCssCommitStyles } from './resize-geometry';
import type { ManualEditRect, ManualEditStyles } from './types';

export type ManualEditMovementSource = 'pointer' | 'keyboard';
export type ManualEditMovementAxis = 'x' | 'y';
export type ManualEditMovementConstraint = Readonly<{
  shiftKey: boolean;
  axis: ManualEditMovementAxis | null;
}>;

export function selectManualEditMovementAxis(
  rawDelta: Readonly<{ x: number; y: number }>,
): ManualEditMovementAxis {
  return Math.abs(rawDelta.x) >= Math.abs(rawDelta.y) ? 'x' : 'y';
}

export type ManualEditMovementSession = Readonly<{
  targetId: string;
  source: ManualEditMovementSource;
  startRect: Readonly<ManualEditRect>;
  baselineTranslate: string | undefined;
  rectScale?: Readonly<{ x: number; y: number }>;
}>;

export type ManualEditMovementResult = Readonly<{
  targetId: string;
  axisConstraint: ManualEditMovementAxis | null;
  rawDelta: Readonly<{ x: number; y: number }>;
  appliedDelta: Readonly<{ x: number; y: number }>;
  translatedRect: Readonly<ManualEditRect>;
  styles: Readonly<Pick<ManualEditStyles, 'translate'>>;
}>;

export function resolveManualEditMovement(
  session: ManualEditMovementSession,
  absoluteRawDelta: Readonly<{ x: number; y: number }>,
  constraint: ManualEditMovementConstraint = { shiftKey: false, axis: null },
): ManualEditMovementResult {
  const rawDelta = { x: absoluteRawDelta.x, y: absoluteRawDelta.y };
  const axisConstraint = constraint.shiftKey
    ? constraint.axis ?? selectManualEditMovementAxis(rawDelta)
    : null;
  const appliedDelta = axisConstraint === 'x'
    ? { x: rawDelta.x, y: 0 }
    : axisConstraint === 'y'
      ? { x: 0, y: rawDelta.y }
      : { ...rawDelta };
  const styles = moveCssCommitStyles({
    deltaRect: appliedDelta,
    baseTranslate: session.baselineTranslate,
    rectScale: session.rectScale,
  });

  return {
    targetId: session.targetId,
    axisConstraint,
    rawDelta,
    appliedDelta,
    translatedRect: {
      x: session.startRect.x + appliedDelta.x,
      y: session.startRect.y + appliedDelta.y,
      width: session.startRect.width,
      height: session.startRect.height,
    },
    styles,
  };
}
