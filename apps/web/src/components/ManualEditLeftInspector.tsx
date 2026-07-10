// Vertical manual-edit inspector hosted in the left panel (the slot that
// normally holds the chat). Stacks the Text, Shape and Page sections and a
// header with undo/redo + exit. Selecting an element swaps which sections are
// shown; nothing moves around the canvas.
import { Button } from '@open-design/components';
import { useT } from '../i18n';
import type { ManualEditPatch, ManualEditStyles, ManualEditTarget } from '../edit-mode/types';
import { Icon } from './Icon';
import { RemixIcon } from './RemixIcon';
import { ManualEditTextControls, type ManualEditRichFormatState } from './ManualEditTextControls';
import { ManualEditShapeControls } from './ManualEditShapeControls';
import { ManualEditPageSection } from './ManualEditPageSection';

export interface ManualEditLeftInspectorProps {
  target: ManualEditTarget | null;
  styles: ManualEditStyles;
  richFormat: ManualEditRichFormatState;
  draftAlt: string;
  error?: string | null;
  busy?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  pageStylesEnabled: boolean;
  getActiveTarget?: () => ManualEditTarget | null;
  onStyleField: (key: keyof ManualEditStyles, value: string) => void;
  onRichFormat: (command: 'bold' | 'italic' | 'underline') => void;
  onApplyPatch: (patch: ManualEditPatch, label: string) => void;
  onPickImage?: (file: File) => Promise<string | null>;
  onError: (message: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onPageStyleChange: (id: string, styles: Partial<ManualEditStyles>, label: string) => void;
  onPageInvalidStyle?: (id: string, keys: Array<keyof ManualEditStyles>) => void;
  onExit?: () => void;
}

export function ManualEditLeftInspector({
  target,
  styles,
  richFormat,
  draftAlt,
  error,
  busy,
  canUndo,
  canRedo,
  pageStylesEnabled,
  getActiveTarget,
  onStyleField,
  onRichFormat,
  onApplyPatch,
  onPickImage,
  onError,
  onUndo,
  onRedo,
  onPageStyleChange,
  onPageInvalidStyle,
  onExit,
}: ManualEditLeftInspectorProps) {
  const t = useT();
  const isTextLike = !!target
    && (target.kind === 'text'
      || target.kind === 'link'
      || target.kind === 'token'
      || !!target.textEditTargetId);

  return (
    <aside className="manual-edit-left-inspector" aria-label={t('manualEdit.inspectorTitle')}>
      <header className="manual-edit-inspector-head">
        <span className="manual-edit-inspector-title" title={target?.label ?? t('manualEdit.inspectorTitle')}>
          {target?.label ?? t('manualEdit.inspectorTitle')}
        </span>
        <div className="manual-edit-inspector-actions">
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
          {onExit ? (
            <button
              type="button"
              className="manual-edit-inspector-exit"
              aria-label={t('manualEdit.exitEditMode')}
              title={t('manualEdit.exitEditMode')}
              onClick={onExit}
            >
              <Icon name="close" size={16} />
            </button>
          ) : null}
        </div>
      </header>

      <div className="manual-edit-inspector-scroll">
        {target ? (
          <>
            {isTextLike ? (
              <ManualEditTextControls
                layout="stack"
                target={target}
                styles={styles}
                richFormat={richFormat}
                onStyleField={onStyleField}
                onRichFormat={onRichFormat}
              />
            ) : null}
            <ManualEditShapeControls
              layout="stack"
              target={target}
              styles={styles}
              draftAlt={draftAlt}
              error={error}
              busy={busy}
              canUndo={canUndo}
              canRedo={canRedo}
              getActiveTarget={getActiveTarget}
              onStyleField={onStyleField}
              onApplyPatch={onApplyPatch}
              onPickImage={onPickImage}
              onError={onError}
              onUndo={onUndo}
              onRedo={onRedo}
            />
          </>
        ) : (
          <ManualEditPageSection
            title={t('manualEdit.sectionPage')}
            enabled={pageStylesEnabled}
            onStyleChange={onPageStyleChange}
            onError={onError}
            onInvalidStyle={onPageInvalidStyle}
          />
        )}
        {error ? <div className="manual-edit-inspector-error" role="alert">{error}</div> : null}
      </div>
    </aside>
  );
}
