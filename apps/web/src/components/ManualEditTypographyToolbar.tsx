import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@open-design/components';
import { useT } from '../i18n';
import type { ManualEditStyles, ManualEditTarget } from '../edit-mode/types';
import { RemixIcon } from './RemixIcon';
import {
  ALIGN_OPTS,
  EDITOR_SWATCH_COLORS,
  FONT_OPTS,
  WEIGHT_OPTS,
  fontFamilyLabel,
  normalizeColorForPicker,
  normalizeFontFamilyForSelect,
  stripPxUnit,
} from './ManualEditPanel';
import { useSystemFonts } from './useSystemFonts';
import { systemFontOptions } from './font-options';
import styles from './ManualEditTypographyToolbar.module.css';

export interface ManualEditRichFormatState {
  editing: boolean;
  hasSelection: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

// Docked typography controls for a selected text/link/token element. Whole-element
// controls call onStyleField (Task 5 threads it through applyManualEditStyleField so
// validation/preview/save match the floating panel). B/I/U are selection-level rich
// text that drive the execCommand bridge via onRichFormat.
export function ManualEditTypographyToolbar({
  styles: elementStyles,
  richFormat,
  onStyleField,
  onRichFormat,
}: {
  target: ManualEditTarget;
  styles: ManualEditStyles;
  richFormat: ManualEditRichFormatState;
  onStyleField: (key: keyof ManualEditStyles, value: string) => void;
  onRichFormat: (command: 'bold' | 'italic' | 'underline') => void;
}) {
  const t = useT();
  const richDisabled = !(richFormat.editing && richFormat.hasSelection);
  const { families } = useSystemFonts();
  const systemFonts = systemFontOptions(families, FONT_OPTS);
  const isSystemFont = systemFonts.some((option) => option.value === elementStyles.fontFamily);

  const richButton = (
    command: 'bold' | 'italic' | 'underline',
    icon: string,
    label: string,
    pressed: boolean,
  ) => (
    <Button
      variant="subtle"
      size="icon"
      className={`od-tooltip${pressed ? ` ${styles.pressed}` : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      data-tooltip={label}
      disabled={richDisabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onRichFormat(command)}
    >
      <RemixIcon name={icon} size={15} />
    </Button>
  );

  const alignButton = (value: string, icon: string, label: string) => {
    const pressed = elementStyles.textAlign === value;
    return (
      <Button
        variant="subtle"
        size="icon"
        className={`od-tooltip${pressed ? ` ${styles.pressed}` : ''}`}
        aria-label={label}
        aria-pressed={pressed}
        data-tooltip={label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onStyleField('textAlign', pressed ? '' : value)}
      >
        <RemixIcon name={icon} size={15} />
      </Button>
    );
  };

  return (
    <div className={styles.toolbar}>
      <label className={styles.group}>
        {/* ponytail: native <select>+<optgroup>; a searchable combobox is a deferred follow-up. */}
        <select
          className={styles.select}
          aria-label={t('manualEdit.typography.font')}
          data-tooltip={t('manualEdit.typography.font')}
          value={normalizeFontFamilyForSelect(elementStyles.fontFamily)}
          onChange={(e) => onStyleField('fontFamily', e.currentTarget.value)}
        >
          {elementStyles.fontFamily &&
          normalizeFontFamilyForSelect(elementStyles.fontFamily) === elementStyles.fontFamily &&
          !FONT_OPTS.some((option) => option.value === elementStyles.fontFamily) &&
          !isSystemFont ? (
            <option value={elementStyles.fontFamily}>{fontFamilyLabel(elementStyles.fontFamily)}</option>
          ) : null}
          {FONT_OPTS.map((option) => (
            <option key={option.label} value={option.value}>{option.label}</option>
          ))}
          {systemFonts.length ? (
            <optgroup label={t('manualEdit.systemFontsGroup')}>
              {systemFonts.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>

      <Stepper
        label={t('manualEdit.typography.fontSize')}
        increaseLabel={`${t('manualEdit.typography.fontSize')} ${t('manualEdit.typography.increase').toLowerCase()}`}
        decreaseLabel={`${t('manualEdit.typography.fontSize')} ${t('manualEdit.typography.decrease').toLowerCase()}`}
        value={elementStyles.fontSize}
        unit="px"
        onChange={(v) => onStyleField('fontSize', v)}
      />

      <span className={styles.divider} aria-hidden="true" />

      <div className={styles.group}>
        {richButton('bold', 'bold', t('manualEdit.typography.bold'), richFormat.bold)}
        {richButton('italic', 'italic', t('manualEdit.typography.italic'), richFormat.italic)}
        {richButton('underline', 'underline', t('manualEdit.typography.underline'), richFormat.underline)}
      </div>

      <span className={styles.divider} aria-hidden="true" />

      <label className={styles.group}>
        <select
          className={styles.select}
          aria-label={t('manualEdit.typography.weight')}
          data-tooltip={t('manualEdit.typography.weight')}
          value={elementStyles.fontWeight}
          onChange={(e) => onStyleField('fontWeight', e.currentTarget.value)}
        >
          {WEIGHT_OPTS.map((opt) => (
            <option key={opt || '__'} value={opt}>{opt || '–'}</option>
          ))}
        </select>
      </label>

      <ColorControl
        label={t('manualEdit.typography.textColor')}
        value={elementStyles.color}
        onChange={(v) => onStyleField('color', v)}
      />

      <span className={styles.divider} aria-hidden="true" />

      <div className={styles.group}>
        {alignButton(ALIGN_OPTS[1]!, 'align-left', t('manualEdit.typography.alignLeft'))}
        {alignButton(ALIGN_OPTS[2]!, 'align-center', t('manualEdit.typography.alignCenter'))}
        {alignButton(ALIGN_OPTS[3]!, 'align-right', t('manualEdit.typography.alignRight'))}
        {alignButton(ALIGN_OPTS[4]!, 'align-justify', t('manualEdit.typography.alignJustify'))}
      </div>

      <span className={styles.divider} aria-hidden="true" />

      <Stepper
        label={t('manualEdit.typography.lineHeight')}
        increaseLabel={`${t('manualEdit.typography.lineHeight')} ${t('manualEdit.typography.increase').toLowerCase()}`}
        decreaseLabel={`${t('manualEdit.typography.lineHeight')} ${t('manualEdit.typography.decrease').toLowerCase()}`}
        value={elementStyles.lineHeight}
        unit=""
        onChange={(v) => onStyleField('lineHeight', v)}
      />

      <Stepper
        label={t('manualEdit.typography.letterSpacing')}
        increaseLabel={`${t('manualEdit.typography.letterSpacing')} ${t('manualEdit.typography.increase').toLowerCase()}`}
        decreaseLabel={`${t('manualEdit.typography.letterSpacing')} ${t('manualEdit.typography.decrease').toLowerCase()}`}
        value={elementStyles.letterSpacing}
        unit="px"
        onChange={(v) => onStyleField('letterSpacing', v)}
      />
    </div>
  );
}

// px mode strips/emits px; '' mode keeps the value unitless (line-height).
function emitStepperValue(raw: string, unit: 'px' | ''): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (unit === 'px') {
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}px`;
    if (/^-?\d+(\.\d+)?px$/i.test(trimmed)) return trimmed.toLowerCase();
    return raw;
  }
  return raw;
}

function Stepper({
  label, increaseLabel, decreaseLabel, value, unit, onChange,
}: {
  label: string;
  increaseLabel: string;
  decreaseLabel: string;
  value: string;
  unit: 'px' | '';
  onChange: (value: string) => void;
}) {
  const display = stripPxUnit(value);
  const numeric = /^-?\d+(\.\d+)?$/.test(display.trim());
  // ponytail: buttons floor at 0; type a negative directly if a control ever needs it.
  const step = (direction: -1 | 1) => {
    if (!numeric) return;
    onChange(emitStepperValue(String(Math.max(0, Number(display) + direction)), unit));
  };
  return (
    <span className={styles.stepper}>
      <button
        type="button"
        className={`${styles.step} od-tooltip`}
        aria-label={decreaseLabel}
        data-tooltip={decreaseLabel}
        disabled={!numeric}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => step(-1)}
      >
        <RemixIcon name="subtract-line" size={13} />
      </button>
      <input
        className={styles.stepInput}
        aria-label={label}
        value={display}
        inputMode="decimal"
        onChange={(e) => onChange(emitStepperValue(e.currentTarget.value, unit))}
      />
      <button
        type="button"
        className={`${styles.step} od-tooltip`}
        aria-label={increaseLabel}
        data-tooltip={increaseLabel}
        disabled={!numeric}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => step(1)}
      >
        <RemixIcon name="add-line" size={13} />
      </button>
    </span>
  );
}

function ColorControl({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);
  return (
    <span className={styles.colorWrap} ref={ref}>
      <button
        type="button"
        className={`${styles.swatch} od-tooltip`}
        style={{ '--swatch-color': value || 'transparent' } as CSSProperties}
        aria-label={label}
        data-tooltip={label}
        onClick={() => setOpen((v) => !v)}
      />
      {open ? (
        <div className={styles.colorPopover}>
          <div className={styles.colorGrid}>
            {EDITOR_SWATCH_COLORS.map((hex) => (
              <button
                key={hex}
                type="button"
                className={styles.colorTile}
                style={{ background: hex }}
                aria-label={hex}
                onClick={() => { onChange(hex); setOpen(false); }}
              />
            ))}
          </div>
          <input
            type="color"
            className={styles.colorNative}
            value={normalizeColorForPicker(value)}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
        </div>
      ) : null}
    </span>
  );
}
