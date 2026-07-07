import { describe, expect, it } from 'vitest';
import {
  RESIZE_HANDLE_DIRECTIONS,
  resizeCssCommitStyles,
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

describe('resizeCssCommitStyles', () => {
  const identity = {
    size: { width: 120, height: 50 },
    startSize: { width: 120, height: 50 },
  };

  it('e/w commit width only', () => {
    expect(resizeCssCommitStyles({ direction: 'e', ...identity })).toEqual({ width: '120px' });
    expect(resizeCssCommitStyles({ direction: 'w', ...identity })).toEqual({ width: '120px' });
  });

  it('n/s commit height only', () => {
    expect(resizeCssCommitStyles({ direction: 'n', ...identity })).toEqual({ height: '50px' });
    expect(resizeCssCommitStyles({ direction: 's', ...identity })).toEqual({ height: '50px' });
  });

  it('corners commit both width and height', () => {
    for (const direction of ['nw', 'ne', 'se', 'sw'] as const) {
      expect(resizeCssCommitStyles({ direction, ...identity })).toEqual({
        width: '120px',
        height: '50px',
      });
    }
  });

  it('applies the drag delta to the CSS base size divided by rectScale', () => {
    // rect 500x100 under a 1.25x ancestor transform; CSS box 400x80.
    // +40/+20 rect px is +32/+16 CSS px.
    expect(resizeCssCommitStyles({
      direction: 'se',
      size: { width: 540, height: 120 },
      startSize: { width: 500, height: 100 },
      baseStyles: { width: '400px', height: '80px' },
      rectScale: { x: 1.25, y: 1.25 },
    })).toEqual({ width: '432px', height: '96px' });
  });

  it('keeps box-sizing padding out of the committed value via the delta form', () => {
    // content-box: CSS width 400 renders as a 440px rect (padding 2x20), no
    // transform. Dragging +40 must write 440, not the raw rect width 480.
    expect(resizeCssCommitStyles({
      direction: 'e',
      size: { width: 480, height: 100 },
      startSize: { width: 440, height: 100 },
      baseStyles: { width: '400px' },
      rectScale: { x: 1, y: 1 },
    })).toEqual({ width: '440px' });
  });

  it('falls back to rect size divided by rectScale when the CSS base is not px', () => {
    expect(resizeCssCommitStyles({
      direction: 'e',
      size: { width: 540, height: 100 },
      startSize: { width: 500, height: 100 },
      baseStyles: { width: 'auto' },
      rectScale: { x: 1.25, y: 1.25 },
    })).toEqual({ width: '432px' });
  });

  it('treats missing or degenerate rectScale as 1 and clamps to at least 1px', () => {
    expect(resizeCssCommitStyles({
      direction: 'e',
      size: { width: 540, height: 100 },
      startSize: { width: 500, height: 100 },
      baseStyles: { width: '400px' },
      rectScale: { x: 0, y: Number.NaN },
    })).toEqual({ width: '440px' });
    expect(resizeCssCommitStyles({
      direction: 'e',
      size: { width: 8, height: 100 },
      startSize: { width: 500, height: 100 },
      baseStyles: { width: '2px' },
    })).toEqual({ width: '1px' });
  });
});

describe('resizeCssCommitStyles flex pinning', () => {
  const drag = {
    size: { width: 250, height: 120 },
    startSize: { width: 200, height: 100 },
    baseStyles: { width: '200px', height: '100px' },
  };

  it('pins flex on a main-axis width commit for flex-row items', () => {
    // A bare width on a flex-row item is a suggestion: flex-grow/shrink win.
    // The commit must also detach the item (flex: none) or the drag result
    // silently snaps back to whatever the flex algorithm decides.
    const styles = resizeCssCommitStyles({ ...drag, direction: 'e', flexItemAxis: 'row' });
    expect(styles.width).toBe('250px');
    expect(styles.height).toBeUndefined();
    expect(styles.flex).toBe('none');
  });

  it('does not pin flex on a cross-axis commit', () => {
    // Height on a flex-row item is the cross axis: an explicit height already
    // wins over align-items stretch, no pinning needed.
    const styles = resizeCssCommitStyles({ ...drag, direction: 's', flexItemAxis: 'row' });
    expect(styles.height).toBe('120px');
    expect(styles.width).toBeUndefined();
    expect(styles.flex).toBeUndefined();
  });

  it('pins flex on a main-axis height commit for flex-column items', () => {
    const styles = resizeCssCommitStyles({ ...drag, direction: 's', flexItemAxis: 'column' });
    expect(styles.height).toBe('120px');
    expect(styles.flex).toBe('none');
  });

  it('pins flex on corner commits for flex items', () => {
    const styles = resizeCssCommitStyles({ ...drag, direction: 'se', flexItemAxis: 'row' });
    expect(styles.width).toBe('250px');
    expect(styles.height).toBe('120px');
    expect(styles.flex).toBe('none');
  });

  it('leaves non-flex items unpinned', () => {
    const styles = resizeCssCommitStyles({ ...drag, direction: 'se' });
    expect(styles.flex).toBeUndefined();
    const nullAxis = resizeCssCommitStyles({ ...drag, direction: 'e', flexItemAxis: null });
    expect(nullAxis.flex).toBeUndefined();
  });
});
