import { describe, expect, it } from 'vitest';
import {
  RESIZE_HANDLE_DIRECTIONS,
  resizeCommitStyles,
  resizeDragSize,
  resizeHandlePositions,
} from '../../src/edit-mode/resize-geometry';

describe('resizeHandlePositions', () => {
  it('places all 8 handle centers around the rect', () => {
    const rect = { left: 100, top: 200, width: 40, height: 20 };
    const positions = resizeHandlePositions(rect);

    expect(positions.nw).toEqual({ left: 100, top: 200 });
    expect(positions.n).toEqual({ left: 120, top: 200 });
    expect(positions.ne).toEqual({ left: 140, top: 200 });
    expect(positions.e).toEqual({ left: 140, top: 210 });
    expect(positions.se).toEqual({ left: 140, top: 220 });
    expect(positions.s).toEqual({ left: 120, top: 220 });
    expect(positions.sw).toEqual({ left: 100, top: 220 });
    expect(positions.w).toEqual({ left: 100, top: 210 });

    expect(RESIZE_HANDLE_DIRECTIONS).toHaveLength(8);
  });

  it('keeps all 8 handle centers distinct for a zero-sized element', () => {
    const positions = resizeHandlePositions({ left: 10, top: 20, width: 0, height: 0 });
    const seen = new Set(RESIZE_HANDLE_DIRECTIONS.map((d) => `${positions[d].left},${positions[d].top}`));
    expect(seen.size).toBe(8);
  });
});

describe('resizeDragSize', () => {
  const base = { startWidth: 100, startHeight: 50, scale: 1, lockAspect: false };

  it('e: positive deltaX grows width, height unchanged', () => {
    const { width, height } = resizeDragSize({ ...base, direction: 'e', deltaX: 20, deltaY: 0 });
    expect(width).toBe(120);
    expect(height).toBe(50);
  });

  it('w: negative deltaX grows width (inverted)', () => {
    const { width } = resizeDragSize({ ...base, direction: 'w', deltaX: -20, deltaY: 0 });
    expect(width).toBe(120);
  });

  it('w: positive deltaX shrinks width', () => {
    const { width } = resizeDragSize({ ...base, direction: 'w', deltaX: 20, deltaY: 0 });
    expect(width).toBe(80);
  });

  it('s: positive deltaY grows height', () => {
    const { height } = resizeDragSize({ ...base, direction: 's', deltaX: 0, deltaY: 20 });
    expect(height).toBe(70);
  });

  it('n: negative deltaY grows height (inverted)', () => {
    const { height } = resizeDragSize({ ...base, direction: 'n', deltaX: 0, deltaY: -20 });
    expect(height).toBe(70);
  });

  it('n: positive deltaY shrinks height', () => {
    const { height } = resizeDragSize({ ...base, direction: 'n', deltaX: 0, deltaY: 20 });
    expect(height).toBe(30);
  });

  it('corners combine both axes with correct signs: ne (+dx,-dy)', () => {
    const { width, height } = resizeDragSize({ ...base, direction: 'ne', deltaX: 10, deltaY: -10 });
    expect(width).toBe(110);
    expect(height).toBe(60);
  });

  it('corners combine both axes with correct signs: nw (-dx,-dy)', () => {
    const { width, height } = resizeDragSize({ ...base, direction: 'nw', deltaX: -10, deltaY: -10 });
    expect(width).toBe(110);
    expect(height).toBe(60);
  });

  it('corners combine both axes with correct signs: se (+dx,+dy)', () => {
    const { width, height } = resizeDragSize({ ...base, direction: 'se', deltaX: 10, deltaY: 10 });
    expect(width).toBe(110);
    expect(height).toBe(60);
  });

  it('corners combine both axes with correct signs: sw (-dx,+dy)', () => {
    const { width, height } = resizeDragSize({ ...base, direction: 'sw', deltaX: -10, deltaY: 10 });
    expect(width).toBe(110);
    expect(height).toBe(60);
  });

  it('divides host delta by scale', () => {
    const { width } = resizeDragSize({ ...base, direction: 'e', deltaX: 40, deltaY: 0, scale: 2 });
    expect(width).toBe(120);
  });

  it('treats scale<=0 as scale 1', () => {
    const { width } = resizeDragSize({ ...base, direction: 'e', deltaX: 20, deltaY: 0, scale: 0 });
    expect(width).toBe(120);
    const negScale = resizeDragSize({ ...base, direction: 'e', deltaX: 20, deltaY: 0, scale: -3 });
    expect(negScale.width).toBe(120);
  });

  it('clamps to a minimum of 8px', () => {
    const { width } = resizeDragSize({ ...base, direction: 'e', deltaX: -1000, deltaY: 0 });
    expect(width).toBe(8);
    const { height } = resizeDragSize({ ...base, direction: 's', deltaX: 0, deltaY: -1000 });
    expect(height).toBe(8);
  });

  it('rounds to the nearest integer', () => {
    const { width } = resizeDragSize({ ...base, direction: 'e', deltaX: 10.6, deltaY: 0 });
    expect(width).toBe(111);
  });

  it('does not lock aspect on edge handles even if requested', () => {
    const { width, height } = resizeDragSize({
      ...base, direction: 'e', deltaX: 50, deltaY: 0, lockAspect: true,
    });
    expect(width).toBe(150);
    expect(height).toBe(50);
  });

  it('locks aspect on corners: dominant axis (larger scaled delta) drives the other', () => {
    // startWidth 100, startHeight 50, ratio 2. deltaX dominant -> width=130, height=width/ratio=65
    const { width, height } = resizeDragSize({
      ...base, direction: 'se', deltaX: 30, deltaY: 5, lockAspect: true,
    });
    expect(width).toBe(130);
    expect(height).toBe(65);
  });

  it('locks aspect on corners: when deltaY dominant, width follows height', () => {
    // startWidth 100, startHeight 50, ratio 2. deltaY dominant -> height=80, width=height*ratio=160
    const { width, height } = resizeDragSize({
      ...base, direction: 'se', deltaX: 5, deltaY: 30, lockAspect: true,
    });
    expect(height).toBe(80);
    expect(width).toBe(160);
  });
});

describe('resizeCommitStyles', () => {
  it('e/w commit width only', () => {
    expect(resizeCommitStyles('e', { width: 120, height: 50 })).toEqual({ width: '120px' });
    expect(resizeCommitStyles('w', { width: 120, height: 50 })).toEqual({ width: '120px' });
  });

  it('n/s commit height only', () => {
    expect(resizeCommitStyles('n', { width: 120, height: 50 })).toEqual({ height: '50px' });
    expect(resizeCommitStyles('s', { width: 120, height: 50 })).toEqual({ height: '50px' });
  });

  it('corners commit both width and height', () => {
    for (const direction of ['nw', 'ne', 'se', 'sw'] as const) {
      expect(resizeCommitStyles(direction, { width: 120, height: 50 })).toEqual({
        width: '120px',
        height: '50px',
      });
    }
  });
});
