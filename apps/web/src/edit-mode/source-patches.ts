import { emptyManualEditStyles, MANUAL_EDIT_STYLE_PROPS, type ManualEditFields, type ManualEditPatch, type ManualEditStyles } from './types';

export interface ManualEditPatchResult {
  ok: boolean;
  source: string;
  error?: string;
}

const INLINE_TEXT_WRAPPER_TAGS = new Set([
  'strong', 'span', 'small', 'em', 'b', 'i', 'u', 's', 'mark', 'code', 'time',
  'abbr', 'cite', 'q', 'sub', 'sup', 'kbd', 'samp', 'var', 'dfn', 'ins', 'del',
  'bdi', 'bdo',
]);

// Inline-formatting tags allowed to survive a `set-inner-html` save. This is the
// inline-text wrapper set plus the handful of formatting tags the rich-text edit
// bridge can produce (`<a>`, `<br>`). Everything else is light-normalized: tags
// outside this allowlist are unwrapped (their text is kept), `<script>`/`<style>`
// are dropped entirely, and event-handler attributes / `javascript:` URLs are
// stripped from the survivors.
const INLINE_HTML_ALLOWED_TAGS = new Set([
  ...INLINE_TEXT_WRAPPER_TAGS,
  'a', 'br',
]);

export function applyManualEditPatch(source: string, patch: ManualEditPatch): ManualEditPatchResult {
  if (patch.kind === 'set-full-source') return { ok: true, source: patch.source };

  const doc = parseSource(source);
  if (!doc) return { ok: false, source, error: 'Could not parse source.' };

  if (patch.kind === 'set-token') {
    const changed = setCssToken(doc, patch.token, patch.value);
    return changed
      ? { ok: true, source: serializeSource(doc, source) }
      : { ok: false, source, error: `Token not found: ${patch.token}` };
  }

  const el = findEditableElement(doc, patch.id);
  if (!el) return { ok: false, source, error: `Target not found: ${patch.id}` };

  if (patch.kind === 'set-text') {
    if (hasElementChildren(el)) {
      const textNode = singleEditableTextNode(el);
      if (!textNode) {
        return { ok: false, source, error: 'This element contains nested markup. Use the HTML tab instead.' };
      }
      textNode.textContent = patch.value;
    } else {
      el.textContent = patch.value;
    }
  } else if (patch.kind === 'set-link') {
    if (hasElementChildren(el)) {
      const currentText = el.textContent?.trim() ?? '';
      if (patch.text.trim() !== currentText) {
        return { ok: false, source, error: 'This link contains nested markup. Use the HTML tab to change its label.' };
      }
    } else {
      el.textContent = patch.text;
    }
    el.setAttribute('href', patch.href);
  } else if (patch.kind === 'set-image') {
    el.setAttribute('src', patch.src);
    el.setAttribute('alt', patch.alt);
  } else if (patch.kind === 'set-style') {
    setInlineStyles(el as HTMLElement, patch.styles);
  } else if (patch.kind === 'set-attributes') {
    setAttributes(el, patch.attributes);
  } else if (patch.kind === 'set-inner-html') {
    el.innerHTML = sanitizeInlineHtml(doc, patch.html);
  } else if (patch.kind === 'set-outer-html') {
    const replaced = replaceOuterHtml(doc, el, patch.html);
    if (!replaced.ok) {
      return {
        ok: false,
        source,
        error: 'error' in replaced ? replaced.error : 'Could not replace element HTML.',
      };
    }
  } else if (patch.kind === 'remove-element') {
    if (!el.parentElement) {
      return { ok: false, source, error: 'Cannot remove the root element.' };
    }
    if (el.parentElement === doc.body && doc.body.children.length === 1) {
      return { ok: false, source, error: 'Cannot remove the last element in the document.' };
    }
    el.remove();
  }

  return { ok: true, source: serializeSource(doc, source) };
}

export function readManualEditFields(source: string, id: string): ManualEditFields {
  const doc = parseSource(source);
  const el = doc ? findEditableElement(doc, id) : null;
  if (!el) return {};
  const kind = inferKind(el);
  if (kind === 'link') {
    return {
      text: el.textContent?.trim() ?? '',
      href: el.getAttribute('href') ?? '',
    };
  }
  if (kind === 'image') {
    return {
      src: el.getAttribute('src') ?? '',
      alt: el.getAttribute('alt') ?? '',
    };
  }
  return { text: el.textContent?.trim() ?? '' };
}

