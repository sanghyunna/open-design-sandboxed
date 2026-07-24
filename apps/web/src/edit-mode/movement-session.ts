import { moveCssCommitStyles } from './resize-geometry';
import type { ManualEditRect, ManualEditStyles } from './types';

export type ManualEditMovementSource = 'pointer' | 'keyboard';

export type ManualEditMovementSession = Readonly<{
  targetId: string;
  source: ManualEditMovementSource;
  startRect: Readonly<ManualEditRect>;
  baselineTranslate: string | undefined;
  rectScale?: Readonly<{ x: number; y: number }>;
}>;

export type ManualEditMovementResult = Readonly<{
  targetId: string;
  rawDelta: Readonly<{ x: number; y: number }>;
  appliedDelta: Readonly<{ x: number; y: number }>;
  translatedRect: Readonly<ManualEditRect>;
  styles: Readonly<Pick<ManualEditStyles, 'translate'>>;
}>;

export function resolveManualEditMovement(
  session: ManualEditMovementSession,
  absoluteRawDelta: Readonly<{ x: number; y: number }>,
): ManualEditMovementResult {
  const rawDelta = { x: absoluteRawDelta.x, y: absoluteRawDelta.y };
  const appliedDelta = { ...rawDelta };
  const styles = moveCssCommitStyles({
    deltaRect: appliedDelta,
    baseTranslate: session.baselineTranslate,
    rectScale: session.rectScale,
  });

  return {
    targetId: session.targetId,
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
