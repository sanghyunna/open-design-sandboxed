// Shape/box controls for a selected element, shared between the horizontal
// docked toolbar (`layout="bar"`) and the vertical left-panel inspector
// (`layout="stack"`). Whole-element style edits go through onStyleField; image
// replace and delete go through onApplyPatch.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from '@open-design/components';
import { useT } from '../i18n';
import type { ManualEditPatch, ManualEditStyles, ManualEditTarget } from '../edit-mode/types';
import { RemixIcon } from './RemixIcon';
import {
  BORDER_STYLE_OPTS,
  DIRECTION_OPTS,
  EDITOR_SWATCH_COLORS,
  ITEMS_OPTS,
  JUSTIFY_OPTS,
  normalizeColorForPicker,
  stripPxUnit,
} from './ManualEditPanel';
import {
  ActionRow,
  ColorRow,
  NumberRow,
  QuadField,
  Section,
  SelectRow,
  Subsection,
} from './ManualEditInspectorRows';
import styles from './ManualEditShapeControls.module.css';

export interface ManualEditShapeControlsProps {
  layout: 'bar' | 'stack';
  target: ManualEditTarget;
  styles: ManualEditStyles;
  draftAlt: string;
  error?: string | null;
  busy?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  getActiveTarget?: () => ManualEditTarget | null;
  onStyleField: (key: keyof ManualEditStyles, value: string) => void;
  onApplyPatch: (patch: ManualEditPatch, label: string) => void;
  onPickImage?: (file: File) => Promise<string | null>;
  onError: (message: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function ManualEditShapeControls(props: ManualEditShapeControlsProps) {
  return props.layout === 'stack' ? <ShapeStack {...props} /> : <ShapeBar {...props} />;
}

// Horizontal docked bar. Markup preserved from the original
// ManualEditShapeToolbar so its behaviour/tests round-trip unchanged.
function ShapeBar({
  target,
  styles: elementStyles,
  draftAlt,
  error,
  busy,
  canUndo,
  canRedo,
  getActiveTarget,
  onStyleField,
  onApplyPatch,
  onPickImage,
  onError,
  onUndo,
  onRedo,
}: ManualEditShapeControlsProps) {
  const t = useT();
  const [uploadingImage, setUploadingImage] = useState(false);
  const [confirmDeleteTargetId, setConfirmDeleteTargetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    setConfirmDeleteTargetId(null);
  }, [target.id]);
  const update = (key: keyof ManualEditStyles, value: string) => onStyleField(key, value);
  const confirmingDelete = confirmDeleteTargetId === target.id;

  return (
    <>
      <div className={styles.group}>
        <Button variant="subtle" size="icon" aria-label={t('manualEdit.undo')} title={t('manualEdit.undo')} disabled={busy || !canUndo} onClick={onUndo}>
          <RemixIcon name="arrow-go-back-line" size={15} />
        </Button>
        <Button variant="subtle" size="icon" aria-label={t('manualEdit.redo')} title={t('manualEdit.redo')} disabled={busy || !canRedo} onClick={onRedo}>
          <RemixIcon name="arrow-go-forward-line" size={15} />
        </Button>
      </div>

      <span className={styles.divider} aria-hidden="true" />

      <div className={styles.group}>
        <ColorControl label={t('manualEdit.shape.fill')} value={elementStyles.backgroundColor} onChange={(v) => update('backgroundColor', v)} />
        <UnitInput label={t('manualEdit.shape.width')} icon="expand-width-line" value={elementStyles.width} unit="px" autoUnit compact onChange={(v) => update('width', v)} />
        <UnitInput label={t('manualEdit.shape.height')} icon="expand-height-line" value={elementStyles.height} unit="px" autoUnit compact onChange={(v) => update('height', v)} />
      </div>

      <span className={styles.divider} aria-hidden="true" />

      <div className={`${styles.group} ${styles.menuGroup}`}>
        <ToolbarPopover label={t('manualEdit.shape.spacing')} icon="box-3-line">
          <Quad label={t('manualEdit.shape.padding')} sideLabels={{
            t: t('manualEdit.shape.paddingTop'),
            r: t('manualEdit.shape.paddingRight'),
            b: t('manualEdit.shape.paddingBottom'),
            l: t('manualEdit.shape.paddingLeft'),
          }} values={{
            t: elementStyles.paddingTop, r: elementStyles.paddingRight, b: elementStyles.paddingBottom, l: elementStyles.paddingLeft,
          }} onChange={(side, value) => update(sideToProp('padding', side), value)} />
          <Quad label={t('manualEdit.shape.margin')} sideLabels={{
            t: t('manualEdit.shape.marginTop'),
            r: t('manualEdit.shape.marginRight'),
            b: t('manualEdit.shape.marginBottom'),
            l: t('manualEdit.shape.marginLeft'),
          }} values={{
            t: elementStyles.marginTop, r: elementStyles.marginRight, b: elementStyles.marginBottom, l: elementStyles.marginLeft,
          }} onChange={(side, value) => update(sideToProp('margin', side), value)} />
        </ToolbarPopover>

        <ToolbarPopover label={t('manualEdit.shape.border')} icon="rounded-corner">
          <div className={styles.popoverRow}>
            <SelectControl label={t('manualEdit.shape.style')} value={elementStyles.borderStyle} options={BORDER_STYLE_OPTS} onChange={(v) => update('borderStyle', v)} compact />
            <ColorControl label={t('manualEdit.shape.borderColor')} value={elementStyles.borderColor} onChange={(v) => update('borderColor', v)} />
          </div>
          <Quad label={t('manualEdit.shape.borderWidths')} sideLabels={{
            t: t('manualEdit.shape.borderWidthsTop'),
            r: t('manualEdit.shape.borderWidthsRight'),
            b: t('manualEdit.shape.borderWidthsBottom'),
            l: t('manualEdit.shape.borderWidthsLeft'),
          }} values={{
            t: elementStyles.borderTopWidth, r: elementStyles.borderRightWidth, b: elementStyles.borderBottomWidth, l: elementStyles.borderLeftWidth,
          }} onChange={(side, value) => update(`border${sideUpper(side)}Width` as keyof ManualEditStyles, value)} />
        </ToolbarPopover>
      </div>

      <div className={styles.group}>
        <UnitInput label={t('manualEdit.shape.radius')} icon="rounded-corner" value={elementStyles.borderRadius} unit="px" autoUnit compact onChange={(v) => update('borderRadius', v)} />
        <UnitInput label={t('manualEdit.shape.opacity')} icon="contrast-drop-2-line" value={elementStyles.opacity} unit="" compact onChange={(v) => update('opacity', v)} />
      </div>

      <span className={styles.divider} aria-hidden="true" />

      <div className={`${styles.group} ${styles.menuGroup}`}>

        {target.isLayoutContainer ? (
          <ToolbarPopover label={t('manualEdit.shape.layout')} icon="layout-row-line">
            <UnitInput label={t('manualEdit.shape.gap')} value={elementStyles.gap} unit="px" autoUnit onChange={(v) => update('gap', v)} />
            <SelectControl label={t('manualEdit.shape.direction')} value={elementStyles.flexDirection} options={DIRECTION_OPTS} onChange={(v) => update('flexDirection', v)} />
            <SelectControl label={t('manualEdit.shape.justify')} value={elementStyles.justifyContent} options={JUSTIFY_OPTS} onChange={(v) => update('justifyContent', v)} />
            <SelectControl label={t('manualEdit.shape.align')} value={elementStyles.alignItems} options={ITEMS_OPTS} onChange={(v) => update('alignItems', v)} />
          </ToolbarPopover>
        ) : null}

        <ToolbarPopover label={t('manualEdit.shape.more')} icon="more-2-line">
          {target.kind === 'image' && onPickImage ? (
            <>
              <button type="button" className={styles.menuAction} disabled={busy || uploadingImage} onClick={() => fileInputRef.current?.click()}>
                <RemixIcon name="image-add-line" size={14} />
                {uploadingImage ? t('manualEdit.uploadingImage') : t('manualEdit.uploadImage')}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className={styles.fileInput}
                onChange={async (event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) return;
                  event.currentTarget.value = '';
                  setUploadingImage(true);
                  try {
                    const src = await onPickImage(file);
                    const activeTarget = getActiveTarget?.() ?? target;
                    if (!src) {
                      onError(t('manualEdit.uploadImageFailed'));
                      return;
                    }
                    if (activeTarget?.id !== target.id || activeTarget.kind !== 'image') return;
                    onApplyPatch({
                      id: activeTarget.id,
                      kind: 'set-image',
                      src,
                      alt: draftAlt,
                    }, t('manualEdit.uploadImage'));
                  } finally {
                    setUploadingImage(false);
                  }
                }}
              />
            </>
          ) : null}
          {confirmingDelete ? (
            <div className={styles.confirmDelete}>
              <button
                type="button"
                className={styles.dangerAction}
                disabled={busy}
                aria-label={t('manualEdit.deleteElement')}
                onClick={() => {
                  if (confirmDeleteTargetId !== target.id) {
                    setConfirmDeleteTargetId(target.id);
                    return;
                  }
                  setConfirmDeleteTargetId(null);
                  onApplyPatch({ id: target.id, kind: 'remove-element' }, t('manualEdit.deleteElement'));
                }}
              >
                <RemixIcon name="delete-bin-line" size={14} />
                {t('manualEdit.deleteElement')}
              </button>
              <button type="button" className={styles.menuAction} disabled={busy} onClick={() => setConfirmDeleteTargetId(null)}>
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.dangerAction}
              aria-label={t('manualEdit.deleteElement')}
              disabled={busy}
              onClick={() => setConfirmDeleteTargetId(target.id)}
            >
              <RemixIcon name="delete-bin-line" size={14} />
              {t('manualEdit.deleteElement')}
            </button>
          )}
        </ToolbarPopover>
      </div>
      {error ? <div className={styles.error} role="alert" title={error}>{error}</div> : null}
    </>
  );
}