export function readManualEditStyles(source: string, id: string): ManualEditStyles {
  const doc = parseSource(source);
  const el = doc ? findEditableElement(doc, id) : null;
  if (!el) return emptyManualEditStyles();
  const style = (el as HTMLElement).style;
  return MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    acc[key] = (style[key as unknown as keyof CSSStyleDeclaration] as string | undefined) ?? '';
    return acc;
  }, {} as ManualEditStyles);
}

export function readManualEditAttributes(source: string, id: string): Record<string, string> {
  const doc = parseSource(source);
  const el = doc ? findEditableElement(doc, id) : null;
  if (!el) return {};
  const attrs: Record<string, string> = {};
  Array.from(el.attributes).forEach((attr) => {
    if (attr.name === 'data-od-runtime-id') return;
    attrs[attr.name] = attr.value;
  });
  return attrs;
}

export function readManualEditOuterHtml(source: string, id: string): string {
  const doc = parseSource(source);
  return (doc ? findEditableElement(doc, id)?.outerHTML : '') ?? '';
}

function parseSource(source: string): Document | null {
  if (typeof DOMParser !== 'undefined') {
    return new DOMParser().parseFromString(source, 'text/html');
  }
  if (typeof document !== 'undefined') {
    const doc = document.implementation.createHTMLDocument('');
    doc.documentElement.innerHTML = source;
    return doc;
  }
  return null;
}

function serializeSource(doc: Document, originalSource: string): string {
  if (!isManualEditFullHtmlDocument(originalSource)) return doc.body.innerHTML;
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

export function isManualEditFullHtmlDocument(source: string): boolean {
  const normalized = firstSourceToken(source).slice(0, 32).toLowerCase();
  return normalized.startsWith('<!doctype') || normalized.startsWith('<html');
}

function firstSourceToken(source: string): string {
  let rest = source.trimStart();
  while (rest.startsWith('<!--') || rest.startsWith('<?')) {
    const close = rest.startsWith('<!--') ? '-->' : '?>';
    const end = rest.indexOf(close);
    if (end === -1) return rest;
    rest = rest.slice(end + close.length).trimStart();
  }
  return rest;
}

function inferKind(el: Element): 'text' | 'link' | 'image' | 'container' {
  const explicit = el.getAttribute('data-od-edit');
  if (explicit === 'text' || explicit === 'link' || explicit === 'image' || explicit === 'container') return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'img') return 'image';
  if (['section', 'main', 'nav', 'div', 'article', 'header', 'footer'].includes(tag)) {
    return hasElementChildren(el) && !singleEditableTextNode(el) ? 'container' : 'text';
  }
  return 'text';
}

function findEditableElement(doc: Document, id: string): Element | null {
  if (id === '__body__') return doc.body;
  return (
    doc.querySelector(`[data-od-id="${cssEscape(id)}"]`) ??
    doc.querySelector(`[data-od-runtime-id="${cssEscape(id)}"]`) ??
    doc.querySelector(`[data-od-source-path="${cssEscape(id)}"]`) ??
    findElementByPath(doc, id)
  );
}

function findElementByPath(doc: Document, id: string): Element | null {
  if (!id.startsWith('path-')) return null;
  const indexes = id
    .slice('path-'.length)
    .split('-')
    .map((part) => Number(part));
  if (indexes.some((index) => !Number.isInteger(index) || index < 0)) return null;
  let current: Element | null = doc.body;
  for (const index of indexes) {
    current = current?.children.item(index) ?? null;
    if (!current) return null;
  }
  return current;
}

function hasElementChildren(el: Element): boolean {
  return Array.from(el.children).some((child) => child.nodeType === 1);
}

function singleEditableTextNode(el: Element): Text | null {
  let textNode: Text | null = null;
  const visit = (node: Node): boolean => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        if (!child.textContent?.trim()) continue;
        if (textNode) return false;
        textNode = child as Text;
        continue;
      }
      if (child.nodeType === 1) {
        const childEl = child as Element;
        if (!INLINE_TEXT_WRAPPER_TAGS.has(childEl.tagName.toLowerCase())) return false;
        if (!visit(child)) return false;
        continue;
      }
      if (child.nodeType === 8) continue;
      return false;
    }
    return true;
  };
  return visit(el) ? textNode : null;
}

