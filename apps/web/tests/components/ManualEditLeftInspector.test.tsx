// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ManualEditLeftInspector } from '../../src/components/ManualEditLeftInspector';
import type { ManualEditRichFormatState } from '../../src/components/ManualEditTextControls';
import { emptyManualEditStyles, type ManualEditStyles, type ManualEditTarget } from '../../src/edit-mode/types';
import type { SystemFontFamily } from '@open-design/contracts';

const systemFontsMock = vi.hoisted(() => ({ families: [] as SystemFontFamily[] }));
vi.mock('../../src/components/useSystemFonts', () => ({
  useSystemFonts: () => ({ families: systemFontsMock.families, loading: false }),
}));

const idleFormat: ManualEditRichFormatState = {
  editing: false, hasSelection: false, bold: false, italic: false, underline: false,
};

function target(overrides: Partial<ManualEditTarget> = {}): ManualEditTarget {
  return {
    id: 'hero',
    kind: 'container',
    label: 'Hero box',
    tagName: 'section',
    className: '',
    text: '',
    rect: { x: 0, y: 0, width: 120, height: 80 },
    fields: {},
    attributes: {},
    styles: emptyManualEditStyles(),
    isLayoutContainer: false,
    outerHtml: '<section></section>',
    ...overrides,
  };
}

function renderInspector(overrides: {
  target?: ManualEditTarget | null;
  styles?: ManualEditStyles;
  pageStylesEnabled?: boolean;
} = {}) {
  const onStyleField = vi.fn<(key: keyof ManualEditStyles, value: string) => void>();
  const onRichFormat = vi.fn();
  const onApplyPatch = vi.fn();
  const onError = vi.fn();
  const onUndo = vi.fn();
  const onRedo = vi.fn();
  const onPageStyleChange = vi.fn();
  const onPageInvalidStyle = vi.fn();
  const onExit = vi.fn();
  const utils = render(
    <ManualEditLeftInspector
      target={overrides.target === undefined ? target() : overrides.target}
      styles={overrides.styles ?? emptyManualEditStyles()}
      richFormat={idleFormat}
      draftAlt=""
      error={null}
      busy={false}
      canUndo
      canRedo
      pageStylesEnabled={overrides.pageStylesEnabled ?? true}
      onStyleField={onStyleField}
      onRichFormat={onRichFormat}
      onApplyPatch={onApplyPatch}
      onError={onError}
      onUndo={onUndo}
      onRedo={onRedo}
      onPageStyleChange={onPageStyleChange}
      onPageInvalidStyle={onPageInvalidStyle}
      onExit={onExit}
    />,
  );
  return { ...utils, onStyleField, onRichFormat, onApplyPatch, onUndo, onRedo, onPageStyleChange, onExit };
}

afterEach(() => {
  systemFontsMock.families = [];
  cleanup();
});

describe('ManualEditLeftInspector', () => {
  it('shows the Page section (and no element sections) when nothing is selected', () => {
    const { getByText, queryByText, getByLabelText } = renderInspector({ target: null });
    expect(getByText('Page')).toBeTruthy();
    expect(queryByText('Text')).toBeNull();
    expect(queryByText('Shape')).toBeNull();
    // Page fields render for a full-document source.
    expect(getByLabelText('Pick Background')).toBeTruthy();
  });

  it('shows the disabled-page hint for fragment sources', () => {
    const { getByText, queryByLabelText } = renderInspector({ target: null, pageStylesEnabled: false });
    expect(getByText('Page styles are available only for full HTML documents.')).toBeTruthy();
    expect(queryByLabelText('Pick Background')).toBeNull();
  });

  it('shows Text and Shape sections for a text target', () => {
    const { getByText, getByLabelText } = renderInspector({ target: target({ kind: 'text', label: 'Title' }) });
    expect(getByText('Text')).toBeTruthy();
    expect(getByText('Shape')).toBeTruthy();
    expect(getByLabelText('Font')).toBeTruthy();
  });

  it('shows only the Shape section for a non-text target', () => {
    const { getByText, queryByText } = renderInspector({ target: target({ kind: 'container' }) });
    expect(queryByText('Text')).toBeNull();
    expect(getByText('Shape')).toBeTruthy();
  });

  it('routes a shape style-field change through onStyleField', () => {
    const { getByLabelText, onStyleField } = renderInspector({ target: target({ kind: 'container' }) });
    fireEvent.change(getByLabelText('Width'), { target: { value: '240' } });
    expect(onStyleField).toHaveBeenCalledWith('width', '240px');
  });

  it('routes a page font change through onPageStyleChange', () => {
    const { container, onPageStyleChange } = renderInspector({ target: null });
    const fontSelect = container.querySelector('.cc-row select') as HTMLSelectElement | null;
    if (!fontSelect) throw new Error('Font select not found');
    fireEvent.change(fontSelect, { target: { value: 'Georgia, serif' } });
    expect(onPageStyleChange).toHaveBeenCalledWith('__body__', { fontFamily: 'Georgia, serif' }, 'Page styles');
  });

  it('routes header undo/redo and exit', () => {
    const { getByLabelText, onUndo, onRedo, onExit } = renderInspector();
    fireEvent.click(getByLabelText('Undo'));
    fireEvent.click(getByLabelText('Redo'));
    fireEvent.click(getByLabelText('Exit edit mode'));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('shows layout controls only for layout containers', () => {
    const plain = renderInspector({ target: target({ isLayoutContainer: false }) });
    expect(plain.queryByLabelText('Direction')).toBeNull();
    plain.unmount();
    const layout = renderInspector({ target: target({ isLayoutContainer: true }) });
    fireEvent.change(layout.getByLabelText('Direction'), { target: { value: 'column' } });
    expect(layout.onStyleField).toHaveBeenCalledWith('flexDirection', 'column');
  });
});
