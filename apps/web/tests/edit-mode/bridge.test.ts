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

    expect(bridge).toContain('targets.push(targetFrom(nodes[i], false))');
    expect(bridge).toContain("target: targetFrom(el, true)");
    expect(bridge).toContain('if (!isSourceMappable(nodes[i])) continue;');
    expect(bridge).toContain('return el;');
    expect(bridge).not.toContain('if (isPrimaryTarget(el)) return el;');
  });

  it('prefers the deepest source-mapped child over an annotated group on hover', async () => {
    const posts: Array<{ type?: string; target?: { id: string; label?: string } }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-id="hero-group">
          <span data-od-source-path="path-0-0-0">Small label</span>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const span = dom.window.document.querySelector('span')!;
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; target?: { id: string; label?: string } });
    }) as typeof dom.window.parent.postMessage;

    span.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));

    const hover = posts.find((message) => message.type === 'od-edit-hover');
    expect(hover?.target?.id).toBe('path-0-0-0');
    expect(hover?.target?.label).toBe('Small label');

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
    expect(bridge).toContain('version: Number(version) || 0, ok: true');
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
      }),
    }, '*');

    dom.window.close();
  });

  it('cancels inline text edits with Escape without posting a commit', () => {
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

    expect(body.textContent).toBe('Original body');
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'od-edit-text-commit',
    }), '*');

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

  it('wraps the selection in <strong> on Ctrl+B and commits rich html', () => {
    const dom = new JSDOM(
      `<main><p data-od-id="copy">Hello world</p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const win = dom.window as unknown as Window & typeof globalThis;
    const copy = dom.window.document.querySelector('[data-od-id="copy"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    copy.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    selectContents(win, copy);

    copy.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'b',
      ctrlKey: true,
    }));

    expect(copy.querySelector('strong')).not.toBeNull();
    expect(copy.innerHTML).toContain('<strong>');

    copy.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: false }));

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'od-edit-html-commit', id: 'copy' }),
      '*',
    );

    dom.window.close();
  });

  it('toggles formatting off when Ctrl+I is pressed inside an existing wrapper', () => {
    const dom = new JSDOM(
      `<main><p data-od-id="copy"><em>Slanted</em></p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const win = dom.window as unknown as Window & typeof globalThis;
    const copy = dom.window.document.querySelector('[data-od-id="copy"]') as HTMLElement;

    copy.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    const em = copy.querySelector('em') as HTMLElement;
    selectContents(win, em);

    copy.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'i',
      ctrlKey: true,
    }));

    expect(copy.querySelector('em')).toBeNull();
    expect(copy.textContent).toBe('Slanted');

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

    copy.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'b',
      ctrlKey: true,
    }));

    expect(copy.innerHTML).toBe('<strong>Hello</strong> world');

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

    copy.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'b',
      ctrlKey: true,
    }));

    expect(copy.textContent).toBe('Hello world');
    expect(copy.querySelector('strong')?.textContent).toBe('Hello world');

    dom.window.close();
  });

  it('unwraps only the selected slice inside an existing wrapper (Ctrl+B on "world")', () => {
    const dom = new JSDOM(
      `<main><p data-od-id="copy"><strong>hello world</strong></p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const win = dom.window as unknown as Window & typeof globalThis;
    const copy = dom.window.document.querySelector('[data-od-id="copy"]') as HTMLElement;

    copy.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    const strongText = copy.querySelector('strong')!.firstChild!; // Text "hello world"
    selectTextRange(win, strongText, 6, 11); // "world"

    copy.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'b',
      ctrlKey: true,
    }));

    // Only "world" loses formatting; "hello " stays bold.
    expect(copy.innerHTML).toBe('<strong>hello </strong>world');
    expect(copy.textContent).toBe('hello world');

    dom.window.close();
  });

  it('wraps only the selected slice of plain text (Ctrl+B on "world")', () => {
    const dom = new JSDOM(
      `<main><p data-od-id="copy">hello world</p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const win = dom.window as unknown as Window & typeof globalThis;
    const copy = dom.window.document.querySelector('[data-od-id="copy"]') as HTMLElement;

    copy.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    const textNode = copy.firstChild!; // Text "hello world"
    selectTextRange(win, textNode, 6, 11); // "world"

    copy.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'b',
      ctrlKey: true,
    }));

    expect(copy.innerHTML).toBe('hello <strong>world</strong>');
    expect(copy.textContent).toBe('hello world');

    dom.window.close();
  });

  it('wraps a selection that spans a wrapped/unwrapped boundary without nesting', () => {
    const dom = new JSDOM(
      `<main><p data-od-id="copy"><strong>hello</strong> world</p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const win = dom.window as unknown as Window & typeof globalThis;
    const copy = dom.window.document.querySelector('[data-od-id="copy"]') as HTMLElement;

    copy.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    const strongText = copy.querySelector('strong')!.firstChild!; // "hello"
    const tailText = copy.lastChild!; // " world"
    const sel = win.getSelection();
    const range = win.document.createRange();
    range.setStart(strongText, 2); // mid "hello" -> "llo"
    range.setEnd(tailText, 6); // end of " world"
    sel?.removeAllRanges();
    sel?.addRange(range);

    copy.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'b',
      ctrlKey: true,
    }));

    // Whole selection ends up bold; no <strong> is nested inside another.
    expect(copy.textContent).toBe('hello world');
    expect(copy.querySelector('strong strong')).toBeNull();
    expect(copy.innerHTML).toBe('<strong>he</strong><strong>llo world</strong>');

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