function setInlineStyles(el: HTMLElement, styles: Partial<ManualEditStyles>): void {
  for (const [name, value] of Object.entries(styles)) {
    const cssName = camelToKebab(name);
    if (typeof value !== 'string' || value.trim() === '') el.style.removeProperty(cssName);
    else el.style.setProperty(cssName, value.trim());
  }
}

function setAttributes(el: Element, attributes: Record<string, string>): void {
  const protectedAttrs = new Set(['data-od-id', 'data-od-edit', 'data-od-label', 'data-od-runtime-id']);
  for (const [name, value] of Object.entries(attributes)) {
    if (!isSafeAttributeName(name) || protectedAttrs.has(name)) continue;
    if (value.trim() === '') el.removeAttribute(name);
    else el.setAttribute(name, value);
  }
}

// URL schemes allowed to survive on `href`/`src` after a rich-text save. Anything
// outside this set (and any scheme-less URL: relative, anchor, `/`-rooted, or
// scheme-relative `//host`) is treated below; unknown schemes (`data:`,
// `vbscript:`, `file:`, `javascript:`, …) get the URL-bearing attribute dropped.
const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'ftp']);

// Decide whether a URL attribute value is safe to keep. DOMParser has already
// entity-decoded the value, so `&#106;avascript:` arrives as `javascript:`. We
// additionally strip ASCII control/whitespace characters before the scheme test
// so interior-obfuscated schemes (`ja\tvascript:`, newline-split) are caught.
function isSafeUrlValue(value: string): boolean {
  const stripped = value.replace(/[\u0000-\u0020]+/g, '');
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(stripped);
  if (!schemeMatch) return true; // relative / anchor / `/`-rooted / `//host`
  return SAFE_URL_SCHEMES.has((schemeMatch[1] ?? '').toLowerCase());
}

// Light, dependency-free normalization for rich-text inner HTML. The goal is
// clean inline markup; blocking obvious script injection is a bonus rather than a
// hardened security boundary. We allowlist inline-formatting tags, unwrap unknown
// tags (keeping their text), remove `<script>`/`<style>` outright, and strip
// `on*` handlers plus URLs whose scheme is not on the safe allowlist from the
// tags we keep.
function sanitizeInlineHtml(doc: Document, html: string): string {
  const template = doc.createElement('template');
  template.innerHTML = html;
  // Pre-order (parents before children) so unwrapping a parent still lets the
  // surviving children get visited in the same static snapshot.
  const elements = Array.from(template.content.querySelectorAll('*'));
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') {
      el.remove();
      continue;
    }
    if (!INLINE_HTML_ALLOWED_TAGS.has(tag)) {
      unwrapElement(el);
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if ((name === 'href' || name === 'src') && !isSafeUrlValue(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return template.innerHTML;
}

function unwrapElement(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function replaceOuterHtml(doc: Document, el: Element, html: string): { ok: true } | { ok: false; error: string } {
  const template = doc.createElement('template');
  template.innerHTML = html.trim();
  const elements = Array.from(template.content.children);
  if (elements.length !== 1) return { ok: false, error: 'Replacement HTML must contain exactly one root element.' };
  const next = elements[0]!;
  if (el.getAttribute('data-od-id') && !next.getAttribute('data-od-id')) {
    next.setAttribute('data-od-id', el.getAttribute('data-od-id') ?? '');
  }
  if (el.getAttribute('data-od-edit') && !next.getAttribute('data-od-edit')) {
    next.setAttribute('data-od-edit', el.getAttribute('data-od-edit') ?? '');
  }
  el.replaceWith(next);
  return { ok: true };
}

function setCssToken(doc: Document, token: string, value: string): boolean {
  const styles = Array.from(doc.querySelectorAll('style'));
  const pattern = new RegExp(`(${escapeRegExp(token)}\\s*:\\s*)([^;]+)(;)`);
  for (const style of styles) {
    const text = style.textContent ?? '';
    if (!pattern.test(text)) continue;
    style.textContent = text.replace(pattern, `$1${value}$3`);
    return true;
  }
  return false;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return value.replace(/"/g, '\\"');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function isSafeAttributeName(value: string): boolean {
  return /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/.test(value);
}
