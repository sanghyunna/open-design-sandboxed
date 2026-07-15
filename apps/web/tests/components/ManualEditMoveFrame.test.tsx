// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ManualEditMoveFrame } from '../../src/components/ManualEditMoveFrame';

function renderFrame(overrides: Partial<Parameters<typeof ManualEditMoveFrame>[0]> = {}) {
  const onMoveStart = vi.fn();
  const onMovePreview = vi.fn();
  const onMoveCommit = vi.fn();
  const onMoveCancel = vi.fn();
  const onAltClick = vi.fn();
  const onClick = vi.fn();
  const onSurfaceClick = vi.fn();
  const onSurfaceDoubleClick = vi.fn();
  const utils = render(
    <ManualEditMoveFrame
      rect={{ left: 100, top: 50, width: 200, height: 100 }}
      scale={1}
      mode="selected"
      interactive
      label="Move element"
      onMoveStart={onMoveStart}
      onMovePreview={onMovePreview}
      onMoveCommit={onMoveCommit}
      onMoveCancel={onMoveCancel}
      onAltClick={onAltClick}
      onClick={onClick}
      onSurfaceClick={onSurfaceClick}
      onSurfaceDoubleClick={onSurfaceDoubleClick}
      {...overrides}
    />,
  );
  const ring = utils.container.querySelector('[data-region="ring"]') as HTMLElement;
  const interior = utils.container.querySelector('[data-region="interior"]') as HTMLElement | null;
  return { ...utils, ring, interior, onMoveStart, onMovePreview, onMoveCommit, onMoveCancel, onAltClick, onClick, onSurfaceClick, onSurfaceDoubleClick };
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
  it('reports a ring click (no move) as a surface click, no move callbacks', () => {
    const { ring, onSurfaceClick, onMoveStart, onMovePreview, onMoveCommit } = renderFrame();

    fireEvent.pointerDown(ring, { pointerId: 1, clientX: 100, clientY: 50 });
    fireEvent.pointerUp(ring, { pointerId: 1, clientX: 100, clientY: 50 });

    expect(onSurfaceClick).toHaveBeenCalledWith('ring');
    expect(onMoveStart).not.toHaveBeenCalled();
    expect(onMovePreview).not.toHaveBeenCalled();
    expect(onMoveCommit).not.toHaveBeenCalled();
  });

  it('treats a sub-threshold move as a click, not a drag', () => {
    const { interior, onSurfaceClick, onMoveStart, onMoveCommit } = renderFrame();

    fireEvent.pointerDown(interior!, { pointerId: 2, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(interior!, { pointerId: 2, clientX: 202, clientY: 101 });
    fireEvent.pointerUp(interior!, { pointerId: 2, clientX: 202, clientY: 101 });

    expect(onMoveStart).not.toHaveBeenCalled();
    expect(onSurfaceClick).toHaveBeenCalledWith('interior');
    expect(onMoveCommit).not.toHaveBeenCalled();
  });

  it('reports a surface double-click without requiring interactivity', () => {
    const { interior, onSurfaceClick, onSurfaceDoubleClick } = renderFrame({ interactive: false });

    fireEvent.pointerDown(interior!, { pointerId: 9, clientX: 110, clientY: 80 });
    fireEvent.pointerUp(interior!, { pointerId: 9, clientX: 110, clientY: 80 });
    fireEvent.click(interior!);
    fireEvent.pointerDown(interior!, { pointerId: 10, clientX: 110, clientY: 80 });
    fireEvent.pointerUp(interior!, { pointerId: 10, clientX: 110, clientY: 80 });
    fireEvent.click(interior!);
    fireEvent.doubleClick(interior!);

    expect(onSurfaceDoubleClick).toHaveBeenCalledWith('interior');
    expect(onSurfaceClick).not.toHaveBeenCalled();
  });

  it('starts, previews (rect-space delta), and commits a real drag', () => {
    const { interior, onMoveStart, onMovePreview, onMoveCommit, onSurfaceClick } = renderFrame({ scale: 2 });

    fireEvent.pointerDown(interior!, { pointerId: 3, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(interior!, { pointerId: 3, clientX: 240, clientY: 160 });

    expect(onMoveStart).toHaveBeenCalledTimes(1);
    // client delta (40,60) / scale 2 -> rect-space (20,30)
    expect(onMovePreview).toHaveBeenLastCalledWith({ x: 20, y: 30 });

    fireEvent.pointerUp(interior!, { pointerId: 3, clientX: 240, clientY: 160 });

    expect(onMoveCommit).toHaveBeenCalledWith({ x: 20, y: 30 });
    expect(onSurfaceClick).not.toHaveBeenCalled();
  });

  it('keeps Alt-modified movement on the normal drag path instead of cycling', () => {
    const { interior, onMoveStart, onMovePreview, onMoveCommit, onAltClick } = renderFrame();

    fireEvent.pointerDown(interior!, { pointerId: 14, altKey: true, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(interior!, { pointerId: 14, altKey: true, clientX: 230, clientY: 140 });
    fireEvent.pointerUp(interior!, { pointerId: 14, altKey: true, clientX: 230, clientY: 140 });

    expect(onMoveStart).toHaveBeenCalledTimes(1);
    expect(onMovePreview).toHaveBeenCalledWith({ x: 30, y: 40 });
    expect(onMoveCommit).toHaveBeenCalledWith({ x: 30, y: 40 });
    expect(onAltClick).not.toHaveBeenCalled();
  });

  it('flushes a still-queued final preview frame before committing', () => {
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queued.push(cb);
      return queued.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const { interior, onMovePreview, onMoveCommit } = renderFrame();

    fireEvent.pointerDown(interior!, { pointerId: 4, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(interior!, { pointerId: 4, clientX: 230, clientY: 140 });
    expect(onMovePreview).not.toHaveBeenCalled();

    fireEvent.pointerUp(interior!, { pointerId: 4, clientX: 230, clientY: 140 });

    expect(onMovePreview).toHaveBeenCalledWith({ x: 30, y: 40 });
    expect(onMoveCommit).toHaveBeenCalledTimes(1);
    const previewOrder = onMovePreview.mock.invocationCallOrder[0] ?? 0;
    const commitOrder = onMoveCommit.mock.invocationCallOrder[0] ?? 0;
    expect(previewOrder).toBeLessThan(commitOrder);
  });

  it('cancels an active drag on Escape and swallows the key', () => {
    const { interior, onMoveCancel, onMoveCommit } = renderFrame();

    fireEvent.pointerDown(interior!, { pointerId: 5, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(interior!, { pointerId: 5, clientX: 240, clientY: 140 });
    fireEvent.keyDown(interior!, { key: 'Escape' });

    expect(onMoveCancel).toHaveBeenCalledTimes(1);
    expect(onMoveCommit).not.toHaveBeenCalled();

    // A trailing pointerup for the ended drag must not double-fire.
    fireEvent.pointerUp(interior!, { pointerId: 5, clientX: 240, clientY: 140 });
    expect(onMoveCommit).not.toHaveBeenCalled();
    expect(onMoveCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels an active drag on pointercancel', () => {
    const { interior, onMoveCancel, onMoveCommit } = renderFrame();

    fireEvent.pointerDown(interior!, { pointerId: 6, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(interior!, { pointerId: 6, clientX: 240, clientY: 140 });
    fireEvent.pointerCancel(interior!, { pointerId: 6 });

    expect(onMoveCancel).toHaveBeenCalledTimes(1);
    expect(onMoveCommit).not.toHaveBeenCalled();
  });

  it('renders an interior surface only in selected mode', () => {
    const editing = renderFrame({ mode: 'editing' });
    expect(editing.container.querySelector('[data-region="interior"]')).toBeNull();
    cleanup();

    const selected = renderFrame({ mode: 'selected' });
    expect(selected.container.querySelectorAll('[data-region="interior"]').length).toBe(1);
  });

  it('focuses the surface on pointerdown so real Escape keydown reaches it', () => {
    const { interior } = renderFrame();
    fireEvent.pointerDown(interior!, { pointerId: 7, clientX: 200, clientY: 100 });
    expect(document.activeElement).toBe(interior);
  });

  it('uses a thinner ring band in editing mode than in selected mode, so caret clicks near the text edge land on content', () => {
    const editing = renderFrame({ mode: 'editing' });
    const selected = renderFrame({ mode: 'selected' });
    const editingRing = editing.container.querySelector('[data-region="ring"]') as HTMLElement;
    const selectedRing = selected.container.querySelector('[data-region="ring"]') as HTMLElement;

    const editingBand = parseFloat(editingRing.style.height);
    const selectedBand = parseFloat(selectedRing.style.height);

    expect(selectedBand).toBe(10);
    expect(editingBand).toBeLessThan(selectedBand);
  });

  it('forwards a non-interactive interior click for z-stack cycling, but still reports a ring click', () => {
    vi.useFakeTimers();
    const { interior, ring, onClick, onSurfaceClick } = renderFrame({ interactive: false });

    fireEvent.pointerDown(interior!, { pointerId: 8, clientX: 200, clientY: 100 });
    fireEvent.pointerUp(interior!, { pointerId: 8, clientX: 200, clientY: 100 });
    expect(onClick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(350);
    expect(onClick).toHaveBeenCalledWith({ clientX: 200, clientY: 100 });
    expect(onSurfaceClick).not.toHaveBeenCalled();

    fireEvent.pointerDown(ring, { pointerId: 9, clientX: 100, clientY: 50 });
    fireEvent.pointerUp(ring, { pointerId: 9, clientX: 100, clientY: 50 });
    expect(onSurfaceClick).toHaveBeenCalledWith('ring');

    vi.useRealTimers();
  });

  it('does not forward a non-interactive interior click that is part of a double-click', () => {
    vi.useFakeTimers();
    const { interior, onClick, onSurfaceDoubleClick } = renderFrame({ interactive: false });

    fireEvent.pointerDown(interior!, { pointerId: 8, clientX: 200, clientY: 100 });
    fireEvent.pointerUp(interior!, { pointerId: 8, clientX: 200, clientY: 100 });
    fireEvent.click(interior!);
    fireEvent.pointerDown(interior!, { pointerId: 9, clientX: 200, clientY: 100 });
    fireEvent.pointerUp(interior!, { pointerId: 9, clientX: 200, clientY: 100 });
    fireEvent.click(interior!);
    fireEvent.doubleClick(interior!);

    expect(onClick).not.toHaveBeenCalled();
    expect(onSurfaceDoubleClick).toHaveBeenCalledWith('interior');

    vi.advanceTimersByTime(350);
    expect(onClick).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
