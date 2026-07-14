// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import { emptyManualEditStyles, type ManualEditTarget } from '../../src/edit-mode/types';
import type { ProjectFile } from '../../src/types';

beforeEach(() => {
  // Handles rAF-throttle their preview flush; run it synchronously so drag
  // assertions don't need to await a real animation frame.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FileViewer manual edit resize handles', () => {
  const SOURCE = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';

  async function previewFrame() {
    return waitFor(() => {
      const node = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      if (!node.contentWindow) throw new Error('Preview frame not ready');
      return node;
    });
  }

  async function selectManualEditTarget(target = heroTarget()) {
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-select', target },
        source: frame.contentWindow,
      }));
    });
    await waitFor(() => {
      expect(screen.getByTestId('manual-edit-shape-toolbar')).toBeTruthy();
    });
    expect(document.querySelector('.manual-edit-right')).toBeNull();
  }

  function seHandle() {
    return screen.getByLabelText('Resize bottom-right corner') as HTMLButtonElement;
  }

  it('renders the 8 resize handles once a target is selected in edit mode', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget();

    for (const label of [
      'Resize top-left corner', 'Resize top edge', 'Resize top-right corner', 'Resize right edge',
      'Resize bottom-right corner', 'Resize bottom edge', 'Resize bottom-left corner', 'Resize left edge',
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it('streams od-edit-preview-style with width/height while dragging the SE handle', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget();

    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const se = seHandle();

    fireEvent.pointerDown(se, { pointerId: 1, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(se, { pointerId: 1, clientX: 340, clientY: 170 });

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'od-edit-preview-style',
          id: 'hero',
          styles: expect.objectContaining({
            width: expect.stringMatching(/px$/),
            height: expect.stringMatching(/px$/),
          }),
          includeAuthoredSize: false,
        }),
        '*',
      );
    });

    fireEvent.pointerUp(se, { pointerId: 1, clientX: 340, clientY: 170 });
  });

  it('commits width/height inline styles to the saved file on pointerup', async () => {
    let savedContent = '';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        savedContent = JSON.parse(String(init.body)).content as string;
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget();

    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const se = seHandle();
    fireEvent.pointerDown(se, { pointerId: 2, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(se, { pointerId: 2, clientX: 340, clientY: 170 });
    fireEvent.pointerUp(se, { pointerId: 2, clientX: 340, clientY: 170 });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'od-edit-preview-style',
          id: 'hero',
          includeAuthoredSize: true,
        }),
        '*',
      );
    });
    expect(savedContent).toMatch(/data-od-id="hero"[^>]*style="[^"]*width:\s*200px/);
    expect(savedContent).toMatch(/height:\s*68px/);

    await waitFor(() => {
      expect((screen.getByLabelText('Width') as HTMLInputElement).value).toBe('200');
      expect((screen.getByLabelText('Height') as HTMLInputElement).value).toBe('68');
    });
  });

  it('commits CSS-space px, not rect-space px, for targets under an ancestor transform', async () => {
    // Deck fit-to-canvas transforms make rect px = CSS px * k. The drag delta
    // must be divided back by k and applied to the element's CSS size, or every
    // commit inflates the element and repeated resizes compound the drift.
    let savedContent = '';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        savedContent = JSON.parse(String(init.body)).content as string;
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget({
      ...heroTarget(),
      // Visual (rect) box 500x100 under a 1.25x ancestor scale; CSS box 400x80.
      rect: { x: 24, y: 24, width: 500, height: 100 },
      styles: { ...emptyManualEditStyles(), width: '400px', height: '80px' },
      rectScale: { x: 1.25, y: 1.25 },
    });

    const se = seHandle();
    fireEvent.pointerDown(se, { pointerId: 30, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(se, { pointerId: 30, clientX: 340, clientY: 170 });
    fireEvent.pointerUp(se, { pointerId: 30, clientX: 340, clientY: 170 });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    // +40/+20 rect px at k=1.25 is +32/+16 CSS px on top of 400x80.
    expect(savedContent).toMatch(/data-od-id="hero"[^>]*style="[^"]*width:\s*432px/);
    expect(savedContent).toMatch(/height:\s*96px/);
  });

  it('commits a margin-left compensation on a west drag so the grabbed edge holds', async () => {
    // Width alone grows an in-flow element eastward: the west edge (and the
    // handle the user is holding) would not move. The commit must shift the
    // box back by the same CSS delta via margin-left.
    let savedContent = '';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        savedContent = JSON.parse(String(init.body)).content as string;
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget({
      ...heroTarget(),
      styles: { ...emptyManualEditStyles(), width: '160px', marginLeft: '0px' },
    });

    const w = screen.getByLabelText('Resize left edge') as HTMLButtonElement;
    fireEvent.pointerDown(w, { pointerId: 50, clientX: 100, clientY: 150 });
    fireEvent.pointerMove(w, { pointerId: 50, clientX: 60, clientY: 150 });
    fireEvent.pointerUp(w, { pointerId: 50, clientX: 60, clientY: 150 });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(savedContent).toMatch(/data-od-id="hero"[^>]*style="[^"]*width:\s*200px/);
    expect(savedContent).toMatch(/margin-left:\s*-40px/);
  });

  it('anchors the next drag on the ack-reported computed size, not a clamped commit', async () => {
    // Drag 1 requests 200px but layout clamps the element at 180px (the ack
    // carries cssSize). Committing folds the requested 200px into the target
    // styles; without the computed anchor, drag 2 inward would spend its first
    // 20px inside a dead zone where nothing moves.
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget();

    const frame = await previewFrame();
    const se = seHandle();

    // Drag 1: mouse implies 200x68; layout clamps at 180x60. The mid-drag ack
    // must NOT shift drag 1's own baseline (it is snapshotted at pointerdown).
    const midDragSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    fireEvent.pointerDown(se, { pointerId: 51, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(se, { pointerId: 51, clientX: 340, clientY: 170 });
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-preview-style-applied',
          id: 'hero',
          version: 1,
          ok: true,
          rect: { x: 24, y: 24, width: 180, height: 60 },
          cssSize: { width: '180px', height: '60px' },
        },
        source: frame.contentWindow,
      }));
    });
    // A further move after the ack still previews from the pointerdown
    // baseline: 300->350 implies 210, not computed(180) + delta(50) = 230.
    midDragSpy.mockClear();
    fireEvent.pointerMove(se, { pointerId: 51, clientX: 350, clientY: 170 });
    await waitFor(() => {
      expect(midDragSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'od-edit-preview-style',
          styles: expect.objectContaining({ width: '210px' }),
        }),
        '*',
      );
    });
    fireEvent.pointerUp(se, { pointerId: 51, clientX: 340, clientY: 170 });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // Drag 2: 20px inward from the measured 180px box must preview 160px
    // immediately (anchor = computed 180), not 180px (anchor = folded 200).
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    fireEvent.pointerDown(se, { pointerId: 52, clientX: 340, clientY: 170 });
    fireEvent.pointerMove(se, { pointerId: 52, clientX: 320, clientY: 170 });

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'od-edit-preview-style',
          id: 'hero',
          styles: expect.objectContaining({ width: '160px' }),
        }),
        '*',
      );
    });
    fireEvent.keyDown(se, { key: 'Escape' });
  });

  it('reverts a second drag to the just-committed size, not the pre-drag one', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget();

    const frame = await previewFrame();
    const se = seHandle();

    // First drag: commit a new size.
    fireEvent.pointerDown(se, { pointerId: 20, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(se, { pointerId: 20, clientX: 340, clientY: 170 });
    fireEvent.pointerUp(se, { pointerId: 20, clientX: 340, clientY: 170 });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // Second drag on the still-selected element, cancelled via Escape.
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    fireEvent.pointerDown(se, { pointerId: 21, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(se, { pointerId: 21, clientX: 360, clientY: 190 });
    postSpy.mockClear();
    fireEvent.keyDown(se, { key: 'Escape' });

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'od-edit-preview-style', id: 'hero' }),
        '*',
      );
    });
    const revertCall = postSpy.mock.calls.find((call) => (
      (call[0] as { type?: string }).type === 'od-edit-preview-style'
    ));
    // Revert restores the committed size (non-empty), not the pre-first-drag empty styles.
    // Margins revert too: a west/north drag preview may have shifted them.
    expect((revertCall?.[0] as { styles?: Record<string, string> }).styles).toEqual({
      width: '200px',
      height: '68px',
      marginLeft: '',
      marginRight: '',
      marginTop: '',
      marginBottom: '',
    });
  });

  it('tracks the element measured box from preview acks while dragging', async () => {
    // Flex/grid/min-content constraints can clamp or ignore the streamed
    // width/height, so mid-drag the handles must render the element's REAL box
    // (fed back through the od-edit-preview-style-applied ack), not the
    // mouse-implied one.
    const fetchMock = vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget();

    const frame = await previewFrame();
    const se = seHandle();

    fireEvent.pointerDown(se, { pointerId: 40, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(se, { pointerId: 40, clientX: 340, clientY: 170 });

    // The iframe reports the applied layout result: the element only reached
    // 180x60 at (30,28), not the mouse-implied 200x68 at the original anchor.
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-preview-style-applied',
          id: 'hero',
          version: 1,
          ok: true,
          rect: { x: 30, y: 28, width: 180, height: 60 },
        },
        source: frame.contentWindow,
      }));
    });

    await waitFor(() => {
      const container = seHandle().parentElement as HTMLElement;
      expect(container.style.left).toBe('30px');
      expect(container.style.top).toBe('28px');
      expect(seHandle().style.left).toBe('180px');
      expect(seHandle().style.top).toBe('60px');
    });

    fireEvent.keyDown(seHandle(), { key: 'Escape' });
  });

  it('keeps the ack-measured rect after commit instead of the mouse-derived size', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget();

    const frame = await previewFrame();
    const se = seHandle();

    // Drag to a mouse-implied 200x68; layout clamps the element at 180x60.
    fireEvent.pointerDown(se, { pointerId: 41, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(se, { pointerId: 41, clientX: 340, clientY: 170 });
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-preview-style-applied',
          id: 'hero',
          version: 1,
          ok: true,
          rect: { x: 24, y: 24, width: 180, height: 60 },
        },
        source: frame.contentWindow,
      }));
    });
    fireEvent.pointerUp(se, { pointerId: 41, clientX: 340, clientY: 170 });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // The overlay must keep the measured 180x60, not snap to the requested 200x68.
    await waitFor(() => {
      expect(seHandle().style.left).toBe('180px');
      expect(seHandle().style.top).toBe('60px');
    });
  });

  it('reverts the preview and does not write the file on Escape mid-drag', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget();

    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const se = seHandle();

    fireEvent.pointerDown(se, { pointerId: 3, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(se, { pointerId: 3, clientX: 340, clientY: 170 });
    postSpy.mockClear();
    fireEvent.keyDown(se, { key: 'Escape' });

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'od-edit-preview-style', id: 'hero' }),
        '*',
      );
    });
    const revertCall = postSpy.mock.calls.find((call) => (
      (call[0] as { type?: string }).type === 'od-edit-preview-style'
    ));
    expect((revertCall?.[0] as { styles?: Record<string, unknown> }).styles).toEqual({
      width: '', height: '', marginLeft: '', marginRight: '', marginTop: '', marginBottom: '',
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );

    fireEvent.pointerUp(se, { pointerId: 3, clientX: 340, clientY: 170 });
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reverts the preview and does not write the file on pointercancel mid-drag', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget();

    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const se = seHandle();

    fireEvent.pointerDown(se, { pointerId: 4, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(se, { pointerId: 4, clientX: 340, clientY: 170 });
    postSpy.mockClear();
    fireEvent.pointerCancel(se, { pointerId: 4 });

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'od-edit-preview-style', id: 'hero' }),
        '*',
      );
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('keeps the selected target panel-free while live geometry updates', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget();

    const frame = await previewFrame();
    // A geometry refresh (not a user selection) reporting the same element
    // moved far away — this is what the deferred od-edit-targets re-broadcast
    // after a layout mutation looks like.
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-targets',
          targets: [{ ...heroTarget(), rect: { x: 500, y: 500, width: 160, height: 48 } }],
        },
        source: frame.contentWindow,
      }));
    });

    // The live path stays live: the resize-handle overlay tracks the moved rect.
    await waitFor(() => {
      expect(seHandle().parentElement?.style.left).toBe('500px');
    });
    expect(seHandle().parentElement?.style.top).toBe('500px');

    expect(document.querySelector('.manual-edit-right')).toBeNull();
  });
});

function heroTarget(): ManualEditTarget {
  return {
    id: 'hero',
    kind: 'text',
    label: 'Hero',
    tagName: 'main',
    className: '',
    text: 'Hero',
    rect: { x: 24, y: 24, width: 160, height: 48 },
    fields: { text: 'Hero' },
    attributes: { 'data-od-id': 'hero' },
    styles: emptyManualEditStyles(),
    isLayoutContainer: false,
    outerHtml: '<main data-od-id="hero">Hero</main>',
  };
}

function htmlPreviewFile(): ProjectFile {
  return {
    name: 'preview.html',
    path: 'preview.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    mime: 'text/html',
    kind: 'html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Preview',
      entry: 'preview.html',
      renderer: 'html',
      exports: ['html'],
    },
  };
}
