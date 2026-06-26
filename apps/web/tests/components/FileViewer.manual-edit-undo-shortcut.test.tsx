// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { emptyManualEditStyles, type ManualEditTarget } from '../../src/edit-mode/types';
import type { ProjectFile } from '../../src/types';

const panelState = vi.hoisted(() => ({
  props: null as ComponentProps<typeof import('../../src/components/ManualEditPanel').ManualEditPanel> | null,
}));

vi.mock('../../src/components/ManualEditPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/ManualEditPanel')>();
  return {
    ...actual,
    ManualEditPanel: (props: ComponentProps<typeof actual.ManualEditPanel>) => {
      panelState.props = props;
      return <div data-testid="mock-manual-edit-panel" />;
    },
  };
});

import { FileViewer } from '../../src/components/FileViewer';

async function selectHero() {
  const frame = await waitFor(() => {
    const node = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    if (!node.contentWindow) throw new Error('Preview frame not ready');
    return node;
  });
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'od-edit-select', target: heroTarget() },
      source: frame.contentWindow,
    }));
  });
  await waitFor(() => expect(panelState.props).not.toBeNull());
}

afterEach(() => {
  cleanup();
  panelState.props = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FileViewer manual edit undo keyboard shortcut', () => {
  it('undoes and redoes manual edits with Ctrl+Z / Ctrl+Shift+Z while editing', async () => {
    const initialSource = '<!doctype html><html><body><h1 data-od-id="hero">Hero</h1></body></html>';
    let persistedSource = initialSource;
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as { content: string };
        persistedSource = payload.content;
        savedSources.push(payload.content);
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(persistedSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectHero();

    act(() => {
      panelState.props?.onApplyPatch(
        { id: 'hero', kind: 'set-text', value: 'Edited hero' },
        'Content: Hero',
      );
    });
    await waitFor(() => expect(savedSources).toHaveLength(1));
    expect(savedSources[0]).toContain('Edited hero');

    // Ctrl+Z on the host undoes the committed manual edit.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    await waitFor(() => expect(savedSources).toHaveLength(2));
    expect(savedSources[1]).toBe(initialSource);

    // Ctrl+Shift+Z redoes it.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    });
    await waitFor(() => expect(savedSources).toHaveLength(3));
    expect(savedSources[2]).toContain('Edited hero');
  });

  it('undoes a rich set-inner-html commit with Ctrl+Z', async () => {
    const initialSource = '<!doctype html><html><body><p data-od-id="hero">Plain copy</p></body></html>';
    let persistedSource = initialSource;
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as { content: string };
        persistedSource = payload.content;
        savedSources.push(payload.content);
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(persistedSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    const frame = await waitFor(() => {
      const node = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      if (!node.contentWindow) throw new Error('Preview frame not ready');
      return node;
    });

    // Bridge posts od-edit-html-commit for rich (Ctrl+B) edits.
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-html-commit', id: 'hero', html: '<strong>Plain</strong> copy' },
        source: frame.contentWindow,
      }));
    });
    await waitFor(() => expect(savedSources).toHaveLength(1));
    expect(savedSources[0]).toContain('<strong>Plain</strong> copy');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    await waitFor(() => expect(savedSources).toHaveLength(2));
    expect(savedSources[1]).toBe(initialSource);
  });

  it('ignores Ctrl+Z that originates from an input field', async () => {
    const initialSource = '<!doctype html><html><body><h1 data-od-id="hero">Hero</h1></body></html>';
    let persistedSource = initialSource;
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as { content: string };
        persistedSource = payload.content;
        savedSources.push(payload.content);
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(persistedSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await selectHero();

    act(() => {
      panelState.props?.onApplyPatch(
        { id: 'hero', kind: 'set-text', value: 'Edited hero' },
        'Content: Hero',
      );
    });
    await waitFor(() => expect(savedSources).toHaveLength(1));

    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    // No undo save should have been triggered from inside the input.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(savedSources).toHaveLength(1);
    input.remove();
  });
});

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

function heroTarget(): ManualEditTarget {
  return {
    id: 'hero',
    kind: 'text',
    label: 'Hero',
    tagName: 'h1',
    className: '',
    text: 'Hero',
    rect: { x: 0, y: 0, width: 120, height: 40 },
    fields: { text: 'Hero' },
    attributes: { 'data-od-id': 'hero' },
    styles: emptyManualEditStyles(),
    isLayoutContainer: false,
    outerHtml: '<h1 data-od-id="hero">Hero</h1>',
  };
}
