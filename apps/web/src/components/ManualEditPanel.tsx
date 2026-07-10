import { useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import { useT } from '../i18n';
import { emptyManualEditStyles, type ManualEditStyles, type ManualEditTarget } from '../edit-mode/types';
import { Icon } from './Icon';
import { RemixIcon } from './RemixIcon';
import { useSystemFonts } from './useSystemFonts';
import { systemFontOptions } from './font-options';

export interface ManualEditDraft {
  text: string;
  href: string;
  src: string;
  alt: string;
  styles: ManualEditStyles;
  attributesText: string;
  outerHtml: string;
  fullSource: string;
}

export function emptyManualEditDraft(source = ''): ManualEditDraft {
  return {
    text: '', href: '', src: '', alt: '',
    styles: emptyManualEditStyles(),
    attributesText: '{}', outerHtml: '', fullSource: source,
  };
}

export function ManualEditPanel({
  error,
  canUndo,
  canRedo,
  busy,
  onStyleChange,
  onInvalidStyle,
  onError,
  onCancelDraft,
  onSaveDraft,
  onUndo,
  onRedo,
  onExit,
  pageStylesEnabled = true,
}: {
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  busy?: boolean;
  pageStylesEnabled?: boolean;
  onStyleChange: (id: string, styles: Partial<ManualEditStyles>, label: string) => void;
  onInvalidStyle?: (id: string, keys: Array<keyof ManualEditStyles>) => void;
  onError: (message: string) => void;
  onExit?: () => void;
  onCancelDraft: () => void;
  onSaveDraft: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const t = useT();

  return (
    <aside className="manual-edit-right manual-edit-floating manual-edit-page-card" style={{ top: 12, right: 12, width: 320 }}>
      <section className="manual-edit-modal cc-panel">
        <div className="manual-edit-titlebar">
          <span title={t('manualEdit.fallbackTitle')}>{t('manualEdit.fallbackTitle')}</span>
          {onExit ? (
            <button
              type="button"
              className="manual-edit-titlebar-close"
              aria-label={t('manualEdit.closePanel')}
              title={t('manualEdit.closePanel')}
              onClick={onExit}
            >
              <Icon name="close" size={16} />
            </button>
          ) : null}
        </div>
        <div className="manual-edit-scroll">
          <PageInspector
            enabled={pageStylesEnabled}
            onStyleChange={(styles) => {
              const normalized = normalizeManualEditStyles(styles, { layoutEnabled: true });
              if (!normalized.ok) {
                onError('error' in normalized ? normalized.error : 'Invalid style value.');
                onInvalidStyle?.('__body__', Object.keys(styles) as Array<keyof ManualEditStyles>);
                return;
              }
              onError('');
              onStyleChange('__body__', normalized.styles, 'Page styles');
            }}
          />
        </div>

        <div className="manual-edit-footer">
          <div className="manual-edit-footer-actions">
            <div className="manual-edit-footer-left">
              <div className="manual-edit-history-actions">
                <Button
                  variant="subtle"
                  size="icon"
                  aria-label={t('manualEdit.undo')}
                  title={t('manualEdit.undo')}
                  disabled={busy || !canUndo}
                  onClick={onUndo}
                >
                  <RemixIcon name="arrow-go-back-line" size={15} />
                </Button>
                <Button
                  variant="subtle"
                  size="icon"
                  aria-label={t('manualEdit.redo')}
                  title={t('manualEdit.redo')}
                  disabled={busy || !canRedo}
                  onClick={onRedo}
                >
                  <RemixIcon name="arrow-go-forward-line" size={15} />
                </Button>
              </div>
            </div>
            <div className="manual-edit-footer-right">
              <button
                type="button"
                className="manual-edit-footer-btn subtle"
                disabled={busy}
                onClick={onCancelDraft}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="manual-edit-footer-btn primary"
                disabled={busy}
                onClick={onSaveDraft}
              >
                {t('common.save')}
              </button>
            </div>
          </div>

          {error ? <div className="manual-edit-error">{error}</div> : null}
        </div>
      </section>
    </aside>
  );
}

function PageInspector({
  enabled,
  onStyleChange,
}: {
  enabled: boolean;
  onStyleChange: (styles: Partial<ManualEditStyles>) => void;
}) {
  const [bg, setBg] = useState('');
  const [font, setFont] = useState('');
  const [size, setSize] = useState('');
  const update = (next: { bg?: string; font?: string; size?: string }) => {
    if ('bg' in next) {
      const value = next.bg ?? '';
      setBg(value);
      onStyleChange({ backgroundColor: value });
    }
    if ('font' in next) {
      const value = next.font ?? '';
      setFont(value);
      onStyleChange({ fontFamily: value });
    }
    if ('size' in next) {
      const value = next.size ?? '';
      setSize(value);
      onStyleChange({ fontSize: value });
    }
  };

  return (
    <div className="cc-inspector">
      <Section title="PAGE">
        {enabled ? (
          <>
            <ColorRow label="Background" value={bg} onChange={(value) => update({ bg: value })} />
            <FontRow value={font} onChange={(value) => update({ font: value })} />
            <UnitRow label="Base size" value={size} onChange={(value) => update({ size: value })} unit="px" autoUnit />
          </>
        ) : (
          <p className="cc-section-hint">Page styles are available only for full HTML documents.</p>
        )}
      </Section>
    </div>
  );
}

export const FONT_OPTS = [
  { label: 'inherit', value: '' },
  { label: 'Space Grotesk', value: '"Space Grotesk", Inter, system-ui, sans-serif' },
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Times', value: '"Times New Roman", Times, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Roboto', value: 'Roboto, Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'monospace', value: 'SFMono-Regular, Consolas, "Liberation Mono", monospace' },
] as const;
export const WEIGHT_OPTS = ['', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
export const ALIGN_OPTS = ['', 'left', 'center', 'right', 'justify', 'start', 'end'];
export const DIRECTION_OPTS = ['', 'row', 'column', 'row-reverse', 'column-reverse'];
export const JUSTIFY_OPTS = ['', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around'];
export const ITEMS_OPTS = ['', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline'];
export const BORDER_STYLE_OPTS = ['', 'solid', 'dashed', 'dotted', 'double', 'none'];
export const EDITOR_SWATCH_COLORS = [
  '#000000',
  '#ffffff',
  '#374151',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#84cc16',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const;

type NormalizeResult =
  | { ok: true; styles: Partial<ManualEditStyles> }
  | { ok: false; error: string };

const PX_STYLE_PROPS = new Set<keyof ManualEditStyles>([
  'fontSize', 'letterSpacing', 'width', 'height', 'minHeight', 'gap',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'border', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderRadius',
]);
const NON_NEGATIVE_PX_STYLE_PROPS = new Set<keyof ManualEditStyles>(['width', 'height', 'minHeight']);
const COLOR_STYLE_PROPS = new Set<keyof ManualEditStyles>(['color', 'backgroundColor', 'borderColor']);
// fontFamily is intentionally free-form (no whitelist): the picker now offers
// installed system fonts and preserves pre-existing custom values, none of
// which are in FONT_OPTS. It is written verbatim as an inline font-family
// style, which the browser ignores if malformed — so there is no invariant to
// enforce here. The other select-backed props stay whitelisted.
const SELECT_STYLE_OPTIONS: Partial<Record<keyof ManualEditStyles, ReadonlyArray<string>>> = {
  fontWeight: WEIGHT_OPTS,
  textAlign: ALIGN_OPTS,
  flexDirection: DIRECTION_OPTS,
  justifyContent: JUSTIFY_OPTS,
  alignItems: ITEMS_OPTS,
  borderStyle: BORDER_STYLE_OPTS,
};
const LAYOUT_STYLE_PROPS = new Set<keyof ManualEditStyles>(['gap', 'flexDirection', 'justifyContent', 'alignItems']);

export function normalizeManualEditStyles(
  styles: Partial<ManualEditStyles>,
  { layoutEnabled }: { layoutEnabled: boolean },
): NormalizeResult {
  const normalized: Partial<ManualEditStyles> = {};
  for (const [rawKey, rawValue] of Object.entries(styles) as Array<[keyof ManualEditStyles, string]>) {
    if (LAYOUT_STYLE_PROPS.has(rawKey) && !layoutEnabled) continue;
    const value = rawValue.trim();
    if (value === '') {
      normalized[rawKey] = '';
      continue;
    }
    if (PX_STYLE_PROPS.has(rawKey)) {
      const px = normalizePxValue(value);
      if (!px) return { ok: false, error: `${styleLabel(rawKey)} must be a number or px value.` };
      if (NON_NEGATIVE_PX_STYLE_PROPS.has(rawKey) && parseFloat(px) < 0) {
        return { ok: false, error: `${styleLabel(rawKey)} cannot be negative.` };
      }
      normalized[rawKey] = px;
      continue;
    }
    if (COLOR_STYLE_PROPS.has(rawKey)) {
      const color = normalizeHexColor(value);
      if (!color) return { ok: false, error: `${styleLabel(rawKey)} must be a hex color.` };
      normalized[rawKey] = color;
      continue;
    }
    if (rawKey === 'opacity') {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: 'Opacity must be a number.' };
      normalized.opacity = String(Math.max(0, Math.min(1, n)));
      continue;
    }
    if (rawKey === 'lineHeight') {
      const lineHeight = normalizeLineHeightValue(value);
      if (!lineHeight) return { ok: false, error: 'Line height must be a positive number or px value.' };
      normalized.lineHeight = lineHeight;
      continue;
    }
    const options = SELECT_STYLE_OPTIONS[rawKey];
    if (options) {
      if (!options.includes(value)) return { ok: false, error: `${styleLabel(rawKey)} has an unsupported value.` };
      normalized[rawKey] = value;
      continue;
    }
    normalized[rawKey] = value;
  }
  return { ok: true, styles: normalized };
}

// Shared normalize-and-dispatch for docked manual-edit toolbar fields.
export function applyManualEditStyleField(params: {
  target: ManualEditTarget;
  draft: ManualEditDraft;
  key: keyof ManualEditStyles;
  value: string;
  onDraftChange: (draft: ManualEditDraft) => void;
  onError: (message: string) => void;
  onInvalidStyle?: (id: string, keys: Array<keyof ManualEditStyles>) => void;
  onStyleChange?: (id: string, styles: Partial<ManualEditStyles>, label: string) => void;
}): void {
  const { target, draft, key, value, onDraftChange, onError, onInvalidStyle, onStyleChange } = params;
  onDraftChange({ ...draft, styles: { ...draft.styles, [key]: value } });
  const normalized = normalizeManualEditStyles({ [key]: value }, { layoutEnabled: target.isLayoutContainer });
  if (!normalized.ok) {
    onError('error' in normalized ? normalized.error : 'Invalid style value.');
    onInvalidStyle?.(target.id, [key]);
    return;
  }
  onError('');
  onStyleChange?.(target.id, normalized.styles, `Style: ${target.label}`);
}

function normalizePxValue(value: string): string | null {
  if (/^-?\d+(\.\d+)?$/.test(value)) return `${value}px`;
  if (/^-?\d+(\.\d+)?px$/i.test(value)) return value.toLowerCase();
  return null;
}

function normalizeLineHeightValue(value: string): string | null {
  if (/^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    return n > 0 ? String(n) : null;
  }
  if (/^\d+(\.\d+)?px$/i.test(value)) {
    const n = Number(value.slice(0, -2));
    return n > 0 ? value.toLowerCase() : null;
  }
  return null;
}

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const r = trimmed[1]!, g = trimmed[2]!, b = trimmed[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function styleLabel(key: keyof ManualEditStyles): string {
  return key.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`);
}

function Section({ title, children, inactive }: { title: string; children: React.ReactNode; inactive?: boolean }) {
  return (
    <section className={`cc-section${inactive ? ' cc-section-inactive' : ''}`}>
      <header className="cc-section-head">{title}</header>
      <div className="cc-section-body">{children}</div>
    </section>
  );
}

function UnitRow({ label, value, onChange, unit, autoUnit, disabled }: {
  label: string; value: string; onChange: (v: string) => void;
  unit: string; autoUnit?: boolean; disabled?: boolean;
}) {
  const display = unit === 'px' ? stripPxUnit(value) : value;
  const step = unit === 'px' ? 1 : 0.1;
  const canStep = !disabled && isNumericInput(display);
  const valueFromDisplay = (raw: string) => {
    const trimmed = raw.trim();
    if (autoUnit && trimmed && isNumericInput(trimmed)) return `${trimmed}px`;
    if (autoUnit && /^-?\d+(\.\d+)?px$/i.test(trimmed)) return trimmed.toLowerCase();
    return raw;
  };
  const handle = (raw: string) => {
    const next = valueFromDisplay(raw);
    if (next !== value) onChange(next);
  };
  const stepBy = (direction: -1 | 1) => {
    if (!canStep) return;
    const next = formatSteppedNumber(Number(display) + direction * step, display, step);
    onChange(valueFromDisplay(next));
  };
  return (
    <label className="cc-row">
      <span className="cc-label">{label}</span>
      <span className="cc-value">
        <button type="button" className="cc-step" disabled={!canStep} aria-label={`${label} decrease`} onClick={() => stepBy(-1)}>−</button>
        <input value={display} placeholder="" disabled={disabled} onChange={(e) => onChange(valueFromDisplay(e.currentTarget.value))} onBlur={(e) => handle(e.currentTarget.value)} />
        <button type="button" className="cc-step" disabled={!canStep} aria-label={`${label} increase`} onClick={() => stepBy(1)}>+</button>
        {unit ? <em className="cc-unit">{unit}</em> : null}
      </span>
    </label>
  );
}

function FontRow({ value, onChange }: {
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useT();
  const { families } = useSystemFonts();
  const systemOptions = systemFontOptions(families, FONT_OPTS);
  const normalizedValue = normalizeFontFamilyForSelect(value);
  const customValue = normalizedValue === value ? value : '';
  const isCurated = FONT_OPTS.some((option) => option.value === customValue);
  const isSystem = systemOptions.some((option) => option.value === customValue);
  return (
    <label className="cc-row">
      <span className="cc-label">Font</span>
      <span className="cc-value cc-select">
        {/* ponytail: native <select>+<optgroup>; a searchable combobox is a deferred follow-up. */}
        <select value={normalizedValue} onChange={(event) => onChange(event.currentTarget.value)}>
          {customValue && !isCurated && !isSystem ? (
            <option value={customValue}>{fontFamilyLabel(customValue)}</option>
          ) : null}
          {FONT_OPTS.map((option) => (
            <option key={option.label} value={option.value}>{option.label}</option>
          ))}
          {systemOptions.length ? (
            <optgroup label={t('manualEdit.systemFontsGroup')}>
              {systemOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <em className="cc-chevron">▾</em>
      </span>
    </label>
  );
}

export function normalizeFontFamilyForSelect(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const direct = FONT_OPTS.find((option) => option.value === trimmed);
  if (direct) return direct.value;
  const families = parseFontFamilies(trimmed);
  const primaryFamily = families[0];
  const match = FONT_OPTS.find((option) => {
    if (!option.value) return false;
    const optionFamilies = parseFontFamilies(option.value);
    return optionFamilies[0] === primaryFamily;
  });
  return match?.value ?? trimmed;
}

export function fontFamilyLabel(value: string): string {
  return parseFontFamilies(value)[0] ?? value;
}

function parseFontFamilies(value: string): string[] {
  return value
    .split(',')
    .map((family) => family.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .filter(Boolean);
}

function ColorRow({ label, value, onChange, compact }: {
  label: string; value: string; onChange: (v: string) => void; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);
  return (
    <label className="cc-row">
      {compact ? null : <span className="cc-label">{label}</span>}
      <span className={`cc-value cc-color ${compact ? 'cc-color-compact' : ''}`} ref={ref}>
        <button type="button" className="cc-swatch" style={{ background: value || 'transparent' }}
          onClick={() => setOpen((v) => !v)} aria-label={`Pick ${label}`} />
        <input value={value} placeholder="#000000"
          onChange={(e) => onChange(e.currentTarget.value)} onFocus={() => setOpen(true)} />
        {open ? (
          <div className="cc-color-popover">
            <div className="cc-color-grid">
              {EDITOR_SWATCH_COLORS.map((hex) => (
                <button key={hex} type="button" className="cc-color-tile" style={{ background: hex }}
                  onClick={() => { onChange(hex); setOpen(false); }} aria-label={hex} />
              ))}
            </div>
            <input type="color" className="cc-color-native" value={normalizeColorForPicker(value)}
              onChange={(e) => onChange(e.currentTarget.value)} />
          </div>
        ) : null}
      </span>
    </label>
  );
}

export function stripPxUnit(value: string): string {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
  return match?.[1] ?? value;
}

function isNumericInput(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}

function formatSteppedNumber(value: number, current: string, step: number): string {
  const decimals = Math.max(decimalPlaces(current), decimalPlaces(String(step)));
  return decimals > 0
    ? value.toFixed(decimals).replace(/\.?0+$/, '')
    : String(Math.round(value));
}

function decimalPlaces(value: string): number {
  const match = value.match(/\.(\d+)/);
  return match?.[1]?.length ?? 0;
}

export function normalizeColorForPicker(value: string): string {
  const trimmed = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    if (trimmed.length === 4) {
      const r = trimmed[1]!, g = trimmed[2]!, b = trimmed[3]!;
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return trimmed.toLowerCase();
  }
  const match = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (match) {
    const toHex = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
    return `#${toHex(match[1]!)}${toHex(match[2]!)}${toHex(match[3]!)}`;
  }
  return '#000000';
}
