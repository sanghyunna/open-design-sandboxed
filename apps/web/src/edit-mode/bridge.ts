export const MANUAL_EDIT_DISCOVERY_SELECTOR = 'main, nav, section, article, header, footer, div, h1, h2, h3, h4, h5, h6, p, li, label, a, button, img, strong, span, small, em, b, i, u, s, mark, code, pre, time, abbr, cite, q, sub, sup, kbd, samp, var, dfn, ins, del, bdi, bdo, figcaption, caption, th, td, dt, dd, summary, output';
export const MANUAL_EDIT_SOURCE_PATH_ATTR = 'data-od-source-path';
const MANUAL_EDIT_INLINE_TEXT_WRAPPER_SELECTOR = 'strong, span, small, em, b, i, u, s, mark, code, time, abbr, cite, q, sub, sup, kbd, samp, var, dfn, ins, del, bdi, bdo';
const MANUAL_EDIT_TEXT_PASSAGE_SELECTOR = 'div, h1, h2, h3, h4, h5, h6, p, li, label, a, button, figcaption, caption, th, td, dt, dd, summary, output';
export const MANUAL_EDIT_HOST_NODE_SELECTOR = [
  '[data-od-sandbox-shim]',
  '[data-od-deck-bridge]',
  '[data-od-comment-bridge]',
  '[data-od-edit-bridge]',
  '[data-od-comment-bridge-style]',
  '[data-od-edit-bridge-style]',
  '[data-od-deck-fix]',
].join(',');

export function manualEditDomPathForElement(el: Element): string {
  const parts: number[] = [];
  let node: Element | null = el;
  while (node && node !== node.ownerDocument.body) {
    const parentEl: Element | null = node.parentElement;
    if (!parentEl) break;
    const children = Array.from(parentEl.children).filter((child) => !isManualEditHostNode(child));
    parts.unshift(children.indexOf(node));
    node = parentEl;
  }
  return parts.length ? `path-${parts.join('-')}` : '';
}

export function isManualEditHostNode(el: Element): boolean {
  return el.matches(MANUAL_EDIT_HOST_NODE_SELECTOR);
}

export function manualEditStableIdForElement(el: Element): string {
  const explicit = el.getAttribute('data-od-id');
  if (explicit) return explicit;
  const generated = el.getAttribute(MANUAL_EDIT_SOURCE_PATH_ATTR) || el.getAttribute('data-od-runtime-id') || manualEditDomPathForElement(el);
  if (generated) el.setAttribute('data-od-runtime-id', generated);
  return generated || 'unknown';
}

export function isMeaningfulManualEditElement(el: Element, rect: Pick<DOMRect, 'width' | 'height'>): boolean {
  return isSourceMappableManualEditElement(el)
    && el.matches(MANUAL_EDIT_DISCOVERY_SELECTOR)
    && !hasManualEditTextPassageAncestor(el)
    && rect.width >= 4
    && rect.height >= 4;
}

export function isSourceMappableManualEditElement(el: Element): boolean {
  return el.hasAttribute('data-od-id') || el.hasAttribute(MANUAL_EDIT_SOURCE_PATH_ATTR);
}

function hasManualEditTextPassageAncestor(el: Element): boolean {
  if (!el.matches(MANUAL_EDIT_INLINE_TEXT_WRAPPER_SELECTOR)) return false;
  let parent = el.parentElement;
  while (parent && parent !== parent.ownerDocument.body) {
    if (isSourceMappableManualEditElement(parent) && parent.matches(MANUAL_EDIT_TEXT_PASSAGE_SELECTOR)) return true;
    if (isSourceMappableManualEditElement(parent) && parent.matches(MANUAL_EDIT_DISCOVERY_SELECTOR)) return false;
    parent = parent.parentElement;
  }
  return false;
}

