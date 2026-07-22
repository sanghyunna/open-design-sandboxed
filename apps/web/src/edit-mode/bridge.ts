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
  var styleProps = ['fontFamily','fontSize','fontWeight','color','textAlign','lineHeight','letterSpacing','width','height','minHeight','translate','gap','flexDirection','justifyContent','alignItems','flex','backgroundColor','opacity','padding','paddingTop','paddingRight','paddingBottom','paddingLeft','margin','marginTop','marginRight','marginBottom','marginLeft','border','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderStyle','borderColor','borderRadius'];
  var authoredSizeProbeSeq = 0;
  var inlineTextWrapperTags = { strong:1, span:1, small:1, em:1, b:1, i:1, u:1, s:1, mark:1, code:1, time:1, abbr:1, cite:1, q:1, sub:1, sup:1, kbd:1, samp:1, var:1, dfn:1, ins:1, del:1, bdi:1, bdo:1 };
  var decorativeTextlessTags = { div:1, svg:1, g:1, path:1, circle:1, ellipse:1, rect:1, line:1, polyline:1, polygon:1, defs:1, lineargradient:1, radialgradient:1, stop:1, clippath:1, mask:1, use:1 };
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
  function hasStructuredEditableText(el){
    var hasText = false;
    var children = el.childNodes || [];
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.nodeType === 3) {
        if ((child.textContent || '').trim()) hasText = true;
        continue;
      }
      if (child.nodeType === 1) {
        if (isHostNode(child)) continue;
        var tag = child.tagName ? child.tagName.toLowerCase() : '';
        if (inlineTextWrapperTags[tag]) {
          if ((child.textContent || '').trim()) hasText = true;
          continue;
        }
        if (!decorativeTextlessTags[tag] || (child.textContent || '').trim()) return false;
        continue;
      }
      if (child.nodeType === 8) continue;
      return false;
    }
    return hasText;
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
  function flexItemAxisFor(el){
    // Main axis of the parent flex container: 'row' means width is flex-owned,
    // 'column' means height is. Main-axis drag commits pin the item (flex:
    // none) so the written size holds against flex-grow/shrink.
    var parent = el.parentElement;
    if (!parent) return null;
    var display = window.getComputedStyle(parent).display;
    if (display !== 'flex' && display !== 'inline-flex') return null;
    var direction = window.getComputedStyle(parent).flexDirection || 'row';
    return direction.indexOf('column') === 0 ? 'column' : 'row';
  }
  function rectScaleAxis(rectSize, layoutSize){
    // offsetWidth/offsetHeight are layout (pre-transform) border-box px, so
    // rect/offset isolates the accumulated ancestor transform scale without
    // conflating box-sizing padding/borders. SVG and inline elements report
    // no usable offset size; treat them as unscaled.
    if (!layoutSize || !isFinite(layoutSize) || layoutSize <= 0) return 1;
    var k = rectSize / layoutSize;
    if (!isFinite(k) || k <= 0) return 1;
    return Math.round(k * 10000) / 10000;
  }
  function cssSizeFor(el){
    // Post-layout computed width/height: the used px values, unlike inline
    // styles which layout may clamp or ignore. Resize-drag baseline data.
    var computed = window.getComputedStyle(el);
    return { width: computed.width || '', height: computed.height || '' };
  }
  function mediaTextFor(media){
    if (!media) return '';
    if (typeof media === 'string') return media.trim();
    return typeof media.mediaText === 'string' ? media.mediaText.trim() : '';
  }
  function wrapRulesForMedia(rules, media){
    var text = mediaTextFor(media);
    if (!rules || !text || text.toLowerCase() === 'all') return rules;
    return '@media ' + text + '{' + rules + '}';
  }
  function authoredCssValueFor(el, propertyName){
    // getComputedStyle only exposes the USED value, so an undeclared auto
    // width and a stylesheet-authored 320px width both look like px. Mirror
    // every author declaration onto a unique custom property and let the
    // browser's own cascade choose the winner (specificity, !important,
    // active @media/@supports/@container rules, and inline style included).
    // The zero-specificity marker declaration prevents a matching ancestor's
    // custom property from inheriting onto a target whose width is actually
    // undeclared.
    authoredSizeProbeSeq += 1;
    var probeName = '--od-authored-size-' + authoredSizeProbeSeq;
    var markerName = 'data-od-authored-size-probe';
    var markerValue = 'p' + authoredSizeProbeSeq;
    var values = [''];
    function declarationRule(selector, declaration){
      if (!declaration || !declaration.getPropertyValue) return '';
      var value = declaration.getPropertyValue(propertyName);
      if (!value || !value.trim()) return '';
      values.push(value.trim());
      var priority = declaration.getPropertyPriority(propertyName) === 'important' ? ' !important' : '';
      return selector + '{' + probeName + ':' + (values.length - 1) + priority + ';}';
    }
    function mirroredRules(ruleList){
      var output = '';
      if (!ruleList) return output;
      for (var i = 0; i < ruleList.length; i++) {
        var rule = ruleList[i];
        if (!rule) continue;
        if (rule.type === 1 && rule.selectorText && rule.style) {
          output += declarationRule(rule.selectorText, rule.style);
          continue;
        }
        if (rule.type === 3 && rule.styleSheet) {
          try {
            output += wrapRulesForMedia(mirroredRules(rule.styleSheet.cssRules), rule.media);
          } catch (_importError) {}
          continue;
        }
        if (!rule.cssRules) continue;
        var cssText = rule.cssText || '';
        var brace = cssText.indexOf('{');
        var header = brace >= 0 ? cssText.slice(0, brace).trim() : '';
        if (!/^@(media|supports|container|layer|scope|starting-style)\\b/i.test(header)) continue;
        var inner = mirroredRules(rule.cssRules);
        if (inner) output += header + '{' + inner + '}';
      }
      return output;
    }
    var previousMarker = el.getAttribute(markerName);
    var previousProbe = el.style.getPropertyValue(probeName);
    var previousProbePriority = el.style.getPropertyPriority(probeName);
    var probeStyle = document.createElement('style');
    probeStyle.setAttribute('data-od-authored-size-probe-style', '');
    try {
      el.setAttribute(markerName, markerValue);
      var css = ':where([' + markerName + '=\"' + markerValue + '\"]){' + probeName + ':0;}';
      var sheets = Array.prototype.slice.call(document.styleSheets || []);
      for (var sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
        var sheet = sheets[sheetIndex];
        if (!sheet || sheet.disabled) continue;
        try {
          var sheetRules = mirroredRules(sheet.cssRules);
          var sheetMedia = mediaTextFor(sheet.media);
          if (!sheetMedia && sheet.ownerNode && typeof sheet.ownerNode.media === 'string') {
            sheetMedia = sheet.ownerNode.media.trim();
          }
          css += wrapRulesForMedia(sheetRules, sheetMedia);
        } catch (_sheetError) {}
      }
      probeStyle.textContent = css;
      (document.head || document.documentElement).appendChild(probeStyle);
      var inlineValue = el.style.getPropertyValue(propertyName);
      if (inlineValue && inlineValue.trim()) {
        values.push(inlineValue.trim());
        el.style.setProperty(
          probeName,
          String(values.length - 1),
          el.style.getPropertyPriority(propertyName),
        );
      }
      var winner = Number.parseInt(window.getComputedStyle(el).getPropertyValue(probeName).trim(), 10);
      return Number.isInteger(winner) && winner > 0 ? values[winner] || '' : '';
    } finally {
      probeStyle.remove();
      if (previousProbe) el.style.setProperty(probeName, previousProbe, previousProbePriority);
      else el.style.removeProperty(probeName);
      if (previousMarker === null) el.removeAttribute(markerName);
      else el.setAttribute(markerName, previousMarker);
    }
  }
  function htmlSizeHintFor(el, propertyName){
    if (!el.tagName || el.tagName.toLowerCase() !== 'img') return '';
    var raw = el.getAttribute && el.getAttribute(propertyName);
    if (!raw) return '';
    var value = raw.trim();
    if (!/^\\d+$/.test(value)) return '';
    var numeric = Number.parseInt(value, 10);
    return Number.isFinite(numeric) ? numeric + 'px' : '';
  }
  function authoredSizeFor(el){
    var width = authoredCssValueFor(el, 'width');
    var height = authoredCssValueFor(el, 'height');
    return {
      width: width || htmlSizeHintFor(el, 'width'),
      height: height || htmlSizeHintFor(el, 'height')
    };
  }
  function targetFrom(el, includeOuterHtml, includeAuthoredSize){
    var rect = el.getBoundingClientRect();
    var kind = inferKind(el);
    var id = stableId(el);
    var textEditTarget = kind === 'container' && hasStructuredEditableText(el) ? el : null;
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
    var target = {
      id: id,
      kind: kind,
      label: labelFor(el, id, kind),
      tagName: el.tagName ? el.tagName.toLowerCase() : 'element',
      className: typeof el.className === 'string' ? el.className : '',
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 180),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      rectScale: { x: rectScaleAxis(rect.width, el.offsetWidth), y: rectScaleAxis(rect.height, el.offsetHeight) },
      cssSize: cssSizeFor(el),
      flexItemAxis: flexItemAxisFor(el),
      textEditTargetId: textEditTarget ? stableId(textEditTarget) : undefined,
      fields: fields,
      attributes: attrsFor(el),
      styles: stylesFor(el),
      isLayoutContainer: isLayoutContainer(el),
      isHidden: hidden,
      outerHtml: includeOuterHtml ? (el.outerHTML || '').replace(/\\sdata-od-runtime-id="[^"]*"/g, '').replace(/\\sdata-od-source-path="[^"]*"/g, '').replace(/\\sdata-od-edit-selected="[^"]*"/g, '') : ''
    };
    // Only selected targets need cascade provenance for the inspector;
    // discovery and hover broadcasts intentionally skip the CSSOM probe.
    if (includeAuthoredSize) target.authoredSize = authoredSizeFor(el);
    return target;
  }
  function allTargets(){
    var nodes = document.body ? document.body.querySelectorAll(discoverySelector) : [];
    var targets = [];
    for (var i = 0; i < nodes.length; i++) {
      var rect = nodes[i].getBoundingClientRect();
      if (!isSourceMappable(nodes[i])) continue;
      if (targetForInlineText(nodes[i]) !== nodes[i]) continue;
      if (!isHiddenTarget(nodes[i], rect) && (rect.width < 4 || rect.height < 4)) continue;
      targets.push(targetFrom(nodes[i], false, false));
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
    window.parent.postMessage({ type: 'od-edit-hover', target: targetFrom(el, true, false) }, '*');
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
  function ancestorTarget(el){
    while (el && el !== document.documentElement) {
      if (el !== document.body && el !== document.documentElement && isSourceMappable(el) && isDiscoveryTarget(el)) {
        return targetForInlineText(el);
      }
      el = el.parentElement;
    }
    return null;
  }
  function closestTarget(event){
    return ancestorTarget(event.target);
  }
  function targetsAtPoint(x, y){
    if (!document.elementsFromPoint) return [];
    var nodes = document.elementsFromPoint(x, y) || [];
    var targets = [];
    for (var i = 0; i < nodes.length; i++) {
      var target = ancestorTarget(nodes[i]);
      if (!target || targets.indexOf(target) >= 0) continue;
      targets.push(target);
    }
    return targets;
  }
  var clickCycle = null;
  var clickCycleTolerance = 4;
  function resetClickCycle(){
    clickCycle = null;
  }
  function stackSignature(stack){
    return stack.map(function(el){ return stableId(el); }).join('\\n');
  }
  function sameClickCycle(x, y, signature){
    return clickCycle
      && Math.abs(clickCycle.x - x) <= clickCycleTolerance
      && Math.abs(clickCycle.y - y) <= clickCycleTolerance
      && clickCycle.signature === signature;
  }
  function clickTarget(event){
    var stack = targetsAtPoint(event.clientX, event.clientY);
    if (!stack.length) {
      var fallback = closestTarget(event);
      if (fallback) stack = [fallback];
    }
    if (!stack.length) {
      resetClickCycle();
      return { el: null, cycled: false };
    }
    var signature = stackSignature(stack);
    var cycled = sameClickCycle(event.clientX, event.clientY, signature);
    var index = cycled
      ? (clickCycle.index + 1) % stack.length
      : (event.altKey && stack.length > 1 ? 1 : 0);
    clickCycle = { x: event.clientX, y: event.clientY, signature: signature, index: index };
    return { el: stack[index], cycled: cycled };
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
  // execCommand is deprecated, but it is the only formatting path integrated
  // with the browser's native undo manager: raw Range/DOM surgery on a live
  // focused contenteditable corrupts that undo stack (Ctrl+Z stops undoing
  // anything at or before the surgery point for the rest of the session).
  var richFormatCommands = { b: 'bold', i: 'italic', u: 'underline' };
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
  function richEditingEl(){
    var el = document.querySelector('[data-od-editing="true"]');
    return (el && el.getAttribute('contenteditable') === 'true') ? el : null;
  }
  function postSelectionState(){
    if (!enabled) return;
    var el = richEditingEl();
    if (!el) {
      window.parent.postMessage({ type: 'od-edit-selection-state', editing: false, hasSelection: false, bold: false, italic: false, underline: false }, '*');
      return;
    }
    var range = currentSelectedRange();
    var within = !!(range && el.contains(range.startContainer) && el.contains(range.endContainer));
    function q(cmd){ try { return !!document.queryCommandState(cmd); } catch (e) { return false; } }
    window.parent.postMessage({ type: 'od-edit-selection-state', editing: true, hasSelection: within, bold: q('bold'), italic: q('italic'), underline: q('underline') }, '*');
  }
  function applyRichFormat(command){
    if (command !== 'bold' && command !== 'italic' && command !== 'underline') return;
    var el = richEditingEl();
    if (!el) return;
    try { el.focus(); } catch (e) {}
    try { document.execCommand(command); } catch (e) {}
    postSelectionState();
  }
  function makeEditable(el, clickEvent){
    if (!el || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === 'plaintext-only') return;
    // Links (and any element the host routes here as a non-text leaf) stay on the
    // plain-text path: their inline label is the only editable surface and rich
    // markup would fight the panel's link/href fields. Everything else gets a
    // formatting-capable contenteditable so Ctrl/Cmd+B/U/I can produce markup.
    var kind = inferKind(el);
    var rich = kind === 'text' || (kind !== 'link' && hasStructuredEditableText(el));
    var originalText = el.textContent || '';
    var originalHtml = el.innerHTML;
    var selectedRange = selectedRangeWithin(el);
    clearSelectedTarget();
    resetClickCycle();
    el.setAttribute('contenteditable', rich ? 'true' : 'plaintext-only');
    el.setAttribute('data-od-editing', 'true');
    // Chromium's execCommand defaults to inline style spans; turning this off
    // once per session makes B/I/U emit <b>/<i>/<u> tags instead.
    if (rich) { try { document.execCommand('styleWithCSS', false, 'false'); } catch (e) {} }
    try { el.focus(); } catch (e) {}
    if (!restoreSelectionRange(selectedRange)) placeCaretFromClick(clickEvent, el);
    if (rich) postSelectionState();
    function finish(commit){
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-od-editing');
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKey);
      postSelectionState();
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
        var formatCommand = richFormatCommands[(ev.key || '').toLowerCase()];
        if (formatCommand) {
          ev.preventDefault();
          try { document.execCommand(formatCommand); } catch (e) {}
          postSelectionState();
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
        finish(true); // PPT: Esc commits typed text and promotes to object-select; undo stays on host Ctrl+Z
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
  function applyPreviewStyles(id, styles, version, includeAuthoredSize){
    var el = findById(id);
    if (!el) {
      window.parent.postMessage({ type: 'od-edit-preview-style-applied', id: id || '', version: Number(version) || 0, ok: false, error: 'Target not found' }, '*');
      return;
    }
    var keys = Object.keys(styles || {});
    // Mute window: live preview streams one inline-style write per frame during
    // a drag; without it the layout observer below would echo a full
    // od-edit-targets post per frame. queuePostTargets DEFERS (not drops) the
    // muted echo, so one coalesced re-broadcast still lands after the stream
    // quiets; mid-drag the per-frame ack below carries the fresh rect instead.
    suppressObservedLayoutUntil = Date.now() + 64;
    try {
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var value = styles[key];
        var cssName = camelToKebab(key);
        if (typeof value !== 'string' || value.trim() === '') el.style.removeProperty(cssName);
        else el.style.setProperty(cssName, value.trim());
      }
      // Post-apply measurement: the host renders resize handles from the
      // element's REAL box (flex/grid/min-content can clamp or ignore the
      // requested size), so every ack feeds the applied geometry back.
      var applied = el.getBoundingClientRect();
      var appliedMessage = {
        type: 'od-edit-preview-style-applied',
        id: id,
        version: Number(version) || 0,
        ok: true,
        rect: { x: Math.round(applied.x), y: Math.round(applied.y), width: Math.round(applied.width), height: Math.round(applied.height) },
        cssSize: cssSizeFor(el)
      };
      if (includeAuthoredSize) appliedMessage.authoredSize = authoredSizeFor(el);
      window.parent.postMessage(appliedMessage, '*');
    } catch (e) {
      window.parent.postMessage({ type: 'od-edit-preview-style-applied', id: id, version: Number(version) || 0, ok: false, error: e && e.message ? String(e.message) : 'Could not apply preview styles' }, '*');
    }
  }
  function handleClick(event){
    var result = clickTarget(event);
    var el = result.el;
    if (!el) {
      resetClickCycle();
      // Clicking empty canvas (no source-mapped ancestor) is the gesture for
      // page-level styles; the host decides whether to surface the card.
      window.parent.postMessage({ type: 'od-edit-background' }, '*');
      return;
    }
    el = targetForSelection(el);
    var kind = inferKind(el);
    setSelectedTarget(stableId(el));
    window.parent.postMessage({ type: 'od-edit-select', target: targetFrom(el, true, true) }, '*');
    // Only enter inline edit on a fresh, non-modified click on the topmost
    // text/link target. Cycled clicks are explicitly drilling the z-stack;
    // Alt/Option clicks are an explicit "select without editing" gesture.
    if (!event.altKey && !result.cycled && (kind === 'text' || kind === 'link')) makeEditable(el, event);
  }
  window.addEventListener('message', function(ev){
    if (!ev.data) return;
    if (ev.data.type === 'od-edit-mode') {
      var nextEnabled = !!ev.data.enabled;
      if (enabled !== nextEnabled) resetClickCycle();
      enabled = nextEnabled;
      document.documentElement.toggleAttribute('data-od-edit-mode', enabled);
      if (!enabled) clearSelectedTarget();
      if (enabled) setTimeout(postTargets, 0);
      return;
    }
    if (ev.data.type === 'od-edit-click' || ev.data.type === 'od-edit-alt-click') {
      var clickX = Number(ev.data.clientX);
      var clickY = Number(ev.data.clientY);
      if (!enabled || !isFinite(clickX) || !isFinite(clickY)) return;
      var clickEl = document.elementFromPoint ? document.elementFromPoint(clickX, clickY) : null;
      handleClick({ target: clickEl, altKey: ev.data.type === 'od-edit-alt-click', clientX: clickX, clientY: clickY });
      return;
    }
    if (ev.data.type === 'od-edit-select-target') {
      if (!enabled) return;
      var requestedEl = findById(ev.data.id);
      if (!requestedEl) return;
      requestedEl = targetForSelection(requestedEl);
      setSelectedTarget(stableId(requestedEl));
      window.parent.postMessage({ type: 'od-edit-select', target: targetFrom(requestedEl, true, true) }, '*');
      return;
    }
    if (ev.data.type === 'od-edit-selected-target') {
      if (!ev.data.id) resetClickCycle();
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
      applyPreviewStyles(ev.data.id, ev.data.styles || {}, ev.data.version, ev.data.includeAuthoredSize === true);
      return;
    }
    if (ev.data.type === 'od-edit-rich-format') {
      applyRichFormat(ev.data.command);
      return;
    }
    if (ev.data.type === 'od-edit-begin-text-edit') {
      if (!enabled) return;
      var beginEl = findById(ev.data.id);
      if (beginEl && beginEl.getAttribute('data-od-editing') !== 'true') makeEditable(beginEl);
      return;
    }
    if (ev.data.type === 'od-edit-end-text-edit') {
      var endEl = document.querySelector('[data-od-editing="true"]');
      if (endEl && typeof endEl.blur === 'function') endEl.blur();
      return;
    }
  });
  document.addEventListener('click', function(ev){
    if (!enabled) return;
    if (ev.target && ev.target.closest && ev.target.closest('[data-od-editing="true"]')) return;
    ev.preventDefault();
    ev.stopPropagation();
    handleClick(ev);
  }, true);
  document.addEventListener('pointerover', function(ev){
    if (!enabled) return;
    if (ev.target && ev.target.closest && ev.target.closest('[data-od-editing="true"]')) return;
    var el = closestTarget(ev);
    if (!el) return;
    postHoverTarget(el);
  }, true);
  // Keydown never bubbles out of this cross-document iframe to the host, so
  // forward history shortcuts and arrow nudges when an object is selected.
  // Inline text editing keeps the browser's native keyboard behavior.
  document.addEventListener('keydown', function(ev){
    if (!enabled) return;
    if (document.querySelector('[data-od-editing="true"]')) return;
    var nudgeDirections = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    var nudgeDirection = nudgeDirections[ev.key];
    if (nudgeDirection && !(ev.ctrlKey || ev.metaKey || ev.altKey) && document.querySelector('[data-od-edit-selected]')) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      window.parent.postMessage({ type: 'od-edit-nudge', direction: nudgeDirection }, '*');
      return;
    }
    if (!(ev.ctrlKey || ev.metaKey)) return;
    var key = (ev.key || '').toLowerCase();
    var isUndo = key === 'z' && !ev.shiftKey;
    var isRedo = (key === 'z' && ev.shiftKey) || (key === 'y' && !ev.shiftKey);
    if (!isUndo && !isRedo) return;
    ev.preventDefault();
    window.parent.postMessage({ type: 'od-edit-undo', redo: isRedo }, '*');
  }, true);
  document.addEventListener('selectionchange', postSelectionState);
  window.addEventListener('resize', postTargets);
  // ponytail: no throttle -- postTargets is a cheap querySelectorAll + getBoundingClientRect
  // pass; add rAF/debounce here if a scroll-heavy preview page measurably regresses.
  document.addEventListener('scroll', postTargets, true);
  // Deck slide navigation, transition settle, media loads, and content growth
  // reflow the page without firing resize or scroll; without re-measurement the
  // host overlays (resize handles, inspector panel, hover icon) keep rendering
  // the stale click-time rect. Coalesce observed changes to one post per frame.
  var suppressObservedLayoutUntil = 0;
  var queuedTargetsPost = false;
  var scheduleFrame = window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : function(cb){ return window.setTimeout(cb, 16); };
  function queuePostTargets(){
    if (!enabled || queuedTargetsPost) return;
    queuedTargetsPost = true;
    flushTargetsWhenQuiet();
  }
  function flushTargetsWhenQuiet(){
    // Defer — never drop — echoes that land inside the preview mute window.
    // The last DOM mutation of a drag IS the final preview write; dropping its
    // echo would strand the host overlays on stale rects (no resize/scroll
    // event follows a pointerup to trigger another re-measure).
    var wait = suppressObservedLayoutUntil - Date.now();
    if (wait > 0) {
      window.setTimeout(flushTargetsWhenQuiet, wait + 8);
      return;
    }
    scheduleFrame(function(){
      queuedTargetsPost = false;
      postTargets();
    });
  }
  if (typeof MutationObserver === 'function') {
    new MutationObserver(queuePostTargets).observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true
    });
  }
  if (typeof ResizeObserver === 'function') {
    var layoutResizeObserver = new ResizeObserver(queuePostTargets);
    layoutResizeObserver.observe(document.documentElement);
    if (document.body) layoutResizeObserver.observe(document.body);
  }
  document.addEventListener('load', queuePostTargets, true);
  document.addEventListener('transitionend', queuePostTargets, true);
  document.addEventListener('animationend', queuePostTargets, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', postTargets);
  else setTimeout(postTargets, 0);
  document.documentElement.toggleAttribute('data-od-edit-mode', enabled);
})();</script>`;
}

export function buildManualEditBridgeStyle(): string {
  return `<style data-od-edit-bridge-style>
html[data-od-edit-mode] body * { cursor: pointer !important; }
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
  cursor: text !important;
}
</style>`;
}