// Vertical inspector section built from the shared cc- rows.
function ShapeStack({
  target,
  styles: elementStyles,
  draftAlt,
  busy,
  getActiveTarget,
  onStyleField,
  onApplyPatch,
  onPickImage,
  onError,
}: ManualEditShapeControlsProps) {
  const t = useT();
  const [uploadingImage, setUploadingImage] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    setConfirmingDelete(false);
  }, [target.id]);
  const update = (key: keyof ManualEditStyles, value: string) => onStyleField(key, value);

  return (
    <Section
      title={t('manualEdit.sectionShape')}
      description={t('manualEdit.sectionShapeDescription')}
    >
      <Subsection title={t('manualEdit.groupAppearance')}>
        <ColorRow
          label={t('manualEdit.shape.fill')}
          description={t('manualEdit.shape.fillHelp')}
          value={elementStyles.backgroundColor}
          onChange={(v) => update('backgroundColor', v)}
        />
        <NumberRow
          label={t('manualEdit.shape.radius')}
          description={t('manualEdit.shape.radiusHelp')}
          value={elementStyles.borderRadius}
          unit="px"
          autoUnit
          onChange={(v) => update('borderRadius', v)}
        />
        <NumberRow
          label={t('manualEdit.shape.opacity')}
          description={t('manualEdit.shape.opacityHelp')}
          value={elementStyles.opacity}
          unit=""
          onChange={(v) => update('opacity', v)}
        />
      </Subsection>

      <Subsection title={t('manualEdit.groupSize')}>
        <NumberRow
          label={t('manualEdit.shape.width')}
          description={t('manualEdit.shape.widthHelp')}
          value={elementStyles.width}
          unit="px"
          autoUnit
          onChange={(v) => update('width', v)}
        />
        <NumberRow
          label={t('manualEdit.shape.height')}
          description={t('manualEdit.shape.heightHelp')}
          value={elementStyles.height}
          unit="px"
          autoUnit
          onChange={(v) => update('height', v)}
        />
      </Subsection>

      <Subsection title={t('manualEdit.groupSpacing')}>
        <QuadField
          label={t('manualEdit.shape.padding')}
          description={t('manualEdit.shape.paddingHelp')}
          sideLabels={{
            t: t('manualEdit.shape.paddingTop'),
            r: t('manualEdit.shape.paddingRight'),
            b: t('manualEdit.shape.paddingBottom'),
            l: t('manualEdit.shape.paddingLeft'),
          }}
          values={{ t: elementStyles.paddingTop, r: elementStyles.paddingRight, b: elementStyles.paddingBottom, l: elementStyles.paddingLeft }}
          onChange={(side, value) => update(sideToProp('padding', side), value)}
        />
        <QuadField
          label={t('manualEdit.shape.margin')}
          description={t('manualEdit.shape.marginHelp')}
          sideLabels={{
            t: t('manualEdit.shape.marginTop'),
            r: t('manualEdit.shape.marginRight'),
            b: t('manualEdit.shape.marginBottom'),
            l: t('manualEdit.shape.marginLeft'),
          }}
          values={{ t: elementStyles.marginTop, r: elementStyles.marginRight, b: elementStyles.marginBottom, l: elementStyles.marginLeft }}
          onChange={(side, value) => update(sideToProp('margin', side), value)}
        />
      </Subsection>

      <Subsection title={t('manualEdit.groupBorder')}>
        <SelectRow
          label={t('manualEdit.shape.style')}
          description={t('manualEdit.shape.styleHelp')}
          value={elementStyles.borderStyle}
          options={BORDER_STYLE_OPTS}
          onChange={(v) => update('borderStyle', v)}
        />
        <ColorRow
          label={t('manualEdit.shape.borderColor')}
          description={t('manualEdit.shape.borderColorHelp')}
          value={elementStyles.borderColor}
          onChange={(v) => update('borderColor', v)}
        />
        <QuadField
          label={t('manualEdit.shape.borderWidths')}
          description={t('manualEdit.shape.borderWidthsHelp')}
          sideLabels={{
            t: t('manualEdit.shape.borderWidthsTop'),
            r: t('manualEdit.shape.borderWidthsRight'),
            b: t('manualEdit.shape.borderWidthsBottom'),
            l: t('manualEdit.shape.borderWidthsLeft'),
          }}
          values={{ t: elementStyles.borderTopWidth, r: elementStyles.borderRightWidth, b: elementStyles.borderBottomWidth, l: elementStyles.borderLeftWidth }}
          onChange={(side, value) => update(`border${sideUpper(side)}Width` as keyof ManualEditStyles, value)}
        />
      </Subsection>

      {target.isLayoutContainer ? (
        <Subsection title={t('manualEdit.groupLayout')}>
          <NumberRow
            label={t('manualEdit.shape.gap')}
            description={t('manualEdit.shape.gapHelp')}
            value={elementStyles.gap}
            unit="px"
            autoUnit
            onChange={(v) => update('gap', v)}
          />
          <SelectRow
            label={t('manualEdit.shape.direction')}
            description={t('manualEdit.shape.directionHelp')}
            value={elementStyles.flexDirection}
            options={DIRECTION_OPTS}
            onChange={(v) => update('flexDirection', v)}
          />
          <SelectRow
            label={t('manualEdit.shape.justify')}
            description={t('manualEdit.shape.justifyHelp')}
            value={elementStyles.justifyContent}
            options={JUSTIFY_OPTS}
            onChange={(v) => update('justifyContent', v)}
          />
          <SelectRow
            label={t('manualEdit.shape.align')}
            description={t('manualEdit.shape.alignHelp')}
            value={elementStyles.alignItems}
            options={ITEMS_OPTS}
            onChange={(v) => update('alignItems', v)}
          />
        </Subsection>
      ) : null}

      {target.kind === 'image' && onPickImage ? (
        <>
          <ActionRow
            icon="image-add-line"
            label={uploadingImage ? t('manualEdit.uploadingImage') : t('manualEdit.uploadImage')}
            disabled={busy || uploadingImage}
            onClick={() => fileInputRef.current?.click()}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className={styles.fileInput}
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              event.currentTarget.value = '';
              setUploadingImage(true);
              try {
                const src = await onPickImage(file);
                const activeTarget = getActiveTarget?.() ?? target;
                if (!src) {
                  onError(t('manualEdit.uploadImageFailed'));
                  return;
                }
                if (activeTarget?.id !== target.id || activeTarget.kind !== 'image') return;
                onApplyPatch({ id: activeTarget.id, kind: 'set-image', src, alt: draftAlt }, t('manualEdit.uploadImage'));
              } finally {
                setUploadingImage(false);
              }
            }}
          />
        </>
      ) : null}

      {confirmingDelete ? (
        <div className={styles.confirmDelete}>
          <ActionRow
            icon="delete-bin-line"
            label={t('manualEdit.deleteElement')}
            danger
            disabled={busy}
            onClick={() => {
              setConfirmingDelete(false);
              onApplyPatch({ id: target.id, kind: 'remove-element' }, t('manualEdit.deleteElement'));
            }}
          />
          <ActionRow
            icon="close-line"
            label={t('common.cancel')}
            disabled={busy}
            onClick={() => setConfirmingDelete(false)}
          />
        </div>
      ) : (
        <ActionRow
          icon="delete-bin-line"
          label={t('manualEdit.deleteElement')}
          danger
          disabled={busy}
          onClick={() => setConfirmingDelete(true)}
        />
      )}
    </Section>
  );
}