export function buildManualEditBridge(enabled: boolean): string {
  return `<script data-od-edit-bridge>(function(){
  var enabled = ${JSON.stringify(enabled)};
  var discoverySelector = ${JSON.stringify(MANUAL_EDIT_DISCOVERY_SELECTOR)};
  var hostNodeSelector = ${JSON.stringify(MANUAL_EDIT_HOST_NODE_SELECTOR)};
  var sourcePathAttr = ${JSON.stringify(MANUAL_EDIT_SOURCE_PATH_ATTR)};
  var textPassageSelector = ${JSON.stringify(MANUAL_EDIT_TEXT_PASSAGE_SELECTOR)};
  var styleProps = ['fontFamily','fontSize','fontWeight','color','textAlign','lineHeight','letterSpacing','width','height','minHeight','gap','flexDirection','justifyContent','alignItems','backgroundColor','opacity','padding','paddingTop','paddingRight','paddingBottom','paddingLeft','margin','marginTop','marginRight','marginBottom','marginLeft','border','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderStyle','borderColor','borderRadius'];
  var inlineTextWrapperTags = { strong:1, span:1, small:1, em:1, b:1, i:1, u:1, s:1, mark:1, code:1, time:1, abbr:1, cite:1, q:1, sub:1, sup:1, kbd:1, samp:1, var:1, dfn:1, ins:1, del:1, bdi:1, bdo:1 };
  function isHostNode(el){
    return !!(el && el.matches && el.matches(hostNodeSelector));
  }
  function domPath(el){
    var parts = [];
    var node = el;
    while (node && node !== document.body) {
      var parent = node.parentElement;
      if (!parent) break;
      var children = Array.prototype.slice.call(parent.children).filter(function(child){ return !isHostNode(child); });
      parts.unshift(children.indexOf(node));
      node = parent;
    }
    return parts.length ? 'path-' + parts.join('-') : '';
  }
  function stableId(el){
    var explicit = el.getAttribute('data-od-id');
    if (explicit) return explicit;
    var generated = el.getAttribute(sourcePathAttr) || el.getAttribute('data-od-runtime-id') || domPath(el);
    if (generated) el.setAttribute('data-od-runtime-id', generated);
    return generated || 'unknown';
  }
  function isSourceMappable(el){
    return !!(el && el.hasAttribute && (el.hasAttribute('data-od-id') || el.hasAttribute(sourcePathAttr)));
  }
  function isDiscoveryTarget(el){
    return !!(el && el.matches && el.matches(discoverySelector));
  }
  function isInlineTextWrapper(el){
    var tag = el && el.tagName ? el.tagName.toLowerCase() : '';
    return !!inlineTextWrapperTags[tag];
  }
  function textPassageParentTarget(el){
    if (!isInlineTextWrapper(el)) return null;
    var current = el.parentElement;
    while (current && current !== document.body && current !== document.documentElement) {
      if (isSourceMappable(current) && isDiscoveryTarget(current)) {
        return current.matches(textPassageSelector) ? current : null;
      }
      current = current.parentElement;
    }
    return null;
  }
  function targetForInlineText(el){
    return textPassageParentTarget(el) || el;
  }
  function hasElementChildren(el){
    for (var i = 0; i < el.children.length; i++) {
      if (!isHostNode(el.children[i])) return true;
    }
    return false;
  }
  function singleEditableTextNode(el){
    var textNode = null;
    function visit(node){
      var children = node.childNodes || [];
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (child.nodeType === 3) {
          if (!(child.textContent || '').trim()) continue;
          if (textNode) return false;
          textNode = child;
          continue;
        }
        if (child.nodeType === 1) {
          var tag = child.tagName ? child.tagName.toLowerCase() : '';
          if (!inlineTextWrapperTags[tag]) return false;
          if (!visit(child)) return false;
          continue;
        }
        if (child.nodeType === 8) continue;
        return false;
      }
      return true;
    }
    return visit(el) ? textNode : null;
  }
  function inferKind(el){
    var explicit = el.getAttribute('data-od-edit');
    if (explicit) return explicit;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'a') return 'link';
    if (tag === 'img') return 'image';
    if (['section','main','nav','div','article','header','footer'].indexOf(tag) >= 0) {
      return hasElementChildren(el) && !singleEditableTextNode(el) ? 'container' : 'text';
    }
    return 'text';
  }
  function labelFor(el, id, kind){
    var explicit = el.getAttribute('data-od-label');
    if (explicit) return explicit;
    var tag = el.tagName ? el.tagName.toLowerCase() : 'element';
    var text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) return text.slice(0, 42);
    if (kind === 'image') return el.getAttribute('alt') || id;
    return tag + ' #' + id;
  }
  function attrsFor(el){
    var attrs = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      if (!attr || attr.name.indexOf('data-od-runtime') === 0 || attr.name === 'data-od-edit-selected') continue;
      attrs[attr.name] = attr.value;
    }
    return attrs;
  }
  function stylesFor(el){
    var computed = window.getComputedStyle(el);
    var styles = {};
    styleProps.forEach(function(prop){ styles[prop] = el.style[prop] || computed[prop] || ''; });
    return styles;
  }
  function isLayoutContainer(el){
    var display = window.getComputedStyle(el).display || '';
    if (display.indexOf('flex') >= 0 || display.indexOf('grid') >= 0) return true;
    return hasOwnDisplayHiddenState(el) && inferKind(el) === 'container';
  }
  function hasOwnDisplayHiddenState(el){
    var computed = window.getComputedStyle(el);
    return computed.display === 'none' || el.hasAttribute('hidden');
  }
  function hasHiddenAncestorDisplayState(el){
    var node = el;
    while (node && node !== document.documentElement) {
      if (hasOwnDisplayHiddenState(node)) return true;
      node = node.parentElement;
    }
    return false;
  }
  function isHiddenTarget(el, rect){
    var targetVisibility = window.getComputedStyle(el).visibility;
    if (targetVisibility === 'hidden' || targetVisibility === 'collapse') return true;
    return hasHiddenAncestorDisplayState(el);
  }
  function targetFrom(el, includeOuterHtml){
    var rect = el.getBoundingClientRect();
    var kind = inferKind(el);
    var id = stableId(el);
    var hidden = isHiddenTarget(el, rect);
    var fields = {};
    if (kind === 'link') {
      fields.text = (el.textContent || '').trim();
      fields.href = el.getAttribute('href') || '';
    } else if (kind === 'image') {
      fields.src = el.getAttribute('src') || '';
      fields.alt = el.getAttribute('alt') || '';
    } else {
      fields.text = (el.textContent || '').trim();
    }
    return {
      id: id,
      kind: kind,
      label: labelFor(el, id, kind),
      tagName: el.tagName ? el.tagName.toLowerCase() : 'element',
      className: typeof el.className === 'string' ? el.className : '',
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 180),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      fields: fields,
      attributes: attrsFor(el),
      styles: stylesFor(el),
      isLayoutContainer: isLayoutContainer(el),
      isHidden: hidden,
      outerHtml: includeOuterHtml ? (el.outerHTML || '').replace(/\\sdata-od-runtime-id="[^"]*"/g, '').replace(/\\sdata-od-source-path="[^"]*"/g, '').replace(/\\sdata-od-edit-selected="[^"]*"/g, '') : ''
    };
  }
  function allTargets(){
    var nodes = document.body ? document.body.querySelectorAll(discoverySelector) : [];
    var targets = [];
    for (var i = 0; i < nodes.length; i++) {
      var rect = nodes[i].getBoundingClientRect();
      if (!isSourceMappable(nodes[i])) continue;
      if (targetForInlineText(nodes[i]) !== nodes[i]) continue;
      if (!isHiddenTarget(nodes[i], rect) && (rect.width < 4 || rect.height < 4)) continue;
      targets.push(targetFrom(nodes[i], false));
    }
    return targets;
  }
  function postTargets(){
    if (!enabled) return;
    window.parent.postMessage({ type: 'od-edit-targets', targets: allTargets() }, '*');
  }
  var lastHoverId = null;
  function postHoverTarget(el){
    if (!enabled || !el) return;
    var id = stableId(el);
    if (id === lastHoverId) return;
    lastHoverId = id;
    window.parent.postMessage({ type: 'od-edit-hover', target: targetFrom(el, true) }, '*');
  }
  function clearSelectedTarget(){
    var selected = document.querySelectorAll('[data-od-edit-selected]');
    for (var i = 0; i < selected.length; i++) selected[i].removeAttribute('data-od-edit-selected');
  }
  function setSelectedTarget(id){
    clearSelectedTarget();
    if (!id) return;
    var el = findById(id);
    if (el) el.setAttribute('data-od-edit-selected', 'true');
  }
  function closestTarget(event){
    var el = event.target;
    while (el && el !== document.documentElement) {
      if (el !== document.body && el !== document.documentElement && isSourceMappable(el) && isDiscoveryTarget(el)) {
        return targetForInlineText(el);
      }
      el = el.parentElement;
    }
    return null;
  }
  function currentSelectedRange(){
    try {
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      var range = sel.getRangeAt(0);
      return range.collapsed ? null : range;
    } catch (e) {
      return null;
    }
  }
  function targetForSelection(el){
    var range = currentSelectedRange();
    if (!range || !el) return el;
    if (el.contains(range.startContainer) && el.contains(range.endContainer)) return el;
    var node = range.commonAncestorContainer;
    var current = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    while (current && current !== document.documentElement) {
      if (current !== document.body && isSourceMappable(current) && isDiscoveryTarget(current) && current.contains(range.startContainer) && current.contains(range.endContainer)) return current;
      current = current.parentElement;
    }
    return el;
  }
  function caretRangeFromClick(clickEvent){
    try {
      if (document.caretPositionFromPoint) {
        var position = document.caretPositionFromPoint(clickEvent.clientX, clickEvent.clientY);
        if (!position) return null;
        var positionRange = document.createRange();
        positionRange.setStart(position.offsetNode, position.offset);
        positionRange.collapse(true);
        return positionRange;
      }
      if (document.caretRangeFromPoint) {
        return document.caretRangeFromPoint(clickEvent.clientX, clickEvent.clientY);
      }
    } catch (e) {}
    return null;
  }
  function placeCaretFromClick(clickEvent, el){
    var range = caretRangeFromClick(clickEvent);
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    try {
      var sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
  }
  var richFormatKeys = { b: 'strong', i: 'em', u: 'u' };
  function ancestorOfType(node, tagName, boundary){
    var current = node && node.nodeType === 1 ? node : (node ? node.parentNode : null);
    while (current && current !== boundary && current !== document.body) {
      if (current.tagName && current.tagName.toLowerCase() === tagName) return current;
      current = current.parentNode;
    }
    if (current && current === boundary && current.tagName && current.tagName.toLowerCase() === tagName) return current;
    return null;
  }
  function unwrapMatchingDescendants(root, tagName){
    // Flatten any same-tag elements inside a fragment so re-wrapping a selection
    // that spans a partially-formatted boundary does not produce nested tags.
    var matches = root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll(tagName)) : [];
    for (var i = 0; i < matches.length; i++) {
      var node = matches[i];
      var parent = node.parentNode;
      if (!parent) continue;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
    }
  }
  function selectNodes(first, last){
    if (!first || !last) return;
    try {
      var sel = window.getSelection();
      var range = document.createRange();
      range.setStartBefore(first);
      range.setEndAfter(last);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
  }
  function wrapSelectionRange(range, tagName){
    try {
      var wrapper = document.createElement(tagName);
      var contents = range.extractContents();
      unwrapMatchingDescendants(contents, tagName);
      wrapper.appendChild(contents);
      range.insertNode(wrapper);
      var sel = window.getSelection();
      var next = document.createRange();
      next.selectNodeContents(wrapper);
      sel.removeAllRanges();
      sel.addRange(next);
    } catch (e) {}
  }
  // Unwrap only the SELECTED slice of an existing inline wrapper, splitting the
  // wrapper into a still-formatted lead, the unformatted selection, and a
  // still-formatted trail. The trailing slice is extracted first so splitting
  // off the lead does not invalidate the live selection's start offset.
  function fragmentHasContent(frag){
    for (var i = 0; i < frag.childNodes.length; i++) {
      var node = frag.childNodes[i];
      if (node.nodeType === 1) return true;
      if (node.nodeType === 3 && (node.textContent || '').length > 0) return true;
    }
    return false;
  }
  function unwrapSelectionWithin(wrapper, range, tagName){
    var parent = wrapper.parentNode;
    if (!parent) return;
    try {
      var afterRange = document.createRange();
      afterRange.setStart(range.endContainer, range.endOffset);
      afterRange.setEnd(wrapper, wrapper.childNodes.length);
      var afterFrag = afterRange.extractContents();
      var beforeRange = document.createRange();
      beforeRange.setStart(wrapper, 0);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      var beforeFrag = beforeRange.extractContents();
      var out = document.createDocumentFragment();
      // Empty boundary slices (the zero-length text node a Range split leaves at
      // an edge) must not resurrect an empty <tag></tag>.
      if (fragmentHasContent(beforeFrag)) {
        var lead = document.createElement(tagName);
        lead.appendChild(beforeFrag);
        out.appendChild(lead);
      }
      var firstNode = null;
      var lastNode = null;
      while (wrapper.firstChild) {
        var child = wrapper.firstChild;
        if (!firstNode) firstNode = child;
        lastNode = child;
        out.appendChild(child);
      }
      if (fragmentHasContent(afterFrag)) {
        var trail = document.createElement(tagName);
        trail.appendChild(afterFrag);
        out.appendChild(trail);
      }
      parent.replaceChild(out, wrapper);
      selectNodes(firstNode, lastNode);
    } catch (e) {}
  }
  // Toggle an inline-format tag around the current selection. Wraps the selected
  // Range when it is not already inside that tag; otherwise unwraps only the
  // selected slice (leaving the unselected remainder formatted). Uses the
  // Selection/Range API rather than the deprecated document.execCommand.
  function toggleInlineFormat(tagName, boundary){
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    if (range.collapsed) return;
    var existing = ancestorOfType(range.commonAncestorContainer, tagName, boundary);
    if (existing) unwrapSelectionWithin(existing, range, tagName);
    else wrapSelectionRange(range, tagName);
  }
  function selectedRangeWithin(el){
    try {
      var range = currentSelectedRange();
      if (!range) return null;
      if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
      return range.cloneRange();
    } catch (e) {
      return null;
    }
  }
  function restoreSelectionRange(range){
    try {
      if (!range) return false;
      var sel = window.getSelection();
      if (!sel) return false;
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    } catch (e) {
      return false;
    }
  }
  function makeEditable(el, clickEvent){
    if (!el || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === 'plaintext-only') return;
    // Links (and any element the host routes here as a non-text leaf) stay on the
    // plain-text path: their inline label is the only editable surface and rich
    // markup would fight the panel's link/href fields. Everything else gets a
    // formatting-capable contenteditable so Ctrl/Cmd+B/U/I can produce markup.
    var rich = inferKind(el) === 'text';
    var originalText = el.textContent || '';
    var originalHtml = el.innerHTML;
    var selectedRange = selectedRangeWithin(el);
    clearSelectedTarget();
    el.setAttribute('contenteditable', rich ? 'true' : 'plaintext-only');
    el.setAttribute('data-od-editing', 'true');
    try { el.focus(); } catch (e) {}
    if (!restoreSelectionRange(selectedRange)) placeCaretFromClick(clickEvent, el);
    function finish(commit){
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-od-editing');
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKey);
      if (!commit) {
        if (rich) el.innerHTML = originalHtml;
        else el.textContent = originalText;
        return;
      }
      // Rich edits that introduced (or kept) inline markup commit the full inner
      // HTML so nested formatting and sibling markup survive; pure-text edits stay
      // on the lighter text-commit path the source patcher escapes safely.
      var hasMarkup = false;
      for (var i = 0; i < el.children.length; i++) {
        if (!isHostNode(el.children[i])) { hasMarkup = true; break; }
      }
      if (rich && hasMarkup) {
        var html = el.innerHTML;
        if (html !== originalHtml) {
          window.parent.postMessage({
            type: 'od-edit-html-commit',
            id: stableId(el),
            html: html
          }, '*');
        }
        return;
      }
      var value = (el.textContent || '').trim();
      if (value !== originalText.trim()) {
        window.parent.postMessage({
          type: 'od-edit-text-commit',
          id: stableId(el),
          value: value
        }, '*');
      }
    }
    function onBlur(){ finish(true); }
    function onKey(ev){
      if (rich && (ev.ctrlKey || ev.metaKey) && !ev.altKey) {
        var formatTag = richFormatKeys[(ev.key || '').toLowerCase()];
        if (formatTag) {
          ev.preventDefault();
          toggleInlineFormat(formatTag, el);
          return;
        }
      }
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        finish(true);
        try { el.blur(); } catch (e) {}
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(false);
        try { el.blur(); } catch (e) {}
      }
    }
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKey);
  }
  function camelToKebab(name){ return String(name).replace(/[A-Z]/g, function(m){ return '-' + m.toLowerCase(); }); }
  function cssEscapeId(value){ if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value); return String(value).replace(/"/g, '\\\\"'); }
  function findById(id){
    if (!id) return null;
    if (id === '__body__') return document.body;
    var el = document.querySelector('[data-od-id="' + cssEscapeId(id) + '"]')
          || document.querySelector('[data-od-runtime-id="' + cssEscapeId(id) + '"]')
          || document.querySelector('[' + sourcePathAttr + '="' + cssEscapeId(id) + '"]');
    if (el) return el;
    if (typeof id === 'string' && id.indexOf('path-') === 0) {
      var parts = id.slice('path-'.length).split('-').map(function(s){ return Number(s); });
      var node = document.body;
      for (var i = 0; i < parts.length; i++) {
        if (!node) return null;
        var idx = parts[i];
        if (!Number.isInteger(idx) || idx < 0) return null;
        var children = Array.prototype.slice.call(node.children).filter(function(c){ return !isHostNode(c); });
        node = children[idx] || null;
      }
      return node;
    }
    return null;
  }
  function applyPreviewStyles(id, styles, version){
    var el = findById(id);
    if (!el) {
      window.parent.postMessage({ type: 'od-edit-preview-style-applied', id: id || '', version: Number(version) || 0, ok: false, error: 'Target not found' }, '*');
      return;
    }
    var keys = Object.keys(styles || {});
    try {
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var value = styles[key];
        var cssName = camelToKebab(key);
        if (typeof value !== 'string' || value.trim() === '') el.style.removeProperty(cssName);
        else el.style.setProperty(cssName, value.trim());
      }
      window.parent.postMessage({ type: 'od-edit-preview-style-applied', id: id, version: Number(version) || 0, ok: true }, '*');
    } catch (e) {
      window.parent.postMessage({ type: 'od-edit-preview-style-applied', id: id, version: Number(version) || 0, ok: false, error: e && e.message ? String(e.message) : 'Could not apply preview styles' }, '*');
    }
  }
  window.addEventListener('message', function(ev){
    if (!ev.data) return;
    if (ev.data.type === 'od-edit-mode') {
      enabled = !!ev.data.enabled;
      document.documentElement.toggleAttribute('data-od-edit-mode', enabled);
      if (!enabled) clearSelectedTarget();
      if (enabled) setTimeout(postTargets, 0);
      return;
    }
    if (ev.data.type === 'od-edit-selected-target') {
      setSelectedTarget(ev.data.id || null);
      return;
    }
    if (ev.data.type === 'od-edit-hover-reset') {
      // Host signals the cursor truly left the canvas, so the next pointerover
      // re-announces the hovered element (defeats the per-element dedupe).
      lastHoverId = null;
      return;
    }
    if (ev.data.type === 'od-edit-preview-style') {
      applyPreviewStyles(ev.data.id, ev.data.styles || {}, ev.data.version);
      return;
    }
  });
  document.addEventListener('click', function(ev){
    if (!enabled) return;
    if (ev.target && ev.target.closest && ev.target.closest('[data-od-editing="true"]')) return;
    ev.preventDefault();
    ev.stopPropagation();
    var el = closestTarget(ev);
    if (!el) {
      // Clicking empty canvas (no source-mapped ancestor) is the gesture for
      // page-level styles; the host decides whether to surface the card.
      window.parent.postMessage({ type: 'od-edit-background' }, '*');
      return;
    }
    el = targetForSelection(el);
    var kind = inferKind(el);
    window.parent.postMessage({ type: 'od-edit-select', target: targetFrom(el, true) }, '*');
    if (kind === 'text' || kind === 'link') {
      makeEditable(el, ev);
      return;
    }
  }, true);
  document.addEventListener('pointerover', function(ev){
    if (!enabled) return;
    if (ev.target && ev.target.closest && ev.target.closest('[data-od-editing="true"]')) return;
    var el = closestTarget(ev);
    if (!el) return;
    postHoverTarget(el);
  }, true);
  window.addEventListener('resize', postTargets);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', postTargets);
  else setTimeout(postTargets, 0);
  document.documentElement.toggleAttribute('data-od-edit-mode', enabled);
})();</script>`;
}

