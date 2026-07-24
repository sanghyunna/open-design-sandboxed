import { describe, expect, it } from 'vitest';
import {
  type ManualEditMovementSession,
  resolveManualEditMovement,
} from '../../src/edit-mode/movement-session';
import { moveCssCommitStyles } from '../../src/edit-mode/resize-geometry';

function session(
  overrides: Partial<ManualEditMovementSession> = {},
): ManualEditMovementSession {
  return {
    targetId: 'target-1',
    source: 'pointer',
    startRect: { x: 100, y: 200, width: 300, height: 150 },
    baselineTranslate: undefined,
    ...overrides,
  };
}

describe('resolveManualEditMovement', () => {
  it('copies identity and absolute delta into independent result values', () => {
    const rawDelta = { x: 12, y: -8 };
    const result = resolveManualEditMovement(session({ targetId: 'copy-me' }), rawDelta);

    rawDelta.x = 999;
    rawDelta.y = 999;

    expect(result.targetId).toBe('copy-me');
    expect(result.rawDelta).toEqual({ x: 12, y: -8 });
    expect(result.appliedDelta).toEqual(result.rawDelta);
    expect(result.rawDelta).not.toBe(result.appliedDelta);
    expect(result.translatedRect).toEqual({
      x: 112,
      y: 192,
      width: 300,
      height: 150,
    });
  });

  it('does not mutate the session or input', () => {
    const movement = Object.freeze({
      targetId: 'frozen',
      source: 'pointer' as const,
      startRect: Object.freeze({ x: 1, y: 2, width: 3, height: 4 }),
      baselineTranslate: '5px 6px',
      rectScale: Object.freeze({ x: 2, y: 3 }),
    });
    const rawDelta = Object.freeze({ x: 7, y: 8 });

    expect(() => resolveManualEditMovement(movement, rawDelta)).not.toThrow();
    expect(movement).toEqual({
      targetId: 'frozen',
      source: 'pointer',
      startRect: { x: 1, y: 2, width: 3, height: 4 },
      baselineTranslate: '5px 6px',
      rectScale: { x: 2, y: 3 },
    });
    expect(rawDelta).toEqual({ x: 7, y: 8 });
  });

  it('is deterministic and treats each call as absolute from the session start', () => {
    const movement = session({ baselineTranslate: '10px 20px' });
    const first = resolveManualEditMovement(movement, { x: 5, y: 6 });
    const repeated = resolveManualEditMovement(movement, { x: 5, y: 6 });
    const later = resolveManualEditMovement(movement, { x: 7, y: 9 });

    expect(repeated).toEqual(first);
    expect(later.styles).toEqual({ translate: '17px 29px' });
    expect(later.translatedRect).toMatchObject({ x: 107, y: 209 });
  });

  it('does not branch movement behavior on pointer versus keyboard source', () => {
    const pointer = resolveManualEditMovement(session({ source: 'pointer' }), { x: 3, y: -4 });
    const keyboard = resolveManualEditMovement(session({ source: 'keyboard' }), { x: 3, y: -4 });

    expect(keyboard).toEqual(pointer);
  });

  it.each([
    ['undefined', undefined, '2px -3px'],
    ['empty', '', '2px -3px'],
    ['exact none', 'none', '2px -3px'],
    ['one axis', '10px', '12px -3px'],
    ['two axes', '10px 20px', '12px 17px'],
    ['negative', '-10px -20px', '-8px -23px'],
    ['fractional', '10.5px 20.5px', '13px 18px'],
    ['unsupported axes', '10% auto', '2px -3px'],
  ])('preserves %s baseline serialization', (_label, baselineTranslate, translate) => {
    expect(resolveManualEditMovement(
      session({ baselineTranslate }),
      { x: 2, y: -3 },
    ).styles).toEqual({ translate });
  });

  it.each([
    ['missing', undefined, { x: 8, y: 9 }, '8px 9px'],
    ['zero', { x: 0, y: 0 }, { x: 8, y: 9 }, '8px 9px'],
    ['negative', { x: -2, y: -3 }, { x: 8, y: 9 }, '8px 9px'],
    ['NaN', { x: Number.NaN, y: Number.NaN }, { x: 8, y: 9 }, '8px 9px'],
    ['infinite', { x: Number.POSITIVE_INFINITY, y: Number.NEGATIVE_INFINITY }, { x: 8, y: 9 }, '8px 9px'],
    ['uniform', { x: 2, y: 2 }, { x: 8, y: 10 }, '4px 5px'],
    ['non-uniform', { x: 2, y: 3 }, { x: 8, y: 9 }, '4px 3px'],
  ])('preserves %s rect-scale handling', (_label, rectScale, rawDelta, translate) => {
    expect(resolveManualEditMovement(
      session({ rectScale }),
      rawDelta,
    ).styles).toEqual({ translate });
  });

  it('preserves positive and negative half-rounding asymmetry', () => {
    expect(resolveManualEditMovement(session(), { x: 0.5, y: 0 }).styles).toEqual({
      translate: '1px 0px',
    });
    expect(resolveManualEditMovement(session(), { x: -0.5, y: 0 }).styles).toEqual({
      translate: '',
    });
  });

  it('normalizes zero and exact cancellation to an empty translation', () => {
    expect(resolveManualEditMovement(session(), { x: 0, y: 0 }).styles).toEqual({
      translate: '',
    });
    expect(resolveManualEditMovement(
      session({ baselineTranslate: '10px -4px' }),
      { x: -10, y: 4 },
    ).styles).toEqual({ translate: '' });
  });

  it('keeps translatedRect as unquantized intent geometry', () => {
    const result = resolveManualEditMovement(
      session({
        startRect: { x: 20, y: 30, width: 40, height: 50 },
        rectScale: { x: 2, y: 2 },
      }),
      { x: 1, y: 0 },
    );

    expect(result.translatedRect).toEqual({ x: 21, y: 30, width: 40, height: 50 });
    expect(result.styles).toEqual({ translate: '1px 0px' });
  });

  it('returns exactly the authoritative movement serializer styles', () => {
    const movement = session({
      baselineTranslate: '-3.5px 7px',
      rectScale: { x: 1.25, y: 2 },
    });
    const rawDelta = { x: 11, y: -5 };

    expect(resolveManualEditMovement(movement, rawDelta).styles).toEqual(
      moveCssCommitStyles({
        deltaRect: rawDelta,
        baseTranslate: movement.baselineTranslate,
        rectScale: movement.rectScale,
      }),
    );
  });
});