function ToolbarPopover({ label, icon, children }: { label: string; icon: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onDocKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [open]);
  return (
    <span className={styles.popoverWrap} ref={ref}>
      <Button
        variant="subtle"
        size="default"
        className={`${styles.popoverButton} od-tooltip`}
        aria-label={label}
        aria-expanded={open}
        data-tooltip={label}
        onClick={() => setOpen((v) => !v)}
      >
        <RemixIcon name={icon} size={15} />
        <span>{label}</span>
        <RemixIcon name="arrow-down-s-line" size={14} />
      </Button>
      {open ? <div className={styles.popover} role="group" aria-label={label}>{children}</div> : null}
    </span>
  );
}

function UnitInput({
  label, icon, value, unit, autoUnit, compact, onChange,
}: {
  label: string;
  icon?: string;
  value: string;
  unit: 'px' | '';
  autoUnit?: boolean;
  compact?: boolean;
  onChange: (value: string) => void;
}) {
  const display = unit === 'px' ? stripPxUnit(value) : value;
  const emit = (raw: string) => {
    const trimmed = raw.trim();
    if (autoUnit && trimmed && /^-?\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}px`;
    if (autoUnit && /^-?\d+(\.\d+)?px$/i.test(trimmed)) return trimmed.toLowerCase();
    return raw;
  };
  return (
    <label
      className={`${styles.field}${compact ? ` ${styles.compactField}` : ''}${icon ? ' od-tooltip' : ''}`}
      data-tooltip={icon ? label : undefined}
    >
      {icon ? <RemixIcon name={icon} size={14} /> : <span>{label}</span>}
      <input
        aria-label={label}
        value={display}
        inputMode="decimal"
        onChange={(event) => onChange(emit(event.currentTarget.value))}
      />
      {unit ? <em>{unit}</em> : null}
    </label>
  );
}

function SelectControl({
  label, value, options, onChange, compact,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<string>;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <label className={`${styles.field} ${compact ? styles.compactField : ''}`}>
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {!options.includes(value) && value ? <option value={value}>{value}</option> : null}
        {options.map((option) => <option key={option || '__'} value={option}>{option || '-'}</option>)}
      </select>
    </label>
  );
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onDocKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [open]);
  return (
    <span className={styles.colorWrap} ref={ref}>
      <button
        type="button"
        className={`${styles.swatch} od-tooltip`}
        style={{ '--swatch-color': value || 'transparent' } as CSSProperties}
        aria-label={label}
        data-tooltip={label}
        title={label}
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
          <input type="color" className={styles.colorNative} value={normalizeColorForPicker(value)} onChange={(event) => onChange(event.currentTarget.value)} />
        </div>
      ) : null}
    </span>
  );
}

function Quad({
  label, sideLabels, values, onChange,
}: {
  label: string;
  sideLabels: { t: string; r: string; b: string; l: string };
  values: { t: string; r: string; b: string; l: string };
  onChange: (side: 't' | 'r' | 'b' | 'l', value: string) => void;
}) {
  return (
    <div className={styles.quad}>
      <span className={styles.quadLabel}>{label}</span>
      <UnitInput label={sideLabels.t} value={values.t} unit="px" autoUnit onChange={(value) => onChange('t', value)} />
      <UnitInput label={sideLabels.r} value={values.r} unit="px" autoUnit onChange={(value) => onChange('r', value)} />
      <UnitInput label={sideLabels.b} value={values.b} unit="px" autoUnit onChange={(value) => onChange('b', value)} />
      <UnitInput label={sideLabels.l} value={values.l} unit="px" autoUnit onChange={(value) => onChange('l', value)} />
    </div>
  );
}

function sideToProp(base: 'padding' | 'margin', side: 't' | 'r' | 'b' | 'l'): keyof ManualEditStyles {
  return `${base}${sideUpper(side)}` as keyof ManualEditStyles;
}

function sideUpper(side: 't' | 'r' | 'b' | 'l'): 'Top' | 'Right' | 'Bottom' | 'Left' {
  return side === 't' ? 'Top' : side === 'r' ? 'Right' : side === 'b' ? 'Bottom' : 'Left';
}
