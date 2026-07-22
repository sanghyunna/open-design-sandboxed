// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualEditMoveFrame } from '../../src/components/ManualEditMoveFrame';

function renderFrame(overrides: Partial<Parameters<typeof ManualEditMoveFrame>[0]> = {}) {
  const callbacks = {
    onMoveStart: vi.fn(),
    onMovePreview: vi.fn(),
    onMoveCommit: vi.fn(),
    onMoveCancel: vi.fn(),
    onPressStart: vi.fn(),
    onActivate: vi.fn(),
    onSurfaceDoubleClick: vi.fn(),
  };
  const utils = render(
    <ManualEditMoveFrame
      rect={{ left: 100, top: 50, width: 200, height: 100 }}
      scale={1}
      mode="selected"
      label="Move element"
      selectBehindHint="Select behind"
      {...callbacks}
      {...overrides}
    />,
  );
  return {
    ...utils,
    ...callbacks,
    ring: utils.container.querySelector('[data-region="ring"]') as HTMLElement,
    interior: utils.container.querySelector('[data-region="interior"]') as HTMLElement | null,
  };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ManualEditMoveFrame', () => {
  it('reports press start and unified ring activation coordinates', () => {
    const { ring, onPressStart, onActivate, onMoveStart } = renderFrame();
    fireEvent.pointerDown(ring, { pointerId: 1, clientX: 100, clientY: 50 });
    fireEvent.pointerUp(ring, { pointerId: 1, clientX: 101, clientY: 52 });

    expect(onPressStart).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith({ region: 'ring', clientX: 101, clientY: 52, altKey: false });
    expect(onMoveStart).not.toHaveBeenCalled();
  });

  it('keeps a 4px by 4px movement as an immediate activation', () => {
    const { interior, onActivate, onMoveStart, onMoveCommit } = renderFrame();
    fireEvent.pointerDown(interior!, { pointerId: 2, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(interior!, { pointerId: 2, clientX: 204, clientY: 104 });
    fireEvent.pointerUp(interior!, { pointerId: 2, clientX: 204, clientY: 104 });

    expect(onMoveStart).not.toHaveBeenCalled();
    expect(onMoveCommit).not.toHaveBeenCalled();
    expect(onActivate).toHaveBeenCalledWith({ region: 'interior', clientX: 204, clientY: 104, altKey: false });
  });

  it.each([
    [5, 0],
    [0, 5],
  ])('starts a drag at a %ipx by %ipx movement', (dx, dy) => {
    const { interior, onActivate, onMoveStart, onMoveCommit } = renderFrame();
    fireEvent.pointerDown(interior!, { pointerId: 3, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(interior!, { pointerId: 3, clientX: 200 + dx, clientY: 100 + dy });
    fireEvent.pointerUp(interior!, { pointerId: 3, clientX: 200 + dx, clientY: 100 + dy });

    expect(onMoveStart).toHaveBeenCalledTimes(1);
    expect(onMoveCommit).toHaveBeenCalledWith({ x: dx, y: dy });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('reports Alt on a no-drag activation but keeps Alt-modified movement on the drag path', () => {
    const first = renderFrame();
    fireEvent.pointerDown(first.interior!, { pointerId: 4, clientX: 200, clientY: 100, altKey: true });
    fireEvent.pointerUp(first.interior!, { pointerId: 4, clientX: 200, clientY: 100, altKey: true });
    expect(first.onActivate).toHaveBeenCalledWith(expect.objectContaining({ altKey: true }));
    cleanup();

    const second = renderFrame();
    fireEvent.pointerDown(second.interior!, { pointerId: 5, clientX: 200, clientY: 100, altKey: true });
    fireEvent.pointerMove(second.interior!, { pointerId: 5, clientX: 230, clientY: 140, altKey: true });
    fireEvent.pointerUp(second.interior!, { pointerId: 5, clientX: 230, clientY: 140, altKey: true });
    expect(second.onMoveCommit).toHaveBeenCalledWith({ x: 30, y: 40 });
    expect(second.onActivate).not.toHaveBeenCalled();
  });

  it('scales preview and commit deltas and flushes the final queued preview first', () => {
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queued.push(cb);
      return queued.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const { interior, onMovePreview, onMoveCommit } = renderFrame({ scale: 2 });
    fireEvent.pointerDown(interior!, { pointerId: 6, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(interior!, { pointerId: 6, clientX: 240, clientY: 160 });
    fireEvent.pointerUp(interior!, { pointerId: 6, clientX: 240, clientY: 160 });

    expect(onMovePreview).toHaveBeenCalledWith({ x: 20, y: 30 });
    expect(onMoveCommit).toHaveBeenCalledWith({ x: 20, y: 30 });
    expect(onMovePreview.mock.invocationCallOrder[0]).toBeLessThan(onMoveCommit.mock.invocationCallOrder[0]!);
  });

  it.each(['Escape', 'pointercancel'])('cancels an active drag on %s', (ending) => {
    const { interior, onMoveCancel, onMoveCommit, onActivate } = renderFrame();
    fireEvent.pointerDown(interior!, { pointerId: 7, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(interior!, { pointerId: 7, clientX: 220, clientY: 120 });
    if (ending === 'Escape') fireEvent.keyDown(interior!, { key: 'Escape' });
    else fireEvent.pointerCancel(interior!, { pointerId: 7 });
    fireEvent.pointerUp(interior!, { pointerId: 7, clientX: 220, clientY: 120 });

    expect(onMoveCancel).toHaveBeenCalledTimes(1);
    expect(onMoveCommit).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('preserves double-click reporting and selected/editing surface shapes', () => {
    const selected = renderFrame();
    fireEvent.doubleClick(selected.interior!);
    expect(selected.onSurfaceDoubleClick).toHaveBeenCalledWith('interior');
    expect(selected.interior).not.toBeNull();
    const selectedBand = parseFloat(selected.ring.style.height);
    cleanup();

    const editing = renderFrame({ mode: 'editing' });
    expect(editing.container.querySelector('[data-region="interior"]')).toBeNull();
    expect(parseFloat(editing.ring.style.height)).toBeLessThan(selectedBand);
  });

  it('focuses the pressed surface so Escape reaches the frame', () => {
    const { interior } = renderFrame();
    fireEvent.pointerDown(interior!, { pointerId: 8, clientX: 200, clientY: 100 });
    expect(document.activeElement).toBe(interior);
  });
});
