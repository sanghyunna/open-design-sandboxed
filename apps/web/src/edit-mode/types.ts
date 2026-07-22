export type ManualEditKind = 'text' | 'link' | 'image' | 'container' | 'token';

export interface ManualEditRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ManualEditFields {
  text?: string;
  href?: string;
  src?: string;
  alt?: string;
}

export interface ManualEditStyles {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  color: string;
  textAlign: string;
  lineHeight: string;
  letterSpacing: string;
  width: string;
  height: string;
  minHeight: string;
  // Standalone CSS `translate` (e.g. "10px 20px"). Drives layout-neutral move
  // drags: it offsets the element visually without reflowing siblings and
  // composes with any existing `transform`. Empty string = no translation.
  translate: string;
  gap: string;
  flexDirection: string;
  justifyContent: string;
  alignItems: string;
  flex: string;
  backgroundColor: string;
  opacity: string;
  padding: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  margin: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  border: string;
  borderTopWidth: string;
  borderRightWidth: string;
  borderBottomWidth: string;
  borderLeftWidth: string;
  borderStyle: string;
  borderColor: string;
  borderRadius: string;
}

export interface ManualEditTarget {
  id: string;
  kind: ManualEditKind;
  label: string;
  tagName: string;
  className: string;
  text: string;
  rect: ManualEditRect;
  /**
   * getBoundingClientRect px per CSS px on each axis — the accumulated
   * ancestor transform scale (e.g. a deck's fit-to-canvas transform).
   * Absent or 1 for untransformed elements.
   */
  rectScale?: { x: number; y: number };
  /**
   * Post-layout getComputedStyle width/height (used px values). Unlike
   * `styles.width/height` (inline value first, which layout may have clamped
   * or ignored), this is what actually renders — the resize drag baseline.
   */
  cssSize?: { width: string; height: string };
  /** Winning authored width/height declarations (inline or stylesheet), kept
   * separate from computed size so the inspector can distinguish Auto, Fill,
   * and an explicitly sized element without mistaking a used px value for an
   * authored fixed size. */
  authoredSize?: { width: string; height: string };
  /**
   * Main axis of the parent flex container when the element is a flex item
   * ('row' → width is the main axis, 'column' → height), else null. Main-axis
   * drag commits must pin the item (flex: none) or the flex algorithm
   * overrides the written width/height.
   */
  flexItemAxis?: 'row' | 'column' | null;
  textEditTargetId?: string;
  fields: ManualEditFields;
  attributes: Record<string, string>;
  styles: ManualEditStyles;
  isLayoutContainer: boolean;
  isHidden?: boolean;
  outerHtml: string;
}

export type ManualEditPatch =
  | { id: string; kind: 'set-text'; value: string }
  | { id: string; kind: 'set-link'; text: string; href: string }
  | { id: string; kind: 'set-image'; src: string; alt: string }
  | { id: string; kind: 'remove-element' }
  | { kind: 'set-token'; token: string; value: string }
  | { id: string; kind: 'set-style'; styles: Partial<ManualEditStyles> }
  | { id: string; kind: 'set-attributes'; attributes: Record<string, string> }
  | { id: string; kind: 'set-inner-html'; html: string }
  | { id: string; kind: 'set-outer-html'; html: string }
  | { kind: 'set-full-source'; source: string };

export interface ManualEditHistoryEntry {
  id: string;
  label: string;
  patch: ManualEditPatch;
  beforeSource: string;
  afterSource: string;
  createdAt: number;
}

export interface ManualEditTargetMessage {
  type: 'od-edit-targets';
  targets: ManualEditTarget[];
}

export interface ManualEditSelectMessage {
  type: 'od-edit-select';
  target: ManualEditTarget;
}

export interface ManualEditHoverMessage {
  type: 'od-edit-hover';
  target: ManualEditTarget;
}

export interface ManualEditBackgroundMessage {
  type: 'od-edit-background';
}

export interface ManualEditPreviewAppliedMessage {
  type: 'od-edit-preview-style-applied';
  id: string;
  version: number;
  ok: boolean;
  error?: string;
  /**
   * The target's post-apply getBoundingClientRect. Streamed back per preview
   * frame so the host overlays track the element's REAL box during a drag —
   * flex/grid/min-content constraints can clamp or ignore the requested size.
   */
  rect?: ManualEditRect;
  /**
   * Post-apply computed width/height. Feeds the host's resize baseline: when
   * layout clamps a request, this is the value that actually took effect.
   */
  cssSize?: { width: string; height: string };
  /** Post-apply winning authored width/height declarations. */
  authoredSize?: { width: string; height: string };
}

export interface ManualEditTextCommitMessage {
  type: 'od-edit-text-commit';
  id: string;
  value: string;
}

export interface ManualEditHtmlCommitMessage {
  type: 'od-edit-html-commit';
  id: string;
  html: string;
}

export interface ManualEditUndoMessage {
  type: 'od-edit-undo';
  redo: boolean;
}

// iframe -> host: reports the live rich-text edit/selection/format state so the
// typography toolbar can enable + show pressed state for B/I/U.
export interface ManualEditSelectionStateMessage {
  type: 'od-edit-selection-state';
  editing: boolean;       // an element is in a rich (contenteditable="true") edit session
  hasSelection: boolean;  // a non-collapsed selection sits inside that element
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

// host -> iframe: apply an execCommand format command to the current selection.
export interface ManualEditRichFormatMessage {
  type: 'od-edit-rich-format';
  command: 'bold' | 'italic' | 'underline';
}

// host -> iframe: explicitly enter the rich-text edit session for an element
// (for example, a structured container's double-click).
export interface ManualEditBeginTextEditMessage {
  type: 'od-edit-begin-text-edit';
  id: string;
}

// host -> iframe: leave the rich-text edit session but keep the element
// selected (PowerPoint "Esc / border-drag promotes caret to object select").
// The bridge tears down contenteditable and re-broadcasts selection-state
// (editing: false) so the host flips the move frame to object-selected mode.
export interface ManualEditEndTextEditMessage {
  type: 'od-edit-end-text-edit';
}

export interface ManualEditClickMessage {
  type: 'od-edit-click';
  clientX: number;
  clientY: number;
  selectedId: string;
}

export interface ManualEditClickCancelMessage {
  type: 'od-edit-click-cancel';
}

export interface ManualEditAltClickMessage {
  type: 'od-edit-alt-click';
  clientX: number;
  clientY: number;
}

export type ManualEditActivationMessage =
  | ManualEditClickMessage
  | ManualEditClickCancelMessage
  | ManualEditAltClickMessage;

export type ManualEditBridgeMessage =
  | ManualEditTargetMessage
  | ManualEditSelectMessage
  | ManualEditHoverMessage
  | ManualEditBackgroundMessage
  | ManualEditPreviewAppliedMessage
  | ManualEditTextCommitMessage
  | ManualEditHtmlCommitMessage
  | ManualEditUndoMessage
  | ManualEditSelectionStateMessage;

export const MANUAL_EDIT_STYLE_PROPS: readonly (keyof ManualEditStyles)[] = [
  'fontFamily', 'fontSize', 'fontWeight', 'color', 'textAlign', 'lineHeight', 'letterSpacing',
  'width', 'height', 'minHeight', 'translate',
  'gap', 'flexDirection', 'justifyContent', 'alignItems', 'flex',
  'backgroundColor', 'opacity',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'border', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle', 'borderColor', 'borderRadius',
];

export function emptyManualEditStyles(): ManualEditStyles {
  return MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    acc[key] = '';
    return acc;
  }, {} as ManualEditStyles);
}
