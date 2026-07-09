// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import { emptyManualEditStyles, type ManualEditTarget } from '../../src/edit-mode/types';
import type { ProjectFile } from '../../src/types';

beforeEach(() => {
  // The move frame rAF-throttles its preview flush; run it synchronously so
  // drag assertions don't need to await a real animation frame.
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

describe('FileViewer manual edit move frame', () => {
  const SOURCE =
    '<!doctype html><html><body><main data-od-id="hero">Hero</main>'
    + '<img data-od-id="pic" src="x.png"></body></html>';

  async function previewFrame() {
    return waitFor(() => {
      const node = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      if (!node.contentWindow) throw new Error('Preview frame not ready');
      return node;
    });
  }

  async function selectManualEditTarget(target: ManualEditTarget) {
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-select', target },
        source: frame.contentWindow,
      }));
    });
    await waitFor(() => {
      expect(screen.queryByLabelText('Move element')).not.toBeNull();
    });
  }

  function moveFrame() {
    return screen.getByLabelText('Move element');
  }
  function interiorSurface() {
    return moveFrame().querySelector('[data-region="interior"]') as HTMLElement;
  }
  function ringSurface() {
    return moveFrame().querySelector('[data-region="ring"]') as HTMLElement;
  }

  function savingFetch(onSave: (content: string) => void) {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        onSave(JSON.parse(String(init.body)).content as string);
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
  }

  // Save always fails: mimics applyManualEdit returning false, whether from a
  // rejected write or a busy manualEditSavingRef mutex (border-drag-while-editing
  // chaining a text commit, or rapid consecutive drags).
  function failingSaveFetch() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ message: 'save failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
  }

  it('seeds selected mode for an image (interior surface) and editing mode for text (ring only)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));

    await selectManualEditTarget(imageTarget());
    expect(interiorSurface()).not.toBeNull();

    await selectManualEditTarget(textTarget());
    expect(interiorSurface()).toBeNull();
    expect(ringSurface()).not.toBeNull();
  });

  it('streams translate preview and commits translate to the saved file; consecutive drags accumulate', async () => {
    let savedContent = '';
    const fetchMock = savingFetch((c) => { savedContent = c; });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(imageTarget());

    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const interior = interiorSurface();

    // Drag 1: +30/+40 rect px at scale 1 → translate: 30px 40px.
    fireEvent.pointerDown(interior, { pointerId: 1, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 1, clientX: 330, clientY: 190 });
    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'od-edit-preview-style',
          id: 'pic',
          styles: expect.objectContaining({ translate: '30px 40px' }),
        }),
        '*',
      );
    });
    fireEvent.pointerUp(interior, { pointerId: 1, clientX: 330, clientY: 190 });
    await waitFor(() => {
      expect(savedContent).toMatch(/data-od-id="pic"[^>]*style="[^"]*translate:\s*30px\s+40px/);
    });

    // Drag 2 on the still-selected element folds onto the just-committed base
    // (30px 40px): +10/+0 rect px must preview 40px 40px, not 10px 0px.
    postSpy.mockClear();
    fireEvent.pointerDown(interiorSurface(), { pointerId: 2, clientX: 330, clientY: 190 });
    fireEvent.pointerMove(interiorSurface(), { pointerId: 2, clientX: 340, clientY: 190 });
    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'od-edit-preview-style',
          id: 'pic',
          styles: expect.objectContaining({ translate: '40px 40px' }),
        }),
        '*',
      );
    });
    fireEvent.keyDown(interiorSurface(), { key: 'Escape' });
  });

  it('posts od-edit-end-text-edit to the iframe when a drag starts while editing text', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(textTarget());

    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const ring = ringSurface();

    fireEvent.pointerDown(ring, { pointerId: 3, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(ring, { pointerId: 3, clientX: 130, clientY: 140 });

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'od-edit-end-text-edit' }),
        '*',
      );
    });
    // Editing → selected promotion exposes the interior surface.
    await waitFor(() => expect(interiorSurface()).not.toBeNull());

    fireEvent.pointerUp(ring, { pointerId: 3, clientX: 130, clientY: 140 });
  });

  it('reverts the preview to the base translate and writes no file on Escape mid-drag', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(imageTarget());

    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const interior = interiorSurface();

    fireEvent.pointerDown(interior, { pointerId: 4, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 4, clientX: 330, clientY: 190 });
    postSpy.mockClear();
    fireEvent.keyDown(interior, { key: 'Escape' });

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'od-edit-preview-style', id: 'pic' }),
        '*',
      );
    });
    const revertCall = postSpy.mock.calls.find((call) => (
      (call[0] as { type?: string }).type === 'od-edit-preview-style'
    ));
    expect((revertCall?.[0] as { styles?: Record<string, unknown> }).styles).toEqual({ translate: '' });

    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reverts the preview to base translate when the commit save fails (busy mutex / rejected write)', async () => {
    const fetchMock = failingSaveFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(imageTarget());

    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const interior = interiorSurface();

    fireEvent.pointerDown(interior, { pointerId: 6, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 6, clientX: 330, clientY: 190 });
    fireEvent.pointerUp(interior, { pointerId: 6, clientX: 330, clientY: 190 });

    // The failed save must still be attempted...
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // ...and since it failed, the iframe must snap the preview back to the
    // base translate (empty, since the target started with none) rather than
    // lingering at the dragged value — otherwise the next drag reads a stale
    // baseline and jumps.
    await waitFor(() => {
      const revertCall = postSpy.mock.calls.find((call) => {
        const msg = call[0] as { type?: string; id?: string; styles?: Record<string, unknown> };
        return msg.type === 'od-edit-preview-style' && msg.id === 'pic' && msg.styles?.translate === '';
      });
      expect(revertCall).toBeDefined();
    });
  });

  it('commits CSS-space translate (delta / rectScale) for a target under an ancestor transform', async () => {
    let savedContent = '';
    const fetchMock = savingFetch((c) => { savedContent = c; });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget({ ...imageTarget(), rectScale: { x: 2, y: 2 } });

    const interior = interiorSurface();
    // +40/+40 rect px at k=2 → 20px 20px CSS.
    fireEvent.pointerDown(interior, { pointerId: 5, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 5, clientX: 340, clientY: 190 });
    fireEvent.pointerUp(interior, { pointerId: 5, clientX: 340, clientY: 190 });

    await waitFor(() => {
      expect(savedContent).toMatch(/data-od-id="pic"[^>]*style="[^"]*translate:\s*20px\s+20px/);
    });
  });
});

function textTarget(): ManualEditTarget {
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

function imageTarget(): ManualEditTarget {
  return {
    id: 'pic',
    kind: 'image',
    label: 'Pic',
    tagName: 'img',
    className: '',
    text: '',
    rect: { x: 40, y: 40, width: 200, height: 120 },
    fields: { src: 'x.png' },
    attributes: { 'data-od-id': 'pic' },
    styles: emptyManualEditStyles(),
    isLayoutContainer: false,
    outerHtml: '<img data-od-id="pic" src="x.png">',
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
