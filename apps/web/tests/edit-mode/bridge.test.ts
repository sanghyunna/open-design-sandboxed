import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  buildManualEditBridge,
  isMeaningfulManualEditElement,
  isManualEditHostNode,
  isSourceMappableManualEditElement,
  manualEditDomPathForElement,
  manualEditStableIdForElement,
} from '../../src/edit-mode/bridge';

describe('manual edit bridge target normalization', () => {
  it('prefers explicit data-od-id over generated ids', () => {
    const dom = new JSDOM('<main><h1 data-od-id="hero">Title</h1></main>');
    const target = dom.window.document.querySelector('h1')!;

    expect(manualEditStableIdForElement(target)).toBe('hero');
    expect(target.getAttribute('data-od-runtime-id')).toBeNull();
  });

  it('generates stable DOM path ids for unannotated elements', () => {
    const dom = new JSDOM('<main><section><p>First</p><p>Second</p></section></main>');
    const target = dom.window.document.querySelectorAll('p')[1]!;

    expect(manualEditDomPathForElement(target)).toBe('path-0-0-1');
    expect(manualEditStableIdForElement(target)).toBe('path-0-0-1');
    expect(manualEditStableIdForElement(target)).toBe('path-0-0-1');
    expect(target.getAttribute('data-od-runtime-id')).toBe('path-0-0-1');
  });

  it('generates DOM path ids against source-shaped children, ignoring host shim nodes', () => {
    const dom = new JSDOM(
      '<script data-od-sandbox-shim></script><main><section><p>First</p><p>Second</p></section></main><script data-od-edit-bridge></script>',
    );
    const target = dom.window.document.querySelectorAll('p')[1]!;

    expect(isManualEditHostNode(dom.window.document.querySelector('[data-od-sandbox-shim]')!)).toBe(true);
    expect(manualEditDomPathForElement(target)).toBe('path-0-0-1');
  });

  it('discovers meaningful elements and ignores tiny or irrelevant elements', () => {
    const dom = new JSDOM('<main><h1 data-od-source-path="path-0-0">Title</h1><script>1</script></main>');
    const title = dom.window.document.querySelector('h1')!;
    const script = dom.window.document.querySelector('script')!;

    expect(isMeaningfulManualEditElement(title, { width: 80, height: 24 })).toBe(true);
    expect(isMeaningfulManualEditElement(title, { width: 3, height: 24 })).toBe(false);
    expect(isMeaningfulManualEditElement(script, { width: 80, height: 24 })).toBe(false);
  });

  it('does not discover inline formatting leaves inside a text passage as separate targets', () => {
    const dom = new JSDOM('<main><p data-od-source-path="path-0-0">Hello <strong data-od-source-path="path-0-0-0">world</strong></p></main>');
    const paragraph = dom.window.document.querySelector('p')!;
    const strong = dom.window.document.querySelector('strong')!;

    expect(isMeaningfulManualEditElement(paragraph, { width: 120, height: 24 })).toBe(true);
    expect(isMeaningfulManualEditElement(strong, { width: 60, height: 24 })).toBe(false);
  });

  it('keeps source-mappable display:none targets available for the layers panel', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isHidden?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <h1 data-od-source-path="path-0-0">Visible title</h1>
        <section data-od-source-path="path-0-1" style="display:none">
          <p data-od-source-path="path-0-1-0">Hidden author notes</p>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const visible = dom.window.document.querySelector('h1')!;
    const hiddenSection = dom.window.document.querySelector('section')!;
    const hiddenParagraph = dom.window.document.querySelector('p')!;
    visible.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 160, height: 32,
      top: 0, right: 160, bottom: 32, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    hiddenSection.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 0, height: 0,
      top: 0, right: 0, bottom: 0, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    hiddenParagraph.getBoundingClientRect = hiddenSection.getBoundingClientRect;
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isHidden?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    expect(targetsMessage?.targets?.map((target) => target.id)).toEqual([
      'path-0-0',
      'path-0-1',
      'path-0-1-0',
    ]);
    expect(targetsMessage?.targets?.find((target) => target.id === 'path-0-1')?.isHidden).toBe(true);
    expect(targetsMessage?.targets?.find((target) => target.id === 'path-0-1-0')?.isHidden).toBe(true);

    dom.window.close();
  });

  it('treats hidden containers as layout editable targets', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-source-path="path-0-0" style="display:none">
          <p data-od-source-path="path-0-0-0">Hidden layout copy</p>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const section = dom.window.document.querySelector('section')!;
    const paragraph = dom.window.document.querySelector('p')!;
    section.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 0, height: 0,
      top: 0, right: 0, bottom: 0, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    paragraph.getBoundingClientRect = section.getBoundingClientRect;
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    const hiddenSection = targetsMessage?.targets?.find((target) => target.id === 'path-0-0');
    const hiddenParagraph = targetsMessage?.targets?.find((target) => target.id === 'path-0-0-0');
    expect(hiddenSection?.isHidden).toBe(true);
    expect(hiddenSection?.isLayoutContainer).toBe(true);
    expect(hiddenParagraph?.isLayoutContainer).toBe(false);

    dom.window.close();
  });

  it('does not treat visibility-hidden block containers as layout editable targets', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-source-path="path-0-0" style="visibility:hidden">
          <p data-od-source-path="path-0-0-0">Hidden block copy</p>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const section = dom.window.document.querySelector('section')!;
    const paragraph = dom.window.document.querySelector('p')!;
    section.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 160, height: 32,
      top: 0, right: 160, bottom: 32, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    paragraph.getBoundingClientRect = () => ({
      x: 8, y: 8, width: 140, height: 20,
      top: 8, right: 148, bottom: 28, left: 8,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    const hiddenSection = targetsMessage?.targets?.find((target) => target.id === 'path-0-0');
    expect(hiddenSection?.isHidden).toBe(true);
    expect(hiddenSection?.isLayoutContainer).toBe(false);

    dom.window.close();
  });

  it('does not treat block containers hidden only by an ancestor as layout editable targets', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <div data-od-source-path="path-0-0" style="display:none">
          <section data-od-source-path="path-0-0-0">Nested hidden section</section>
        </div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const wrapper = dom.window.document.querySelector('div')!;
    const section = dom.window.document.querySelector('section')!;
    wrapper.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 0, height: 0,
      top: 0, right: 0, bottom: 0, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    section.getBoundingClientRect = wrapper.getBoundingClientRect;
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    const hiddenSection = targetsMessage?.targets?.find((target) => target.id === 'path-0-0-0');
    expect(hiddenSection?.isHidden).toBe(true);
    expect(hiddenSection?.isLayoutContainer).toBe(false);

    dom.window.close();
  });

  it('does not mark visibility:visible descendants as hidden', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isHidden?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-source-path="path-0-0" style="visibility:hidden">
          <p data-od-source-path="path-0-0-0" style="visibility:visible">Visible child copy</p>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const section = dom.window.document.querySelector('section')!;
    const visibleChild = dom.window.document.querySelector('p')!;
    section.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 160, height: 32,
      top: 0, right: 160, bottom: 32, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    visibleChild.getBoundingClientRect = () => ({
      x: 8, y: 8, width: 140, height: 20,
      top: 8, right: 148, bottom: 28, left: 8,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isHidden?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    expect(targetsMessage?.targets?.find((target) => target.id === 'path-0-0')?.isHidden).toBe(true);
    expect(targetsMessage?.targets?.find((target) => target.id === 'path-0-0-0')?.isHidden).toBe(false);

    dom.window.close();
  });

  it('does not expose path targets unless they carry a source path marker', () => {
    const dom = new JSDOM('<main><h1>Runtime title</h1><p data-od-source-path="path-0-1">Source text</p></main>');
    const runtimeTitle = dom.window.document.querySelector('h1')!;
    const sourceText = dom.window.document.querySelector('p')!;

    expect(isSourceMappableManualEditElement(runtimeTitle)).toBe(false);
    expect(isSourceMappableManualEditElement(sourceText)).toBe(true);
    expect(isMeaningfulManualEditElement(runtimeTitle, { width: 80, height: 24 })).toBe(false);
  });

  it('omits selected outerHTML from bulk target posts but includes it for selected targets', () => {
    const bridge = buildManualEditBridge(true);

    expect(bridge).toContain('targets.push(targetFrom(nodes[i], false, false))');
    expect(bridge).toContain("type: 'od-edit-hover', target: targetFrom(el, true, false)");
    expect(bridge).toContain("type: 'od-edit-select', target: targetFrom(el, true, true)");
    expect(bridge).toContain('if (!isSourceMappable(nodes[i])) continue;');
    expect(bridge).toContain('return el;');
    expect(bridge).not.toContain('if (isPrimaryTarget(el)) return el;');
  });

  it('prefers the deepest source-mapped child over an annotated group on hover', async () => {
    const posts: Array<{ type?: string; target?: { id: string; label?: string; authoredSize?: unknown } }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-id="hero-group">
          <span data-od-source-path="path-0-0-0">Small label</span>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const span = dom.window.document.querySelector('span')!;
    const createElement = vi.spyOn(dom.window.document, 'createElement');
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; target?: { id: string; label?: string; authoredSize?: unknown } });
    }) as typeof dom.window.parent.postMessage;

    span.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));

    const hover = posts.find((message) => message.type === 'od-edit-hover');
    expect(hover?.target?.id).toBe('path-0-0-0');
    expect(hover?.target?.label).toBe('Small label');
    expect(hover?.target).not.toHaveProperty('authoredSize');
    expect(createElement.mock.calls.filter(([tag]) => tag === 'style')).toHaveLength(0);

    dom.window.close();
  });

  it('omits inline formatting leaves from bulk target posts when a text passage owns them', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string }> }> = [];
    const dom = new JSDOM(
      `<main><p data-od-source-path="path-0-0">Hello <strong data-od-source-path="path-0-0-0">world</strong></p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const paragraph = dom.window.document.querySelector('p')!;
    const strong = dom.window.document.querySelector('strong')!;
    paragraph.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 120, height: 24,
      top: 0, right: 120, bottom: 24, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    strong.getBoundingClientRect = () => ({
      x: 40, y: 0, width: 60, height: 24,
      top: 0, right: 100, bottom: 24, left: 40,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    expect(targetsMessage?.targets?.map((target) => target.id)).toEqual(['path-0-0']);

    dom.window.close();
  });

  it('acks live preview style patches by id and version', () => {
    const bridge = buildManualEditBridge(true);

    expect(bridge).toContain("type: 'od-edit-preview-style-applied'");
    expect(bridge).toContain('version: Number(version) || 0,');
    expect(bridge).toContain('ok: true,');
    expect(bridge).toContain("ok: false, error: 'Target not found'");
  });

  it('moves the runtime selected marker between selected targets', () => {
    const dom = new JSDOM(
      `<main>
        <h1 data-od-id="title">Title</h1>
        <p data-od-id="body">Body</p>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]')!;
    const body = dom.window.document.querySelector('[data-od-id="body"]')!;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'title' },
    }));
    expect(title.getAttribute('data-od-edit-selected')).toBe('true');
    expect(body.hasAttribute('data-od-edit-selected')).toBe(false);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'body' },
    }));
    expect(title.hasAttribute('data-od-edit-selected')).toBe(false);
    expect(body.getAttribute('data-od-edit-selected')).toBe('true');

    dom.window.close();
  });

  it('clears runtime selected markers for null selection and edit-mode exit', () => {
    const dom = new JSDOM(
      `<main>
        <h1 data-od-id="title">Title</h1>
        <p data-od-id="body" data-od-edit-selected="true">Body</p>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const body = dom.window.document.querySelector('[data-od-id="body"]')!;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: null },
    }));
    expect(body.hasAttribute('data-od-edit-selected')).toBe(false);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'body' },
    }));
    expect(body.getAttribute('data-od-edit-selected')).toBe('true');

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: false },
    }));
    expect(body.hasAttribute('data-od-edit-selected')).toBe(false);

    dom.window.close();
  });

  it('cycles plain clicks at the same point through the z-stack top-to-bottom', () => {
    const dom = new JSDOM(
      `<main>
        <div data-od-id="bottom" data-od-edit="container"><span>Bottom</span></div>
        <div data-od-id="top" data-od-edit="container"><span>Top</span></div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const top = dom.window.document.querySelector('[data-od-id="top"]') as HTMLElement;
    const bottom = dom.window.document.querySelector('[data-od-id="bottom"]') as HTMLElement;
    Object.defineProperty(dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [top, bottom],
    });
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    top.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'od-edit-select', target: expect.objectContaining({ id: 'top' }) }),
      '*',
    );

    postMessage.mockClear();
    top.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'od-edit-select', target: expect.objectContaining({ id: 'bottom' }) }),
      '*',
    );

    // A third click at the same spot wraps back to the topmost target.
    postMessage.mockClear();
    top.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'od-edit-select', target: expect.objectContaining({ id: 'top' }) }),
      '*',
    );

    dom.window.close();
  });

  it('cycles a 3-deep Alt+click stack and wraps to the top target', () => {
    const dom = new JSDOM(
      `<main>
        <div data-od-id="back" data-od-edit="container"><span>Back</span></div>
        <div data-od-id="middle" data-od-edit="container"><span>Middle</span></div>
        <div data-od-id="front" data-od-edit="container"><span>Front</span></div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const front = dom.window.document.querySelector('[data-od-id="front"]') as HTMLElement;
    const middle = dom.window.document.querySelector('[data-od-id="middle"]') as HTMLElement;
    const back = dom.window.document.querySelector('[data-od-id="back"]') as HTMLElement;
    Object.defineProperty(dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [front, middle, back],
    });
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    for (let i = 0; i < 4; i++) {
      front.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, altKey: true, clientX: 10, clientY: 10 }));
    }

    const selectedIds = postMessage.mock.calls
      .map(([message]) => message as { type?: string; target?: { id?: string } })
      .filter((message) => message.type === 'od-edit-select')
      .map((message) => message.target?.id);
    expect(selectedIds).toEqual(['middle', 'back', 'front', 'middle']);

    dom.window.close();
  });

  it('keeps cycling through duplicate enabled-mode feedback and a forwarded Alt+click', () => {
    const dom = new JSDOM(
      `<main>
        <div data-od-id="back" data-od-edit="container"><span>Back</span></div>
        <div data-od-id="middle" data-od-edit="container"><span>Middle</span></div>
        <div data-od-id="front" data-od-edit="container"><span>Front</span></div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const front = dom.window.document.querySelector('[data-od-id="front"]') as HTMLElement;
    const middle = dom.window.document.querySelector('[data-od-id="middle"]') as HTMLElement;
    const back = dom.window.document.querySelector('[data-od-id="back"]') as HTMLElement;
    Object.defineProperty(dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [front, middle, back],
    });
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    front.dispatchEvent(new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      altKey: true,
      clientX: 10,
      clientY: 10,
    }));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-alt-click', clientX: 10, clientY: 10 },
    }));

    const selectedIds = postMessage.mock.calls
      .map(([message]) => message as { type?: string; target?: { id?: string } })
      .filter((message) => message.type === 'od-edit-select')
      .map((message) => message.target?.id);
    expect(selectedIds).toEqual(['middle', 'back']);

    dom.window.close();
  });

  it('resets cycling when the click point moves beyond tolerance', () => {
    const dom = new JSDOM(
      `<main>
        <div data-od-id="back" data-od-edit="container"><span>Back</span></div>
        <div data-od-id="middle" data-od-edit="container"><span>Middle</span></div>
        <div data-od-id="front" data-od-edit="container"><span>Front</span></div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const front = dom.window.document.querySelector('[data-od-id="front"]') as HTMLElement;
    const middle = dom.window.document.querySelector('[data-od-id="middle"]') as HTMLElement;
    const back = dom.window.document.querySelector('[data-od-id="back"]') as HTMLElement;
    Object.defineProperty(dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [front, middle, back],
    });
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    front.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, altKey: true, clientX: 10, clientY: 10 }));
    front.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, altKey: true, clientX: 20, clientY: 10 }));

    const selectedIds = postMessage.mock.calls
      .map(([message]) => message as { type?: string; target?: { id?: string } })
      .filter((message) => message.type === 'od-edit-select')
      .map((message) => message.target?.id);
    expect(selectedIds).toEqual(['middle', 'middle']);

    dom.window.close();
  });

  it('resets cycling when the stack composition changes', () => {
    const dom = new JSDOM(
      `<main>
        <div data-od-id="back" data-od-edit="container"><span>Back</span></div>
        <div data-od-id="middle" data-od-edit="container"><span>Middle</span></div>
        <div data-od-id="front" data-od-edit="container"><span>Front</span></div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const front = dom.window.document.querySelector('[data-od-id="front"]') as HTMLElement;
    const middle = dom.window.document.querySelector('[data-od-id="middle"]') as HTMLElement;
    const back = dom.window.document.querySelector('[data-od-id="back"]') as HTMLElement;
    let stack = [front, middle, back];
    Object.defineProperty(dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => stack,
    });
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    front.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, altKey: true, clientX: 10, clientY: 10 }));
    stack = [front, back];
    front.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, altKey: true, clientX: 10, clientY: 10 }));

    const selectedIds = postMessage.mock.calls
      .map(([message]) => message as { type?: string; target?: { id?: string } })
      .filter((message) => message.type === 'od-edit-select')
      .map((message) => message.target?.id);
    expect(selectedIds).toEqual(['middle', 'back']);

    dom.window.close();
  });

  it('selects text and link targets on Alt+click without entering inline edit', () => {
    const dom = new JSDOM(
      `<main><a data-od-id="cta" href="/start">Start</a></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const link = dom.window.document.querySelector('[data-od-id="cta"]') as HTMLElement;
    Object.defineProperty(dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [link],
    });
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, altKey: true, clientX: 10, clientY: 10 }));

    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'od-edit-select', target: expect.objectContaining({ id: 'cta', kind: 'link' }) }),
      '*',
    );
    expect(link.hasAttribute('data-od-editing')).toBe(false);
    expect(link.hasAttribute('contenteditable')).toBe(false);

    dom.window.close();
  });

  it('still enters inline edit for plain clicks on text and link targets', () => {
    const dom = new JSDOM(
      `<main>
        <h1 data-od-id="title">Title</h1>
        <a data-od-id="cta" href="/start">Start</a>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]') as HTMLElement;
    const link = dom.window.document.querySelector('[data-od-id="cta"]') as HTMLElement;

    title.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(title.getAttribute('data-od-editing')).toBe('true');
    title.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: false }));

    link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(link.getAttribute('data-od-editing')).toBe('true');

    dom.window.close();
  });

  it('does not enter inline edit when a cycled plain click lands on a text target', () => {
    const dom = new JSDOM(
      `<main>
        <div data-od-id="card" data-od-edit="container"><span>Card</span></div>
        <h1 data-od-id="title">Title</h1>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const card = dom.window.document.querySelector('[data-od-id="card"]') as HTMLElement;
    const title = dom.window.document.querySelector('[data-od-id="title"]') as HTMLElement;
    Object.defineProperty(dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [card, title],
    });

    card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    expect(card.getAttribute('data-od-edit-selected')).toBe('true');

    card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    expect(title.getAttribute('data-od-edit-selected')).toBe('true');
    expect(title.hasAttribute('data-od-editing')).toBe(false);
    expect(title.hasAttribute('contenteditable')).toBe(false);

    dom.window.close();
  });

  it('cycles a forwarded od-edit-click message from the overlay', () => {
    const dom = new JSDOM(
      `<main>
        <div data-od-id="back" data-od-edit="container"><span>Back</span></div>
        <div data-od-id="front" data-od-edit="container"><span>Front</span></div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const front = dom.window.document.querySelector('[data-od-id="front"]') as HTMLElement;
    const back = dom.window.document.querySelector('[data-od-id="back"]') as HTMLElement;
    Object.defineProperty(dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [front, back],
    });
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    front.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-click', clientX: 10, clientY: 10 },
    }));

    const selectedIds = postMessage.mock.calls
      .map(([message]) => message as { type?: string; target?: { id?: string } })
      .filter((message) => message.type === 'od-edit-select')
      .map((message) => message.target?.id);
    expect(selectedIds).toEqual(['front', 'back']);

    dom.window.close();
  });

  it('emits a background message for empty click regions', () => {
    const dom = new JSDOM(
      `<main><div>Empty</div></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    dom.window.document.body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(postMessage).toHaveBeenCalledWith({ type: 'od-edit-background' }, '*');

    dom.window.close();
  });

  it('moves the selected marker to the deeper target on Alt+click', () => {
    const dom = new JSDOM(
      `<main>
        <div data-od-id="bottom" data-od-edit="container"><span>Bottom</span></div>
        <div data-od-id="top" data-od-edit="container"><span>Top</span></div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const top = dom.window.document.querySelector('[data-od-id="top"]') as HTMLElement;
    const bottom = dom.window.document.querySelector('[data-od-id="bottom"]') as HTMLElement;
    Object.defineProperty(dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [top, bottom],
    });

    top.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, altKey: true, clientX: 10, clientY: 10 }));

    expect(top.hasAttribute('data-od-edit-selected')).toBe(false);
    expect(bottom.getAttribute('data-od-edit-selected')).toBe('true');

    dom.window.close();
  });

  it('keeps runtime selection marker out of source-shaped target data', () => {
    const bridge = buildManualEditBridge(true);

    expect(bridge).toContain("attr.name === 'data-od-edit-selected'");
    expect(bridge).toContain('replace(/\\sdata-od-edit-selected="[^"]*"/g, \'\')');
    expect(bridge).toContain('[data-od-edit-selected]');
  });

  it('marks flex/grid targets as layout containers', () => {
    const bridge = buildManualEditBridge(true);

    expect(bridge).toContain('isLayoutContainer: isLayoutContainer(el)');
    expect(bridge).toContain("display.indexOf('flex') >= 0 || display.indexOf('grid') >= 0");
  });

  it('turns text targets into inline editors and commits changed text', () => {
    const dom = new JSDOM(
      `<main><h1 data-od-id="title">Original title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    title.dispatchEvent(new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 8,
      clientY: 8,
    }));
    expect(title.getAttribute('contenteditable')).toBe('true');
    expect(title.getAttribute('data-od-editing')).toBe('true');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({
        id: 'title',
        kind: 'text',
      }),
    }, '*');

    title.textContent = 'Edited title';
    title.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: false }));

    expect(title.hasAttribute('contenteditable')).toBe(false);
    expect(title.hasAttribute('data-od-editing')).toBe(false);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-text-commit',
      id: 'title',
      value: 'Edited title',
    }, '*');

    dom.window.close();
  });

  it('turns text-only container targets into inline editors', () => {
    const dom = new JSDOM(
      `<main><div data-od-id="tagline">Original tagline</div></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const tagline = dom.window.document.querySelector('[data-od-id="tagline"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    tagline.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(tagline.getAttribute('contenteditable')).toBe('true');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({
        id: 'tagline',
        kind: 'text',
      }),
    }, '*');

    tagline.textContent = 'Edited tagline';
    tagline.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: false }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-text-commit',
      id: 'tagline',
      value: 'Edited tagline',
    }, '*');

    dom.window.close();
  });

  it('turns lower-level heading targets into inline editors', () => {
    const dom = new JSDOM(
      `<main><h4 data-od-id="eyebrow">Original eyebrow</h4></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const eyebrow = dom.window.document.querySelector('[data-od-id="eyebrow"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    eyebrow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(eyebrow.getAttribute('contenteditable')).toBe('true');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({
        id: 'eyebrow',
        kind: 'text',
      }),
    }, '*');

    dom.window.close();
  });

  it('targets the text passage when clicking inline formatting leaves', () => {
    const dom = new JSDOM(
      `<main><div data-od-id="wrapper" class="zh"><b data-od-source-path="path-0-0-0">Visible text</b></div></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const leaf = dom.window.document.querySelector('b') as HTMLElement;
    const wrapper = dom.window.document.querySelector('[data-od-id="wrapper"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    leaf.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(wrapper.getAttribute('contenteditable')).toBe('true');
    expect(leaf.hasAttribute('contenteditable')).toBe(false);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({
        id: 'wrapper',
        kind: 'text',
        tagName: 'div',
      }),
    }, '*');

    dom.window.close();
  });

  it('turns single-inline value wrappers into inline editors', () => {
    const dom = new JSDOM(
      `<main><div class="value" data-od-source-path="path-0-0"><strong data-od-source-path="path-0-0-0">42</strong></div></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const value = dom.window.document.querySelector('.value') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    value.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(value.getAttribute('contenteditable')).toBe('true');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({
        id: 'path-0-0',
        kind: 'text',
        tagName: 'div',
        className: 'value',
      }),
    }, '*');

    dom.window.close();
  });

  it('keeps nested containers out of inline text editing', () => {
    const dom = new JSDOM(
      `<main><section data-od-id="hero"><h1 data-od-id="title">Original title</h1></section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const section = dom.window.document.querySelector('[data-od-id="hero"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    section.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(section.hasAttribute('contenteditable')).toBe(false);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({
        id: 'hero',
        kind: 'container',
        textEditTargetId: undefined,
      }),
    }, '*');

    dom.window.close();
  });

  it('commits inline text edits with Escape (PPT: keeps typed text, promotes to object-select)', () => {
    const dom = new JSDOM(
      `<main><p data-od-id="body">Original body</p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const body = dom.window.document.querySelector('[data-od-id="body"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    body.textContent = 'Draft body';
    body.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    }));

    expect(body.hasAttribute('data-od-editing')).toBe(false);
    expect(body.textContent).toBe('Draft body');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-text-commit',
      id: 'body',
      value: 'Draft body',
    }, '*');

    dom.window.close();
  });

  it('enters inline text edit on an od-edit-begin-text-edit message', () => {
    const dom = new JSDOM(
      `<main><h1 data-od-id="title">Original title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]') as HTMLElement;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-begin-text-edit', id: 'title' },
    }));

    expect(title.getAttribute('contenteditable')).toBe('true');
    expect(title.getAttribute('data-od-editing')).toBe('true');

    dom.window.close();
  });

  it('exposes structured text containers as container objects with a text edit target', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; kind?: string; textEditTargetId?: string }>; html?: string }> = [];
    const dom = new JSDOM(
      `<main><div data-od-id="fancy-title">Big Headline<div class="glow-underline"></div></div></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="fancy-title"]') as HTMLElement;
    title.getBoundingClientRect = () => ({ x: 0, y: 0, width: 240, height: 64, top: 0, right: 240, bottom: 64, left: 0, toJSON: () => ({}) } as DOMRect);
    dom.window.parent.postMessage = ((m: unknown) => { posts.push(m as { type?: string; targets?: Array<{ id: string; kind?: string; textEditTargetId?: string }>; html?: string }); }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targets = posts.find((m) => m.type === 'od-edit-targets')?.targets ?? [];
    expect(targets.find((target) => target.id === 'fancy-title')).toMatchObject({
      kind: 'container',
      textEditTargetId: 'fancy-title',
    });

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-begin-text-edit', id: 'fancy-title' },
    }));

    expect(title.getAttribute('contenteditable')).toBe('true');
    title.innerHTML = 'Edited Headline<div class="glow-underline"></div>';
    title.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: false }));

    expect(posts).toContainEqual(expect.objectContaining({
      type: 'od-edit-html-commit',
      html: 'Edited Headline<div class="glow-underline"></div>',
    }));

    dom.window.close();
  });

  it('exposes split and icon text containers as self-editable structured text', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; kind?: string; textEditTargetId?: string }> }> = [];
    const dom = new JSDOM(
      `<main>
        <div data-od-id="grad"><span data-od-source-path="path-0-0-0">Half</span> <span data-od-source-path="path-0-0-1">Title</span></div>
        <div data-od-id="icon-label"><svg viewBox="0 0 1 1"><path d="M0 0h1v1z"></path></svg><span>Label</span></div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const grad = dom.window.document.querySelector('[data-od-id="grad"]') as HTMLElement;
    const icon = dom.window.document.querySelector('[data-od-id="icon-label"]') as HTMLElement;
    grad.getBoundingClientRect = () => ({ x: 0, y: 0, width: 240, height: 64, top: 0, right: 240, bottom: 64, left: 0, toJSON: () => ({}) } as DOMRect);
    icon.getBoundingClientRect = () => ({ x: 0, y: 80, width: 180, height: 40, top: 80, right: 180, bottom: 120, left: 0, toJSON: () => ({}) } as DOMRect);
    dom.window.parent.postMessage = ((m: unknown) => { posts.push(m as { type?: string; targets?: Array<{ id: string; kind?: string; textEditTargetId?: string }> }); }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targets = posts.find((m) => m.type === 'od-edit-targets')?.targets ?? [];
    expect(targets.find((target) => target.id === 'grad')).toMatchObject({
      kind: 'container',
      textEditTargetId: 'grad',
    });
    expect(targets.find((target) => target.id === 'icon-label')).toMatchObject({
      kind: 'container',
      textEditTargetId: 'icon-label',
    });
    expect(targets.some((target) => target.id === 'path-0-0-0')).toBe(false);
    expect(targets.some((target) => target.id === 'path-0-0-1')).toBe(false);

    dom.window.close();
  });

  it('does not expose containers with non-round-trippable children as structured text', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; kind?: string; textEditTargetId?: string }> }> = [];
    const dom = new JSDOM(
      `<main>
        <div data-od-id="image-label">Logo <img src="icon.png"></div>
        <div data-od-id="svg-title"><svg viewBox="0 0 1 1"><title>Search</title><path d="M0 0h1v1z"></path></svg><span>Label</span></div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const imageLabel = dom.window.document.querySelector('[data-od-id="image-label"]') as HTMLElement;
    const svgTitle = dom.window.document.querySelector('[data-od-id="svg-title"]') as HTMLElement;
    imageLabel.getBoundingClientRect = () => ({ x: 0, y: 0, width: 180, height: 40, top: 0, right: 180, bottom: 40, left: 0, toJSON: () => ({}) } as DOMRect);
    svgTitle.getBoundingClientRect = () => ({ x: 0, y: 80, width: 180, height: 40, top: 80, right: 180, bottom: 120, left: 0, toJSON: () => ({}) } as DOMRect);
    dom.window.parent.postMessage = ((m: unknown) => { posts.push(m as { type?: string; targets?: Array<{ id: string; kind?: string; textEditTargetId?: string }> }); }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targets = posts.find((m) => m.type === 'od-edit-targets')?.targets ?? [];
    expect(targets.find((target) => target.id === 'image-label')).toMatchObject({
      kind: 'container',
      textEditTargetId: undefined,
    });
    expect(targets.find((target) => target.id === 'svg-title')).toMatchObject({
      kind: 'container',
      textEditTargetId: undefined,
    });

    dom.window.close();
  });

  it('exits inline text edit (blur -> commit) on an od-edit-end-text-edit message', () => {
    const posts: Array<{ type?: string; editing?: boolean }> = [];
    const dom = new JSDOM(
      `<main><h1 data-od-id="title">Original title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]') as HTMLElement;
    dom.window.parent.postMessage = ((m: unknown) => { posts.push(m as { type?: string; editing?: boolean }); }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-begin-text-edit', id: 'title' },
    }));
    expect(title.getAttribute('data-od-editing')).toBe('true');

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-end-text-edit' },
    }));

    expect(title.hasAttribute('data-od-editing')).toBe(false);
    const state = posts.filter((m) => m.type === 'od-edit-selection-state').pop();
    expect(state?.editing).toBe(false);

    dom.window.close();
  });

  it('reports the element translate in select target styles', () => {
    const dom = new JSDOM(
      `<main><h1 data-od-id="hero" style="translate: 12px 34px">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    dom.window.document.querySelector('[data-od-id="hero"]')!.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-select',
        target: expect.objectContaining({
          styles: expect.objectContaining({ translate: '12px 34px' }),
        }),
      }),
      '*',
    );

    dom.window.close();
  });

  it('blocks clicks on unmapped elements while edit mode is enabled', () => {
    const dom = new JSDOM(
      `<main><button id="cta">Launch</button></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const button = dom.window.document.getElementById('cta') as HTMLButtonElement;
    const clicked = vi.fn();
    button.addEventListener('click', clicked);

    const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    const result = button.dispatchEvent(event);

    expect(result).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(clicked).not.toHaveBeenCalled();

    dom.window.close();
  });

  it('re-broadcasts targets when layout mutates without a resize or scroll event', async () => {
    // Deck slide navigation, transition settle, and media loads reflow the page
    // with no resize/scroll event; without an in-bridge layout observer the host
    // overlays (resize handles, inspector panel, hover icon) render stale rects.
    const posts: Array<{ type?: string }> = [];
    const dom = new JSDOM(
      `<main><h1 data-od-source-path="path-0-0">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    // Let initial discovery (and any runtime-id stamping it performs) settle.
    await new Promise((resolve) => dom.window.setTimeout(resolve, 60));

    const countBefore = posts.filter((message) => message.type === 'od-edit-targets').length;
    expect(countBefore).toBeGreaterThan(0);

    // A deck-style class flip: mutates layout, fires neither resize nor scroll.
    dom.window.document.querySelector('h1')!.setAttribute('class', 'slide-active');
    await new Promise((resolve) => dom.window.setTimeout(resolve, 60));

    const countAfter = posts.filter((message) => message.type === 'od-edit-targets').length;
    expect(countAfter).toBeGreaterThan(countBefore);

    dom.window.close();
  });

  it('coalesces preview-write layout echoes into one deferred post after the stream quiets', async () => {
    // od-edit-preview-style streams one inline-style write per frame during a
    // drag; the layout observer must not echo a per-frame od-edit-targets storm
    // back at the host, but the FINAL layout state must still re-broadcast once
    // the stream quiets. Dropping it (instead of deferring it) strands the host
    // overlays on stale rects after every drag: no resize/scroll event follows
    // a pointerup, so nothing else re-measures.
    const posts: Array<{ type?: string }> = [];
    const dom = new JSDOM(
      `<main><h1 data-od-source-path="path-0-0">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 60));

    const countBefore = posts.filter((message) => message.type === 'od-edit-targets').length;
    for (const width of ['120px', '130px', '140px']) {
      dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
        data: { type: 'od-edit-preview-style', id: 'path-0-0', styles: { width }, version: 7 },
      }));
      await new Promise((resolve) => dom.window.setTimeout(resolve, 10));
    }

    // Inside the mute window: no per-frame storm.
    const countDuring = posts.filter((message) => message.type === 'od-edit-targets').length;
    expect(countDuring).toBe(countBefore);

    // After the stream quiets: exactly one coalesced re-broadcast.
    await new Promise((resolve) => dom.window.setTimeout(resolve, 200));
    const countAfter = posts.filter((message) => message.type === 'od-edit-targets').length;
    expect(countAfter).toBe(countBefore + 1);

    dom.window.close();
  });

  it('includes the freshly measured target rect in preview-style acks', () => {
    // During a drag the host renders the resize handles from the element's REAL
    // box, not the mouse-implied one: flex/grid/min-content constraints can
    // clamp or ignore the streamed width/height. The per-frame ack is the
    // feedback channel, so it must carry the post-apply rect.
    const dom = new JSDOM(
      `<main><h1 data-od-id="hero">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const hero = dom.window.document.querySelector('[data-od-id="hero"]') as HTMLElement;
    hero.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 300, height: 80,
      top: 20, right: 310, bottom: 100, left: 10,
      toJSON: () => ({}),
    } as DOMRect);
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: {
        type: 'od-edit-preview-style',
        id: 'hero',
        styles: { width: '300px' },
        version: 9,
        includeAuthoredSize: true,
      },
    }));

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-preview-style-applied',
        id: 'hero',
        version: 9,
        ok: true,
        rect: { x: 10, y: 20, width: 300, height: 80 },
        // Post-apply computed width/height: the host's resize baseline needs
        // the value layout actually used, not the (possibly clamped) request.
        cssSize: { width: expect.any(String), height: expect.any(String) },
        authoredSize: { width: '300px', height: '' },
      }),
      '*',
    );

    dom.window.close();
  });

  it('omits authored-size work for high-frequency sizing preview frames', () => {
    const dom = new JSDOM(
      `<style>.hero { width: 320px; }</style><main><h1 class="hero" data-od-id="hero">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');
    const createElement = vi.spyOn(dom.window.document, 'createElement');

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-preview-style', id: 'hero', styles: { width: '340px' }, version: 10 },
    }));

    const ack = postMessage.mock.calls
      .map(([message]) => message as { type?: string; authoredSize?: unknown })
      .find((message) => message.type === 'od-edit-preview-style-applied');
    expect(ack).toBeTruthy();
    expect(ack).not.toHaveProperty('authoredSize');
    expect(createElement.mock.calls.filter(([tag]) => tag === 'style')).toHaveLength(0);

    dom.window.close();
  });

  it('probes the winning authored size once for low-frequency inspector updates', () => {
    const dom = new JSDOM(
      `<style>.hero { width: 320px !important; }</style><main><h1 class="hero" data-od-id="hero">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    for (const width of ['100%', '']) {
      postMessage.mockClear();
      dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
        data: {
          type: 'od-edit-preview-style',
          id: 'hero',
          styles: { width },
          version: 11,
          includeAuthoredSize: true,
        },
      }));
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'od-edit-preview-style-applied',
          authoredSize: { width: '320px', height: '' },
        }),
        '*',
      );
    }

    dom.window.close();
  });

  it('includes computed and stylesheet-authored sizes on selected targets', () => {
    const dom = new JSDOM(
      `<style>.hero-size { width: 320px; height: 100%; }</style><main><h1 class="hero-size" data-od-id="hero">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    dom.window.document.querySelector('[data-od-id="hero"]')!.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-select',
        target: expect.objectContaining({
          id: 'hero',
          cssSize: { width: expect.any(String), height: expect.any(String) },
          authoredSize: { width: '320px', height: '100%' },
        }),
      }),
      '*',
    );

    dom.window.close();
  });

  it('hydrates a lightweight hover target when the host selects its affordance', () => {
    const dom = new JSDOM(
      `<style>.hero-size { width: 320px; }</style><main><h1 class="hero-size" data-od-id="hero">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-select-target', id: 'hero' },
    }));

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-select',
        target: expect.objectContaining({
          id: 'hero',
          authoredSize: { width: '320px', height: '' },
        }),
      }),
      '*',
    );

    dom.window.close();
  });

  it('preserves stylesheet activation conditions when resolving authored sizes', () => {
    const dom = new JSDOM(
      `<style>.hero-size { height: 48px; }</style>
       <style media="print">.hero-size { width: 900px; }</style>
       <style id="disabled-size">.hero-size { width: 800px; }</style>
       <main><h1 class="hero-size" data-od-id="hero">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const disabledSheet = (dom.window.document.getElementById('disabled-size') as HTMLStyleElement).sheet;
    if (!disabledSheet) throw new Error('Expected disabled test stylesheet');
    Object.defineProperty(disabledSheet, 'disabled', { configurable: true, value: true });
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    dom.window.document.querySelector('[data-od-id="hero"]')!.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-select',
        target: expect.objectContaining({
          authoredSize: { width: '', height: '48px' },
        }),
      }),
      '*',
    );

    dom.window.close();
  });

  it('uses HTML width and height hints below winning CSS declarations', () => {
    const dom = new JSDOM(
      `<style>.photo { width: 50%; }</style>
       <main><img class="photo" data-od-id="photo" width="640" height="360" alt="Preview"></main>
       ${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    dom.window.document.querySelector('[data-od-id="photo"]')!.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-select',
        target: expect.objectContaining({
          authoredSize: { width: '50%', height: '360px' },
        }),
      }),
      '*',
    );

    dom.window.close();
  });

  it('ignores width attributes that are not valid image pixel hints', () => {
    const dom = new JSDOM(
      `<main>
         <div data-od-id="box" width="640">Box</div>
         <img data-od-id="photo" width="50%" height="360" alt="Preview">
       </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    for (const [id, authoredSize] of [
      ['box', { width: '', height: '' }],
      ['photo', { width: '', height: '360px' }],
    ] as const) {
      postMessage.mockClear();
      dom.window.document.querySelector(`[data-od-id="${id}"]`)!.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'od-edit-select',
          target: expect.objectContaining({ authoredSize }),
        }),
        '*',
      );
    }

    dom.window.close();
  });

  it('reports the flex main axis for flex-item targets', () => {
    // Dragging width on a flex-row item (or height on a flex-column item) is a
    // main-axis resize: layout ignores the bare width/height unless the commit
    // also pins the item (flex: none). The host needs to know the axis.
    const dom = new JSDOM(
      `<main>
        <div style="display:flex"><h1 data-od-id="row-item">Row</h1></div>
        <div style="display:flex;flex-direction:column"><h2 data-od-id="column-item">Column</h2></div>
        <div><h3 data-od-id="block-item">Block</h3></div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    for (const [id, axis] of [['row-item', 'row'], ['column-item', 'column'], ['block-item', null]] as const) {
      postMessage.mockClear();
      dom.window.document.querySelector(`[data-od-id="${id}"]`)!.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'od-edit-select',
          target: expect.objectContaining({ id, flexItemAxis: axis }),
        }),
        '*',
      );
    }

    dom.window.close();
  });

  it('reports the rect-to-CSS scale of transformed elements on each axis', () => {
    // Under an ancestor transform (deck fit-to-canvas), getBoundingClientRect
    // px = CSS px * k. The host needs k to convert drag deltas back to the CSS
    // width/height space the inspector shows and the source file stores.
    const dom = new JSDOM(
      `<main><h1 data-od-id="title">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]') as HTMLElement;
    title.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 200, height: 50,
      top: 0, right: 200, bottom: 50, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(title, 'offsetWidth', { value: 160 });
    Object.defineProperty(title, 'offsetHeight', { value: 40 });
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    title.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({
        id: 'title',
        rectScale: { x: 1.25, y: 1.25 },
      }),
    }, '*');

    dom.window.close();
  });

  it('re-broadcasts targets on scroll so a selected element rect does not go stale', async () => {
    const posts: Array<{ type?: string }> = [];
    const dom = new JSDOM(
      `<main><h1 data-od-source-path="path-0-0">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const countBeforeScroll = posts.filter((message) => message.type === 'od-edit-targets').length;
    expect(countBeforeScroll).toBeGreaterThan(0);

    dom.window.document.dispatchEvent(new dom.window.Event('scroll'));

    const countAfterScroll = posts.filter((message) => message.type === 'od-edit-targets').length;
    expect(countAfterScroll).toBeGreaterThan(countBeforeScroll);

    dom.window.close();
  });
});

describe('manual edit bridge rich-text editing', () => {
  function selectContents(window: Window & typeof globalThis, el: Element): void {
    const sel = window.getSelection();
    const range = window.document.createRange();
    range.selectNodeContents(el);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it('opens text targets in a formatting-capable contenteditable', () => {
    const dom = new JSDOM(
      `<main><h1 data-od-id="title">Original title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]') as HTMLElement;

    title.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(title.getAttribute('contenteditable')).toBe('true');

    dom.window.close();
  });

  it('keeps link targets on the plain-text editing path', () => {
    const dom = new JSDOM(
      `<main><a data-od-id="cta" href="/start">Start</a></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const link = dom.window.document.querySelector('[data-od-id="cta"]') as HTMLElement;

    link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(link.getAttribute('contenteditable')).toBe('plaintext-only');

    dom.window.close();
  });

  // jsdom does not implement document.execCommand at all (calling it throws
  // "not a function"), so these tests stub it and assert the bridge *routes*
  // Ctrl/Cmd+B/I/U through it rather than doing raw Range surgery. The actual
  // formatting/undo behavior can only be observed in a real browser (see the
  // Playwright verification script referenced in the PR description).
  function stubExecCommand(win: Window & typeof globalThis): ReturnType<typeof vi.fn> {
    const execCommand = vi.fn();
    (win.document as unknown as { execCommand: typeof execCommand }).execCommand = execCommand;
    return execCommand;
  }

  it.each([
    ['b', 'bold'],
    ['i', 'italic'],
    ['u', 'underline'],
  ])('routes Ctrl+%s through document.execCommand(%s) for native undo integration', (key, command) => {
    const dom = new JSDOM(
      `<main><p data-od-id="copy">Hello world</p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const win = dom.window as unknown as Window & typeof globalThis;
    const copy = dom.window.document.querySelector('[data-od-id="copy"]') as HTMLElement;
    const execCommand = stubExecCommand(win);

    copy.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    selectContents(win, copy);
    execCommand.mockClear(); // drop the styleWithCSS call fired on session start

    const event = new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
      ctrlKey: true,
    });
    copy.dispatchEvent(event);

    expect(execCommand).toHaveBeenCalledWith(command);
    expect(event.defaultPrevented).toBe(true);

    dom.window.close();
  });

  it('enables styleWithCSS-off once per rich edit session so toggles emit tags, not style spans', () => {
    const dom = new JSDOM(
      `<main><p data-od-id="copy">Hello world</p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const win = dom.window as unknown as Window & typeof globalThis;
    const copy = dom.window.document.querySelector('[data-od-id="copy"]') as HTMLElement;
    const execCommand = stubExecCommand(win);

    copy.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(execCommand).toHaveBeenCalledWith('styleWithCSS', false, 'false');
    expect(execCommand).toHaveBeenCalledTimes(1);

    dom.window.close();
  });

  it('does not call execCommand for link (plaintext-only) targets', () => {
    const dom = new JSDOM(
      `<main><a data-od-id="cta" href="/start">Start</a></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const win = dom.window as unknown as Window & typeof globalThis;
    const link = dom.window.document.querySelector('[data-od-id="cta"]') as HTMLElement;
    const execCommand = stubExecCommand(win);

    link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(execCommand).not.toHaveBeenCalled();

    dom.window.close();
  });

  function selectTextRange(window: Window & typeof globalThis, node: Node, start: number, end: number): void {
    const sel = window.getSelection();
    const range = window.document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it('preserves a drag selection when entering rich-text edit mode', () => {
    const dom = new JSDOM(
      `<main><p data-od-id="copy">Hello world</p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const win = dom.window as unknown as Window & typeof globalThis;
    const copy = dom.window.document.querySelector('[data-od-id="copy"]') as HTMLElement;
    const textNode = copy.firstChild!; // Text "Hello world"

    selectTextRange(win, textNode, 0, 5); // "Hello"
    copy.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    const selection = win.getSelection();
    expect(copy.getAttribute('contenteditable')).toBe('true');
    expect(selection?.toString()).toBe('Hello');
    expect(selection?.getRangeAt(0).collapsed).toBe(false);

    dom.window.close();
  });

  it('uses the source-mapped ancestor when a drag selection ends on an inline child', () => {
    const dom = new JSDOM(
      `<main><p data-od-id="copy"><span data-od-source-path="path-0-0">Hello</span> <span data-od-source-path="path-0-1">world</span></p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const win = dom.window as unknown as Window & typeof globalThis;
    const copy = dom.window.document.querySelector('[data-od-id="copy"]') as HTMLElement;
    const spans = copy.querySelectorAll('span');
    const firstText = spans[0]!.firstChild!;
    const secondText = spans[1]!.firstChild!;

    selectTextRange(win, firstText, 0, 5);
    const range = win.getSelection()!.getRangeAt(0);
    range.setEnd(secondText, 5);
    spans[1]!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    const selection = win.getSelection();
    expect(copy.getAttribute('contenteditable')).toBe('true');
    expect(spans[1]!.hasAttribute('contenteditable')).toBe(false);
    expect(selection?.toString()).toBe('Hello world');
    expect(selection?.getRangeAt(0).collapsed).toBe(false);

    dom.window.close();
  });

  it('commits mixed-markup paragraph edits as inner html', () => {
    const dom = new JSDOM(
      `<main><p data-od-id="nested"><strong>Nested</strong> copy</p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const nested = dom.window.document.querySelector('[data-od-id="nested"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    nested.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(nested.getAttribute('contenteditable')).toBe('true');

    nested.innerHTML = '<strong>Nested</strong> revised copy';
    nested.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: false }));

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'od-edit-html-commit',
        id: 'nested',
        html: '<strong>Nested</strong> revised copy',
      }),
      '*',
    );

    dom.window.close();
  });
});

describe('manual edit bridge undo/redo forwarding', () => {
  it('forwards Ctrl+Z to the host as an undo message when no inline edit session is active', () => {
    const dom = new JSDOM(
      `<main><h1 data-od-id="title">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    const event = new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      ctrlKey: true,
    });
    dom.window.document.dispatchEvent(event);

    expect(postMessage).toHaveBeenCalledWith({ type: 'od-edit-undo', redo: false }, '*');
    expect(event.defaultPrevented).toBe(true);

    dom.window.close();
  });

  it('forwards Shift+Ctrl+Z and Ctrl+Y as redo', () => {
    const dom = new JSDOM(
      `<main><h1 data-od-id="title">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
    }));
    expect(postMessage).toHaveBeenCalledWith({ type: 'od-edit-undo', redo: true }, '*');

    postMessage.mockClear();
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'y',
      ctrlKey: true,
    }));
    expect(postMessage).toHaveBeenCalledWith({ type: 'od-edit-undo', redo: true }, '*');

    dom.window.close();
  });

  it('does not forward undo while an inline edit session is active, leaving native undo in control', () => {
    const dom = new JSDOM(
      `<main><h1 data-od-id="title">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]') as HTMLElement;
    title.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(title.getAttribute('data-od-editing')).toBe('true');

    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');
    const event = new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      ctrlKey: true,
    });
    dom.window.document.dispatchEvent(event);

    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'od-edit-undo' }), '*');
    expect(event.defaultPrevented).toBe(false);

    dom.window.close();
  });

  it('does not forward undo keys while edit mode is disabled', () => {
    const dom = new JSDOM(
      `<main><h1 data-od-id="title">Title</h1></main>${buildManualEditBridge(false)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      ctrlKey: true,
    }));

    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'od-edit-undo' }), '*');

    dom.window.close();
  });
});

describe('manual edit bridge selection-state + rich-format bridge', () => {
  it('applies a rich-format command to the element currently being edited', async () => {
    const dom = new JSDOM(
      `<main><p data-od-source-path="path-0-0">Hello world</p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const p = dom.window.document.querySelector('p')!;
    const execCalls: string[] = [];
    dom.window.document.execCommand = (cmd: string) => { execCalls.push(cmd); return true; };
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'od-edit-mode', enabled: true } }));
    // Put the element into a rich edit session by clicking it.
    p.getBoundingClientRect = () => ({ x: 0, y: 0, width: 80, height: 20, top: 0, right: 80, bottom: 20, left: 0, toJSON: () => ({}) } as DOMRect);
    p.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => dom.window.setTimeout(r, 0));
    expect(p.getAttribute('data-od-editing')).toBe('true');

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'od-edit-rich-format', command: 'bold' } }));
    expect(execCalls).toContain('bold');
    dom.window.close();
  });

  it('ignores a rich-format command when no element is being edited', async () => {
    const dom = new JSDOM(
      `<main><p data-od-source-path="path-0-0">Hi</p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const execCalls: string[] = [];
    dom.window.document.execCommand = (cmd: string) => { execCalls.push(cmd); return true; };
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'od-edit-mode', enabled: true } }));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'od-edit-rich-format', command: 'bold' } }));
    expect(execCalls).toEqual([]);
    dom.window.close();
  });

  it('posts an editing:false selection state on selectionchange when nothing is being edited', async () => {
    const posts: Array<{ type?: string; editing?: boolean }> = [];
    const dom = new JSDOM(
      `<main><p data-od-source-path="path-0-0">Hi</p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((m: unknown) => { posts.push(m as { type?: string; editing?: boolean }); }) as typeof dom.window.parent.postMessage;
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'od-edit-mode', enabled: true } }));
    dom.window.document.dispatchEvent(new dom.window.Event('selectionchange'));
    const state = posts.find((m) => m.type === 'od-edit-selection-state');
    expect(state).toBeTruthy();
    expect(state?.editing).toBe(false);
    dom.window.close();
  });
});
