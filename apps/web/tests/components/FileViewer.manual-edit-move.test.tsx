// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import type { ManualEditMoveFrameProps } from '../../src/components/ManualEditMoveFrame';
import * as movementSession from '../../src/edit-mode/movement-session';
import { emptyManualEditStyles, type ManualEditTarget } from '../../src/edit-mode/types';
import type { ProjectFile } from '../../src/types';

const manualEditMoveFrameProbe = vi.hoisted(() => ({
  current: null as ManualEditMoveFrameProps | null,
}));

vi.mock('../../src/components/ManualEditMoveFrame', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/ManualEditMoveFrame')>();
  return {
    ...actual,
    ManualEditMoveFrame: (props: ManualEditMoveFrameProps) => {
      manualEditMoveFrameProbe.current = props;
      return <actual.ManualEditMoveFrame {...props} />;
    },
  };
});

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
  manualEditMoveFrameProbe.current = null;
  document.getElementById('manual-edit-test-host')?.remove();
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
  function doubleClickSurface(surface: HTMLElement) {
    fireEvent.pointerDown(surface, { pointerId: 11, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(surface, { pointerId: 11, clientX: 100, clientY: 100 });
    fireEvent.click(surface);
    fireEvent.pointerDown(surface, { pointerId: 12, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(surface, { pointerId: 12, clientX: 100, clientY: 100 });
    fireEvent.click(surface);
    fireEvent.doubleClick(surface);
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

  it('forwards Alt-clicks on a selected container interior to the iframe bridge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } })));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(structuredTextContainerTarget());

    const frame = await previewFrame();
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 50, left: 100, top: 50, width: 800, height: 600,
      right: 900, bottom: 650, toJSON: () => ({}),
    } as DOMRect);
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');

    fireEvent.pointerDown(interiorSurface(), {
      pointerId: 13,
      altKey: true,
      clientX: 150,
      clientY: 80,
    });
    expect(postSpy).toHaveBeenCalledWith({ type: 'od-edit-click-cancel' }, '*');

    fireEvent.pointerUp(interiorSurface(), {
      pointerId: 13,
      altKey: true,
      clientX: 150,
      clientY: 80,
    });

    expect(postSpy).toHaveBeenCalledWith(
      { type: 'od-edit-alt-click', clientX: 50, clientY: 30 },
      '*',
    );
  });

  it('cancels on press, then forwards selected-id normal activations from both interior and ring', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } })));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(imageTarget());
    const frame = await previewFrame();
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 50, left: 100, top: 50, width: 800, height: 600,
      right: 900, bottom: 650, toJSON: () => ({}),
    } as DOMRect);
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');

    for (const [pointerId, surface] of [[31, interiorSurface()], [32, ringSurface()]] as const) {
      postSpy.mockClear();
      fireEvent.pointerDown(surface, { pointerId, clientX: 150, clientY: 80 });
      expect(postSpy).toHaveBeenCalledWith({ type: 'od-edit-click-cancel' }, '*');
      fireEvent.pointerUp(surface, { pointerId, clientX: 150, clientY: 80 });
      expect(postSpy).toHaveBeenCalledWith(
        { type: 'od-edit-click', clientX: 50, clientY: 30, selectedId: 'pic' },
        '*',
      );
    }
  });

  it.each([50, 100, 200])('converts activation coordinates at $0 percent preview scale', async (zoom) => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } })));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    if (zoom !== 100) {
      fireEvent.click(screen.getByRole('button', { name: '100%' }));
      fireEvent.click(screen.getByRole('menuitem', { name: `${zoom}%` }));
    }
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(imageTarget());
    const frame = await previewFrame();
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 50, left: 100, top: 50, width: 800, height: 600,
      right: 900, bottom: 650, toJSON: () => ({}),
    } as DOMRect);
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    fireEvent.pointerDown(interiorSurface(), { pointerId: 40, clientX: 200, clientY: 150 });
    fireEvent.pointerUp(interiorSurface(), { pointerId: 40, clientX: 200, clientY: 150 });
    expect(postSpy).toHaveBeenCalledWith({
      type: 'od-edit-click',
      clientX: 100 / (zoom / 100),
      clientY: 100 / (zoom / 100),
      selectedId: 'pic',
    }, '*');
  });

  it('forwards a selected text click instead of directly beginning text edit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } })));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(textTarget());
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-selection-state', editing: false, hasSelection: false, bold: false, italic: false, underline: false },
        source: frame.contentWindow,
      }));
    });
    await waitFor(() => expect(interiorSurface()).not.toBeNull());
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    fireEvent.pointerDown(interiorSurface(), { pointerId: 41, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(interiorSurface(), { pointerId: 41, clientX: 100, clientY: 100 });

    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'od-edit-click', selectedId: 'hero' }), '*');
    expect(postSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'od-edit-begin-text-edit' }), '*');
  });

  it('double-clicks through the selected overlay to edit structured text containers', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(structuredTextContainerTarget());
    expect(interiorSurface()).not.toBeNull();

    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    doubleClickSurface(interiorSurface());

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'od-edit-begin-text-edit', id: 'fancy-title' }),
        '*',
      );
    });
    await waitFor(() => expect(interiorSurface()).toBeNull());
  });

  it('does not enter text edit when double-clicking a true image move surface', async () => {
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
    doubleClickSurface(interiorSurface());

    expect(postSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'od-edit-begin-text-edit' }),
      '*',
    );
    expect(interiorSurface()).not.toBeNull();
  });

  it('saves structured rich text commits through the host pipeline', async () => {
    const structuredSource = '<!doctype html><html><body><div data-od-id="fancy-title">Big Headline<div class="glow-underline"></div></div></body></html>';
    let savedContent = '';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        savedContent = JSON.parse(String(init.body)).content as string;
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(structuredSource, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={structuredSource} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(structuredTextContainerTarget());
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-html-commit',
          id: 'fancy-title',
          html: 'Edited Headline<div class="glow-underline"></div>',
        },
        source: frame.contentWindow,
      }));
    });

    await waitFor(() => {
      expect(savedContent).toContain('Edited Headline<div class="glow-underline"></div>');
    });
  });

  it('keeps text editing active on border clicks that are not drags', async () => {
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
    fireEvent.pointerDown(ring, { pointerId: 7, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(ring, { pointerId: 7, clientX: 100, clientY: 100 });

    expect(postSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'od-edit-end-text-edit' }),
      '*',
    );
    expect(postSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'od-edit-click' }),
      '*',
    );
    expect(interiorSurface()).toBeNull();
  });

  it('preserves Alt selection routing from an editing-mode ring', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } })));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(textTarget());
    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const ring = ringSurface();
    fireEvent.pointerDown(ring, { pointerId: 42, clientX: 100, clientY: 100, altKey: true });
    fireEvent.pointerUp(ring, { pointerId: 42, clientX: 100, clientY: 100, altKey: true });

    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'od-edit-alt-click' }), '*');
    expect(interiorSurface()).toBeNull();
  });

  it('cancels the active srcDoc bridge before leaving manual edit mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } })));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    postSpy.mockClear();

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));

    await waitFor(() => expect(postSpy).toHaveBeenCalledWith({ type: 'od-edit-click-cancel' }, '*'));
    await waitFor(() => expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('false'));
  });

  it('streams translate preview and commits translate to the saved file; consecutive drags accumulate', async () => {
    let savedContent = '';
    const fetchMock = savingFetch((c) => { savedContent = c; });
    vi.stubGlobal('fetch', fetchMock);
    const inspectorHost = document.createElement('div');
    inspectorHost.id = 'manual-edit-test-host';
    document.body.appendChild(inspectorHost);

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlPreviewFile()}
        liveHtml={SOURCE}
        manualEditPortalId="manual-edit-test-host"
      />,
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
    fireEvent.click(screen.getByRole('button', { name: /Size & position/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Direct move' }).getAttribute('aria-pressed')).toBe('true');
      expect((screen.getByLabelText('X offset') as HTMLInputElement).value).toBe('30');
      expect((screen.getByLabelText('Y offset') as HTMLInputElement).value).toBe('40');
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

  it('reconciles final pointerup coordinates and Shift state before saving', async () => {
    let savedContent = '';
    const fetchMock = savingFetch((content) => { savedContent = content; });
    vi.stubGlobal('fetch', fetchMock);
    render(<FileViewer projectId={'project-1'} projectKind={'prototype'} file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(imageTarget());
    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const interior = interiorSurface();
    postSpy.mockClear();

    fireEvent.pointerDown(interior, { pointerId: 17, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 17, clientX: 330, clientY: 180 });
    fireEvent.pointerUp(interior, { pointerId: 17, clientX: 340, clientY: 190, shiftKey: true });

    await waitFor(() => expect(savedContent).toMatch(/translate:\s*40px\s+0px/));
    const previewIndex = postSpy.mock.calls.findIndex(([message]) => (
      (message as { type?: string; styles?: { translate?: string } }).type === 'od-edit-preview-style'
      && (message as { styles?: { translate?: string } }).styles?.translate === '40px 0px'
    ));
    const saveIndex = fetchMock.mock.calls.findIndex(([, init]) => (
      (init as RequestInit | undefined)?.method === 'POST'
    ));
    expect(previewIndex).toBeGreaterThanOrEqual(0);
    expect(saveIndex).toBeGreaterThanOrEqual(0);
    expect(postSpy.mock.invocationCallOrder[previewIndex]).toBeLessThan(fetchMock.mock.invocationCallOrder[saveIndex]!);
  });

  it('captures movement before ending text edit can synchronously mutate the live target', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    const initial = {
      ...textTarget(),
      rectScale: { x: 2, y: 2 },
      styles: { ...emptyManualEditStyles(), translate: '11px 4px' },
    };
    await selectManualEditTarget(initial);

    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    postSpy.mockImplementation((message) => {
      if ((message as { type?: string }).type !== 'od-edit-end-text-edit') return;
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-targets',
          targets: [{
            ...initial,
            rectScale: { x: 4, y: 4 },
            styles: { ...initial.styles, translate: '99px 80px' },
          }],
        },
        source: frame.contentWindow,
      }));
    });
    const ring = ringSurface();

    fireEvent.pointerDown(ring, { pointerId: 3, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(ring, { pointerId: 3, clientX: 130, clientY: 140 });

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'od-edit-end-text-edit' }),
        '*',
      );
    });
    expect(postSpy.mock.calls.filter(([message]) => (
      (message as { type?: string }).type === 'od-edit-end-text-edit'
    ))).toHaveLength(1);
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-preview-style',
        id: 'hero',
        styles: { translate: '26px 24px' },
      }),
      '*',
    );
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

  it('re-enters edit mode with the committed translate, not the pre-edit frozen snapshot', async () => {
    let savedContent = '';
    const fetchMock = savingFetch((c) => { savedContent = c; });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(imageTarget());

    const interior = interiorSurface();
    fireEvent.pointerDown(interior, { pointerId: 8, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 8, clientX: 330, clientY: 190 });
    fireEvent.pointerUp(interior, { pointerId: 8, clientX: 330, clientY: 190 });
    await waitFor(() => {
      expect(savedContent).toMatch(/data-od-id="pic"[^>]*style="[^"]*translate:\s*30px\s+40px/);
    });

    // Exit and re-enter edit mode. Exit is async (flush-then-exit), so wait
    // for each transition — a synchronous double click lands both on the
    // exit branch. The canvas must rebuild from the committed source; a
    // survived pre-edit frozen snapshot renders every moved element back at
    // its original position.
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('false');
    });
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('true');
    });

    await waitFor(() => {
      const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      expect(frame.getAttribute('srcdoc') ?? '').toMatch(/translate:\s*30px\s+40px/);
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

  it('captures a pending inspector translate as the movement baseline', async () => {
    let savedContent = '';
    vi.stubGlobal('fetch', savingFetch((content) => { savedContent = content; }));
    const inspectorHost = document.createElement('div');
    inspectorHost.id = 'manual-edit-test-host';
    document.body.appendChild(inspectorHost);
    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlPreviewFile()}
        liveHtml={SOURCE}
        manualEditPortalId="manual-edit-test-host"
      />,
    );
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(imageTarget());
    fireEvent.click(screen.getByRole('button', { name: /Size & position/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Direct move' }));
    fireEvent.change(screen.getByLabelText('X offset'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Y offset'), { target: { value: '-5' } });

    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const interior = interiorSurface();
    fireEvent.pointerDown(interior, { pointerId: 51, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 51, clientX: 308, clientY: 150 });
    fireEvent.pointerUp(interior, { pointerId: 51, clientX: 308, clientY: 150 });

    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-preview-style',
        id: 'pic',
        styles: { translate: '20px -5px' },
      }),
      '*',
    ));
    await waitFor(() => expect(savedContent).toMatch(/translate:\s*20px\s+-5px/));
  });

  it.each(['Escape', 'pointercancel'])(
    'keeps captured translate and scale after a same-target broadcast through %s cancellation',
    async (ending) => {
      vi.stubGlobal('fetch', vi.fn(async () =>
        new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } })));
      render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
      fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
      const initial = {
        ...imageTarget(),
        rectScale: { x: 2, y: 2 },
        styles: { ...emptyManualEditStyles(), translate: '10px 6px' },
      };
      await selectManualEditTarget(initial);
      const frame = await previewFrame();
      const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
      const interior = interiorSurface();
      fireEvent.pointerDown(interior, { pointerId: 52, clientX: 300, clientY: 150 });
      fireEvent.pointerMove(interior, { pointerId: 52, clientX: 320, clientY: 150 });

      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'od-edit-targets',
            targets: [{
              ...initial,
              rectScale: { x: 4, y: 4 },
              styles: { ...initial.styles, translate: '20px 6px' },
            }],
          },
          source: frame.contentWindow,
        }));
      });
      fireEvent.pointerMove(interior, { pointerId: 52, clientX: 340, clientY: 150 });

      await waitFor(() => expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'od-edit-preview-style',
          id: 'pic',
          styles: { translate: '30px 6px' },
        }),
        '*',
      ));
      postSpy.mockClear();
      if (ending === 'Escape') fireEvent.keyDown(interior, { key: 'Escape' });
      else fireEvent.pointerCancel(interior, { pointerId: 52 });
      await waitFor(() => expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'od-edit-preview-style',
          id: 'pic',
          styles: { translate: '10px 6px' },
        }),
        '*',
      ));
      expect(fetch).not.toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
    },
  );

  it('tracks acknowledged geometry without rebasing the captured movement session', async () => {
    const resolverSpy = vi.spyOn(movementSession, 'resolveManualEditMovement');
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } })));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    const initial = {
      ...imageTarget(),
      rectScale: { x: 2, y: 2 },
      styles: { ...emptyManualEditStyles(), translate: '10px 6px' },
    };
    await selectManualEditTarget(initial);
    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const interior = interiorSurface();
    fireEvent.pointerDown(interior, { pointerId: 62, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 62, clientX: 320, clientY: 150 });
    const firstPreview = postSpy.mock.calls.find(([message]) => (
      (message as { type?: string; styles?: { translate?: string } }).type === 'od-edit-preview-style'
      && (message as { styles?: { translate?: string } }).styles?.translate === '20px 6px'
    ))?.[0] as { version?: number } | undefined;
    expect(firstPreview?.version).toBeTypeOf('number');

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-preview-style-applied',
          id: 'pic',
          version: firstPreview?.version,
          ok: true,
          rect: { x: 500, y: 400, width: 210, height: 130 },
        },
        source: frame.contentWindow,
      }));
    });
    await waitFor(() => {
      expect(moveFrame().style.left).toBe('500px');
      expect(moveFrame().style.top).toBe('400px');
    });

    fireEvent.pointerMove(interior, { pointerId: 62, clientX: 340, clientY: 150 });
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-preview-style',
        id: 'pic',
        styles: { translate: '30px 6px' },
      }),
      '*',
    );
    expect(resolverSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startRect: initial.rect,
        rectScale: { x: 2, y: 2 },
        baselineTranslate: '10px 6px',
      }),
      { x: 40, y: 0 },
      { shiftKey: false, axis: null },
    );
    fireEvent.pointerCancel(interior, { pointerId: 62 });
  });

  it('persists the final pointerup result from the captured movement session', async () => {
    let savedContent = '';
    const resolverSpy = vi.spyOn(movementSession, 'resolveManualEditMovement');
    vi.stubGlobal('fetch', savingFetch((content) => { savedContent = content; }));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    const initial = { ...imageTarget(), rectScale: { x: 2, y: 2 } };
    await selectManualEditTarget(initial);
    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const interior = interiorSurface();
    fireEvent.pointerDown(interior, { pointerId: 53, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 53, clientX: 340, clientY: 150 });
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ styles: { translate: '20px 0px' } }),
      '*',
    ));

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-targets',
          targets: [{
            ...initial,
            rectScale: { x: 4, y: 4 },
            styles: { ...initial.styles, translate: '99px 8px' },
          }],
        },
        source: frame.contentWindow,
      }));
    });
    fireEvent.pointerUp(interior, { pointerId: 53, clientX: 340, clientY: 150 });

    await waitFor(() => expect(savedContent).toMatch(/translate:\s*20px\s+0px/));
    expect(resolverSpy).toHaveBeenCalledTimes(2);
  });

  it('drops an active movement when the same file refreshes', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    const file = htmlPreviewFile();
    const { rerender } = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={file} liveHtml={SOURCE} />,
    );
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(imageTarget());
    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const interior = interiorSurface();
    fireEvent.pointerDown(interior, { pointerId: 68, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 68, clientX: 330, clientY: 150 });
    const activeFrame = manualEditMoveFrameProbe.current!;
    const preview = postSpy.mock.calls.find(([message]) => (
      (message as { type?: string; styles?: { translate?: string } }).type === 'od-edit-preview-style'
      && (message as { styles?: { translate?: string } }).styles?.translate === '30px 0px'
    ));
    expect(preview).toBeDefined();
    const staleVersion = (preview![0] as { version: number }).version;

    rerender(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={{ ...file, mtime: file.mtime + 1 }}
        liveHtml={SOURCE.replace('Hero', 'Refreshed')}
      />,
    );
    await waitFor(() => expect(manualEditMoveFrameProbe.current).not.toBe(activeFrame));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-preview-style',
        styles: { translate: '' },
      }),
      '*',
    ));
    const rectBeforeStaleAck = manualEditMoveFrameProbe.current!.rect;
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-preview-style-applied',
          id: 'pic',
          version: staleVersion,
          ok: true,
          rect: { x: 500, y: 400, width: 210, height: 130 },
        },
        source: frame.contentWindow,
      }));
    });
    expect(manualEditMoveFrameProbe.current!.rect).toEqual(rectBeforeStaleAck);

    activeFrame.onMoveCommit({ delta: { x: 30, y: 0 }, shiftKey: false, axis: null });
    await Promise.resolve();
    expect(fetchMock.mock.calls.filter(([, init]) => (
      (init as RequestInit | undefined)?.method === 'POST'
    ))).toHaveLength(0);
  });

  it('drops a movement that starts while a raw-source refresh is pending', async () => {
    let rawFetches = 0;
    let resolveRefresh!: (response: Response) => void;
    const refresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/raw/')) {
        rawFetches += 1;
        return rawFetches === 1
          ? Promise.resolve(new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } }))
          : refresh;
      }
      return Promise.resolve(new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const file = htmlPreviewFile();
    const { rerender } = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={file} />,
    );
    await waitFor(() => expect(rawFetches).toBe(1));
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(imageTarget());
    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');

    rerender(
      <FileViewer projectId="project-1" projectKind="prototype" file={{ ...file, mtime: file.mtime + 1 }} />,
    );
    await waitFor(() => expect(rawFetches).toBe(2));

    const secondInterior = interiorSurface();
    fireEvent.pointerDown(secondInterior, { pointerId: 70, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(secondInterior, { pointerId: 70, clientX: 340, clientY: 150 });
    const secondFrame = manualEditMoveFrameProbe.current!;
    const secondPreview = postSpy.mock.calls.slice().reverse().find(([message]) => (
      (message as { type?: string; styles?: { translate?: string } }).type === 'od-edit-preview-style'
      && (message as { styles?: { translate?: string } }).styles?.translate === '40px 0px'
    ));
    expect(secondPreview).toBeDefined();
    const staleVersion = (secondPreview![0] as { version: number }).version;
    postSpy.mockClear();

    resolveRefresh(new Response(SOURCE.replace('Hero', 'Refreshed'), {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-preview-style',
        styles: { translate: '' },
      }),
      '*',
    ));
    await waitFor(() => expect(manualEditMoveFrameProbe.current).not.toBe(secondFrame));
    const rectBeforeStaleAck = manualEditMoveFrameProbe.current!.rect;
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-preview-style-applied',
          id: 'pic',
          version: staleVersion,
          ok: true,
          rect: { x: 500, y: 400, width: 210, height: 130 },
        },
        source: frame.contentWindow,
      }));
    });
    expect(manualEditMoveFrameProbe.current!.rect).toEqual(rectBeforeStaleAck);
    secondFrame.onMoveCommit({ delta: { x: 40, y: 0 }, shiftKey: false, axis: null });
    await Promise.resolve();
    expect(fetchMock.mock.calls.filter(([, init]) => (
      (init as RequestInit | undefined)?.method === 'POST'
    ))).toHaveLength(0);
  });

  it('resolves a queued final pointer preview exactly once before committing it', async () => {
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queued.push(callback);
      return queued.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const resolverSpy = vi.spyOn(movementSession, 'resolveManualEditMovement');
    let savedContent = '';
    vi.stubGlobal('fetch', savingFetch((content) => { savedContent = content; }));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(imageTarget());
    const interior = interiorSurface();
    const queuedBeforeMove = queued.length;

    fireEvent.pointerDown(interior, { pointerId: 61, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 61, clientX: 330, clientY: 190 });
    expect(resolverSpy).not.toHaveBeenCalled();
    expect(queued).toHaveLength(queuedBeforeMove + 1);
    const movementFrame = queued.at(-1);

    fireEvent.pointerUp(interior, { pointerId: 61, clientX: 330, clientY: 190 });
    await waitFor(() => expect(savedContent).toMatch(/translate:\s*30px\s+40px/));
    expect(resolverSpy).toHaveBeenCalledTimes(1);

    movementFrame!(0);
    expect(resolverSpy).toHaveBeenCalledTimes(1);
  });

  it('restores an exact nonempty captured translate when persistence fails', async () => {
    vi.stubGlobal('fetch', failingSaveFetch());
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget({
      ...imageTarget(),
      styles: { ...emptyManualEditStyles(), translate: '7px -3px' },
    });
    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const interior = interiorSurface();
    fireEvent.pointerDown(interior, { pointerId: 54, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 54, clientX: 320, clientY: 160 });
    postSpy.mockClear();
    fireEvent.pointerUp(interior, { pointerId: 54, clientX: 320, clientY: 160 });

    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-preview-style',
        id: 'pic',
        styles: { translate: '7px -3px' },
      }),
      '*',
    ));
  });

  it('restores the captured translate when the source patch rejects the target', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget({
      ...imageTarget(),
      id: 'missing-target',
      styles: { ...emptyManualEditStyles(), translate: '13px -2px' },
    });
    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const interior = interiorSurface();
    fireEvent.pointerDown(interior, { pointerId: 64, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 64, clientX: 320, clientY: 160 });
    postSpy.mockClear();
    fireEvent.pointerUp(interior, { pointerId: 64, clientX: 320, clientY: 160 });

    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-preview-style',
        id: 'missing-target',
        styles: { translate: '13px -2px' },
      }),
      '*',
    ));
    expect(fetchMock.mock.calls.filter(([, init]) => (
      (init as RequestInit | undefined)?.method === 'POST'
    ))).toHaveLength(0);
  });

  it('restores the captured translate when external source conflict aborts persistence', async () => {
    const changedSource = SOURCE.replace('Hero', 'Externally changed');
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/raw/')) {
        return new Response(changedSource, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      return new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget({
      ...imageTarget(),
      styles: { ...emptyManualEditStyles(), translate: '7px 5px' },
    });
    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const interior = interiorSurface();
    fireEvent.pointerDown(interior, { pointerId: 65, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 65, clientX: 320, clientY: 160 });
    postSpy.mockClear();
    fireEvent.pointerUp(interior, { pointerId: 65, clientX: 320, clientY: 160 });

    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-preview-style',
        id: 'pic',
        styles: { translate: '7px 5px' },
      }),
      '*',
    ));
    expect(fetchMock.mock.calls.filter(([, init]) => (
      (init as RequestInit | undefined)?.method === 'POST'
    ))).toHaveLength(0);
  });

  it('restores the captured translate when the save mutex rejects a newer movement', async () => {
    let resolveFirstSave!: (response: Response) => void;
    const firstSave = new Promise<Response>((resolve) => {
      resolveFirstSave = resolve;
    });
    let postCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        postCount += 1;
        return firstSave;
      }
      return new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget({
      ...imageTarget(),
      styles: { ...emptyManualEditStyles(), translate: '9px 2px' },
    });
    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const first = interiorSurface();
    fireEvent.pointerDown(first, { pointerId: 66, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(first, { pointerId: 66, clientX: 320, clientY: 150 });
    fireEvent.pointerUp(first, { pointerId: 66, clientX: 320, clientY: 150 });
    await waitFor(() => expect(postCount).toBe(1));

    const second = interiorSurface();
    fireEvent.pointerDown(second, { pointerId: 67, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(second, { pointerId: 67, clientX: 340, clientY: 150 });
    postSpy.mockClear();
    fireEvent.pointerUp(second, { pointerId: 67, clientX: 340, clientY: 150 });
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-preview-style',
        id: 'pic',
        styles: { translate: '9px 2px' },
      }),
      '*',
    ));
    expect(postCount).toBe(1);

    resolveFirstSave(new Response(JSON.stringify({ message: 'save failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('save failed'));
  });

  it('routes one keyboard nudge through one preview and one save', async () => {
    let savedContent = '';
    const resolverSpy = vi.spyOn(movementSession, 'resolveManualEditMovement');
    const fetchMock = savingFetch((content) => { savedContent = content; });
    vi.stubGlobal('fetch', fetchMock);
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget({
      ...imageTarget(),
      rectScale: { x: 2, y: 2 },
      styles: { ...emptyManualEditStyles(), translate: '4px 3px' },
    });
    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    postSpy.mockClear();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-nudge', direction: 'right' },
        source: frame.contentWindow,
      }));
    });

    await waitFor(() => expect(savedContent).toMatch(/translate:\s*5px\s+3px/));
    const movementPreviews = postSpy.mock.calls.filter(([message]) => {
      const data = message as { type?: string; styles?: { translate?: string } };
      return data.type === 'od-edit-preview-style' && data.styles?.translate === '5px 3px';
    });
    expect(movementPreviews).toHaveLength(1);
    const posts = fetchMock.mock.calls.filter(([input, init]) => (
      String(input) === '/api/projects/project-1/files'
      && (init as RequestInit | undefined)?.method === 'POST'
    ));
    expect(posts).toHaveLength(1);
    expect(resolverSpy).toHaveBeenCalledTimes(2);
  });

  it('persists one file write for one pointer movement', async () => {
    const fetchMock = savingFetch(() => {});
    vi.stubGlobal('fetch', fetchMock);
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(imageTarget());
    const interior = interiorSurface();
    fireEvent.pointerDown(interior, { pointerId: 55, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 55, clientX: 320, clientY: 160 });
    fireEvent.pointerUp(interior, { pointerId: 55, clientX: 320, clientY: 160 });

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(([input, init]) => (
        String(input) === '/api/projects/project-1/files'
        && (init as RequestInit | undefined)?.method === 'POST'
      ));
      expect(posts).toHaveLength(1);
    });
  });

  it('does not lazily recover missing or file-discarded movement ownership', async () => {
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queued.push(callback);
      return queued.length;
    });
    const resolverSpy = vi.spyOn(movementSession, 'resolveManualEditMovement');
    const fetchMock = savingFetch(() => {});
    vi.stubGlobal('fetch', fetchMock);
    const view = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />,
    );
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    const frame = await previewFrame();

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-nudge', direction: 'right' },
        source: frame.contentWindow,
      }));
    });
    expect(resolverSpy).not.toHaveBeenCalled();

    await selectManualEditTarget(imageTarget());
    const callbacks = manualEditMoveFrameProbe.current;
    if (!callbacks) throw new Error('Move frame callbacks were not captured');
    const interior = interiorSurface();
    const queuedBeforeMove = queued.length;
    fireEvent.pointerDown(interior, { pointerId: 63, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 63, clientX: 320, clientY: 160 });
    expect(queued).toHaveLength(queuedBeforeMove + 1);
    const stalePreviewFrame = queued.at(-1);
    if (!stalePreviewFrame) throw new Error('Movement preview frame was not queued');
    expect(resolverSpy).not.toHaveBeenCalled();

    const otherFile = { ...htmlPreviewFile(), name: 'other.html', path: 'other.html' };
    view.rerender(
      <FileViewer projectId="project-1" projectKind="prototype" file={otherFile} liveHtml={SOURCE} />,
    );
    await waitFor(() => expect(screen.queryByLabelText('Move element')).toBeNull());
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    act(() => {
      stalePreviewFrame(0);
      callbacks.onMoveCommit({ delta: { x: 20, y: 10 }, shiftKey: false, axis: null });
      callbacks.onMoveCancel();
    });

    expect(resolverSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([, init]) => (
      (init as RequestInit | undefined)?.method === 'POST'
    ))).toHaveLength(0);
  });

  it('does not persist a threshold-crossed return-to-origin', async () => {
    const fetchMock = savingFetch(() => {});
    vi.stubGlobal('fetch', fetchMock);
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(imageTarget());
    const interior = interiorSurface();

    fireEvent.pointerDown(interior, { pointerId: 58, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 58, clientX: 305, clientY: 150 });
    fireEvent.pointerMove(interior, { pointerId: 58, clientX: 300, clientY: 150 });
    fireEvent.pointerUp(interior, { pointerId: 58, clientX: 300, clientY: 150 });

    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => (
      (init as RequestInit | undefined)?.method === 'POST'
    ))).toHaveLength(0));
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => (
      (init as RequestInit | undefined)?.method === 'POST'
    ))).toHaveLength(0);
  });

  it('preserves a rounded keyboard no-op as one write', async () => {
    const fetchMock = savingFetch(() => {});
    vi.stubGlobal('fetch', fetchMock);
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget({
      ...imageTarget(),
      rectScale: { x: 100, y: 100 },
    });
    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    postSpy.mockClear();

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-nudge', direction: 'right' },
        source: frame.contentWindow,
      }));
    });

    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => (
      (init as RequestInit | undefined)?.method === 'POST'
    ))).toHaveLength(1));
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-preview-style',
        id: 'pic',
        styles: { translate: '' },
      }),
      '*',
    );
  });

  it('does not let an older failed save repaint or clear a newer movement', async () => {
    let resolveFirstSave!: (response: Response) => void;
    const firstSave = new Promise<Response>((resolve) => {
      resolveFirstSave = resolve;
    });
    let postCount = 0;
    let savedContent = '';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        postCount += 1;
        if (postCount === 1) return firstSave;
        savedContent = JSON.parse(String(init.body)).content as string;
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(SOURCE, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={SOURCE} />);
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(imageTarget());
    const frame = await previewFrame();
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');

    const first = interiorSurface();
    fireEvent.pointerDown(first, { pointerId: 56, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(first, { pointerId: 56, clientX: 320, clientY: 150 });
    fireEvent.pointerUp(first, { pointerId: 56, clientX: 320, clientY: 150 });
    await waitFor(() => expect(postCount).toBe(1));

    const second = interiorSurface();
    fireEvent.pointerDown(second, { pointerId: 57, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(second, { pointerId: 57, clientX: 340, clientY: 150 });
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ styles: { translate: '40px 0px' } }),
      '*',
    ));
    postSpy.mockClear();
    resolveFirstSave(new Response(JSON.stringify({ message: 'save failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('save failed'));
    expect(postSpy.mock.calls.some(([message]) => (
      (message as { styles?: { translate?: string } }).styles?.translate === ''
    ))).toBe(false);

    fireEvent.pointerUp(second, { pointerId: 57, clientX: 340, clientY: 150 });
    await waitFor(() => expect(savedContent).toMatch(/translate:\s*40px\s+0px/));
    expect(postCount).toBe(2);
  });

  it('does not let an older successful save clear a newer movement', async () => {
    const resolverSpy = vi.spyOn(movementSession, 'resolveManualEditMovement');
    let resolveFirstOnFileSaved!: () => void;
    const firstOnFileSaved = new Promise<void>((resolve) => {
      resolveFirstOnFileSaved = resolve;
    });
    let signalFirstOnFileSaved!: () => void;
    const firstOnFileSavedEntered = new Promise<void>((resolve) => {
      signalFirstOnFileSaved = resolve;
    });
    let signalOlderCommitDrained!: () => void;
    const olderCommitDrained = new Promise<void>((resolve) => {
      signalOlderCommitDrained = resolve;
    });
    let onFileSavedCount = 0;
    let postCount = 0;
    let finalSavedContent = '';
    let persistedSource = SOURCE;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        postCount += 1;
        persistedSource = JSON.parse(String(init.body)).content as string;
        if (postCount === 2) {
          finalSavedContent = persistedSource;
        }
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(persistedSource, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }));
    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlPreviewFile()}
        liveHtml={SOURCE}
        onFileSaved={async () => {
          onFileSavedCount += 1;
          if (onFileSavedCount !== 1) return;
          signalFirstOnFileSaved();
          await firstOnFileSaved;
          // The timer task cannot run until the promise continuations in
          // applyManualEdit and commitManualEditMovement have both drained.
          window.setTimeout(signalOlderCommitDrained, 0);
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectManualEditTarget(imageTarget());

    const first = interiorSurface();
    fireEvent.pointerDown(first, { pointerId: 68, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(first, { pointerId: 68, clientX: 320, clientY: 150 });
    fireEvent.pointerUp(first, { pointerId: 68, clientX: 320, clientY: 150 });
    await firstOnFileSavedEntered;

    const second = interiorSurface();
    fireEvent.pointerDown(second, { pointerId: 69, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(second, { pointerId: 69, clientX: 340, clientY: 150 });
    expect(resolverSpy).toHaveBeenCalledTimes(3);
    await act(async () => {
      resolveFirstOnFileSaved();
      await olderCommitDrained;
    });
    expect(second.isConnected).toBe(true);
    expect(interiorSurface()).toBe(second);
    fireEvent.pointerMove(second, { pointerId: 69, clientX: 350, clientY: 150 });
    expect(resolverSpy).toHaveBeenCalledTimes(4);

    fireEvent.pointerUp(second, { pointerId: 69, clientX: 350, clientY: 150 });
    await waitFor(() => expect(finalSavedContent).toMatch(/translate:\s*50px\s+0px/));
    expect(postCount).toBe(2);
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

function structuredTextContainerTarget(): ManualEditTarget {
  return {
    id: 'fancy-title',
    kind: 'container',
    label: 'Big Headline',
    tagName: 'div',
    className: 'fancy-title',
    text: 'Big Headline',
    rect: { x: 24, y: 24, width: 260, height: 80 },
    fields: { text: 'Big Headline' },
    attributes: { 'data-od-id': 'fancy-title' },
    styles: emptyManualEditStyles(),
    isLayoutContainer: false,
    textEditTargetId: 'fancy-title',
    outerHtml: '<div data-od-id="fancy-title" class="fancy-title">Big Headline<div class="glow-underline"></div></div>',
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