export function buildManualEditBridgeStyle(): string {
  return `<style data-od-edit-bridge-style>
html[data-od-edit-mode] body * { cursor: pointer !important; }
html[data-od-edit-mode] [data-od-id],
html[data-od-edit-mode] [data-od-runtime-id],
html[data-od-edit-mode] [data-od-source-path] { outline: 1px dashed rgba(37, 99, 235, 0.35); outline-offset: 3px; }
html[data-od-edit-mode] :is(${MANUAL_EDIT_TEXT_PASSAGE_SELECTOR}) :is(${MANUAL_EDIT_INLINE_TEXT_WRAPPER_SELECTOR})[data-od-source-path] { outline: none; }
html[data-od-edit-mode] [data-od-id]:hover,
html[data-od-edit-mode] [data-od-runtime-id]:hover,
html[data-od-edit-mode] [data-od-source-path]:hover { outline: 2px solid #2563eb; }
html[data-od-edit-mode] :is(${MANUAL_EDIT_TEXT_PASSAGE_SELECTOR}) :is(${MANUAL_EDIT_INLINE_TEXT_WRAPPER_SELECTOR})[data-od-source-path]:hover { outline: none; }
html[data-od-edit-mode] [data-od-edit-selected] {
  outline: 2px solid #2563eb !important;
  outline-offset: 4px;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.16);
}
html[data-od-edit-mode] [data-od-editing="true"] {
  outline: 2px solid #2563eb !important;
  outline-offset: 4px;
  background: rgba(37, 99, 235, 0.06);
  cursor: text !important;
}
</style>`;
}
