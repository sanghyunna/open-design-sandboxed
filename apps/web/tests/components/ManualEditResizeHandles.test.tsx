// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ManualEditResizeHandles } from '../../src/components/ManualEditResizeHandles';
import type { ResizeHandleDirection } from '../../src/edit-mode/resize-geometry';

const labels: Record<ResizeHandleDirection, string> = {
  nw: 'Resize northwest',
  n: 'Resize north',
  ne: 'Resize northeast',
  e: 'Resize east',
  se: 'Resize southeast',
  s: 'Resize south',
  sw: 'Resize southwest',
  w: 'Resize west',
};

function renderHandles(overrides: Partial<Parameters<typeof ManualEditResizeHandles>[0]> = {}) {
  const onResizePreview = vi.fn();
  const onResizeCommit = vi.fn();
  const onResizeCancel = vi.fn();
  const utils = render(
    <ManualEditResizeHandles
      rect={{ left: 100, top: 50, width: 200, height: 100 }}
      startSize={{ width: 200, height: 100 }}
      scale={1}
      labels={labels}
      onResizePreview={onResizePreview}
      onResizeCommit={onResizeCommit}
      onResizeCancel={onResizeCancel}
      {...overrides}
    />,
  );
  return { ...utils, onResizePreview, onResizeCommit, onResizeCancel };
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

describe('ManualEditResizeHandles', () => {
  it('renders 8 handles with direction-scoped aria labels', () => {
    const { getByLabelText } = renderHandles();
    for (const direction of Object.keys(labels) as ResizeHandleDirection[]) {
      const handle = getByLabelText(labels[direction]);
      expect(handle.getAttribute('data-direction')).toBe(direction);
      expect(handle.tagName).toBe('BUTTON');
      expect(handle.getAttribute('tabindex')).toBe('-1');
    }
  });

  it('streams a live preview while dragging the SE handle', () => {
    const { getByLabelText, onResizePreview } = renderHandles();
    const se = getByLabelText(labels.se);

    fireEvent.pointerDown(se, { pointerId: 1, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(se, { pointerId: 1, clientX: 340, clientY: 170 });

    expect(onResizePreview).toHaveBeenCalledWith(
      'se',
      { width: 240, height: 120 },
      { width: 200, height: 100 },
    );
  });

  it('commits per-axis styles on pointerup after real movement', () => {
    const { getByLabelText, onResizeCommit, onResizeCancel } = renderHandles();
    const e = getByLabelText(labels.e);

    fireEvent.pointerDown(e, { pointerId: 2, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(e, { pointerId: 2, clientX: 350, clientY: 150 });
    fireEvent.pointerUp(e, { pointerId: 2, clientX: 350, clientY: 150 });

    expect(onResizeCommit).toHaveBeenCalledWith(
      'e',
      { width: 250, height: 100 },
      { width: 200, height: 100 },
    );
    expect(onResizeCancel).not.toHaveBeenCalled();
  });

  it('cancels instead of committing when pointerup happens with no movement', () => {
    const { getByLabelText, onResizeCommit, onResizeCancel } = renderHandles();
    const s = getByLabelText(labels.s);

    fireEvent.pointerDown(s, { pointerId: 3, clientX: 200, clientY: 150 });
    fireEvent.pointerUp(s, { pointerId: 3, clientX: 200, clientY: 150 });

    expect(onResizeCommit).not.toHaveBeenCalled();
    expect(onResizeCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on pointercancel', () => {
    const { getByLabelText, onResizeCommit, onResizeCancel } = renderHandles();
    const nw = getByLabelText(labels.nw);

    fireEvent.pointerDown(nw, { pointerId: 4, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(nw, { pointerId: 4, clientX: 60, clientY: 20 });
    fireEvent.pointerCancel(nw, { pointerId: 4 });

    expect(onResizeCommit).not.toHaveBeenCalled();
    expect(onResizeCancel).toHaveBeenCalled();
  });

  it('cancels an active drag on Escape and swallows the key', () => {
    const { getByLabelText, onResizeCommit, onResizeCancel } = renderHandles();
    const se = getByLabelText(labels.se);

    fireEvent.pointerDown(se, { pointerId: 5, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(se, { pointerId: 5, clientX: 340, clientY: 170 });
    fireEvent.keyDown(se, { key: 'Escape' });

    expect(onResizeCommit).not.toHaveBeenCalled();
    expect(onResizeCancel).toHaveBeenCalledTimes(1);

    // A further pointerup for the (now-ended) drag must not double-fire cancel/commit.
    fireEvent.pointerUp(se, { pointerId: 5, clientX: 340, clientY: 170 });
    expect(onResizeCommit).not.toHaveBeenCalled();
    expect(onResizeCancel).toHaveBeenCalledTimes(1);
  });

  it('focuses the handle on pointerdown so real Escape keydown reaches it', () => {
    const { getByLabelText } = renderHandles();
    const se = getByLabelText(labels.se);

    fireEvent.pointerDown(se, { pointerId: 8, clientX: 300, clientY: 150 });

    expect(document.activeElement).toBe(se);
  });

  it('keeps the pointerdown baseline when the startSize prop changes mid-drag', () => {
    const { getByLabelText, rerender, onResizePreview } = renderHandles();
    const se = getByLabelText(labels.se);

    fireEvent.pointerDown(se, { pointerId: 9, clientX: 300, clientY: 150 });
    // Simulate a mid-drag rect re-broadcast changing the live prop.
    rerender(
      <ManualEditResizeHandles
        rect={{ left: 100, top: 50, width: 400, height: 300 }}
        startSize={{ width: 400, height: 300 }}
        scale={1}
        labels={labels}
        onResizePreview={onResizePreview}
        onResizeCommit={vi.fn()}
        onResizeCancel={vi.fn()}
      />,
    );
    fireEvent.pointerMove(se, { pointerId: 9, clientX: 340, clientY: 170 });

    // Delta (40,20) applied to the snapshot 200x100, not the changed 400x300 prop.
    expect(onResizePreview).toHaveBeenLastCalledWith(
      'se',
      { width: 240, height: 120 },
      { width: 200, height: 100 },
    );
  });

  it('locks aspect ratio on a corner drag when shift is held', () => {
    const { getByLabelText, onResizePreview } = renderHandles({
      startSize: { width: 200, height: 100 },
    });
    const se = getByLabelText(labels.se);

    fireEvent.pointerDown(se, { pointerId: 6, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(se, { pointerId: 6, clientX: 340, clientY: 152, shiftKey: true });

    // dominant axis is x (40 > 2), height follows the 2:1 start ratio -> 240/2=120.
    expect(onResizePreview).toHaveBeenCalledWith(
      'se',
      { width: 240, height: 120 },
      { width: 200, height: 100 },
    );
  });
});
