// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import {
  ManualEditTypographyToolbar,
  type ManualEditRichFormatState,
} from '../../src/components/ManualEditTypographyToolbar';
import { emptyManualEditStyles, type ManualEditStyles, type ManualEditTarget } from '../../src/edit-mode/types';

const target: ManualEditTarget = {
  id: 'hero-title',
  kind: 'text',
  label: 'Hero Title',
  tagName: 'h1',
  className: 'hero',
  text: 'Original',
  rect: { x: 0, y: 0, width: 120, height: 40 },
  fields: { text: 'Original' },
  attributes: {},
  styles: emptyManualEditStyles(),
  isLayoutContainer: false,
  outerHtml: '<h1>Original</h1>',
};

const idleFormat: ManualEditRichFormatState = {
  editing: false,
  hasSelection: false,
  bold: false,
  italic: false,
  underline: false,
};

function renderToolbar(overrides: {
  styles?: ManualEditStyles;
  richFormat?: ManualEditRichFormatState;
} = {}) {
  const onStyleField = vi.fn<(key: keyof ManualEditStyles, value: string) => void>();
  const onRichFormat = vi.fn<(command: 'bold' | 'italic' | 'underline') => void>();
  const utils = render(
    <ManualEditTypographyToolbar
      target={target}
      styles={overrides.styles ?? emptyManualEditStyles()}
      richFormat={overrides.richFormat ?? idleFormat}
      onStyleField={onStyleField}
      onRichFormat={onRichFormat}
    />,
  );
  return { ...utils, onStyleField, onRichFormat };
}

afterEach(() => cleanup());

describe('ManualEditTypographyToolbar', () => {
  it('disables B/I/U when nothing is being edited', () => {
    const { getByLabelText } = renderToolbar();
    for (const label of ['Bold', 'Italic', 'Underline']) {
      expect((getByLabelText(label) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('enables B/I/U and reflects pressed state during a live selection', () => {
    const { getByLabelText } = renderToolbar({
      richFormat: { editing: true, hasSelection: true, bold: true, italic: false, underline: false },
    });
    const bold = getByLabelText('Bold') as HTMLButtonElement;
    const italic = getByLabelText('Italic') as HTMLButtonElement;
    expect(bold.disabled).toBe(false);
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(italic.getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onRichFormat when a live Bold button is clicked', () => {
    const { getByLabelText, onRichFormat } = renderToolbar({
      richFormat: { editing: true, hasSelection: true, bold: false, italic: false, underline: false },
    });
    fireEvent.click(getByLabelText('Bold'));
    expect(onRichFormat).toHaveBeenCalledWith('bold');
  });

  it('steps font size up in px from a numeric value', () => {
    const { getByLabelText, onStyleField } = renderToolbar({
      styles: { ...emptyManualEditStyles(), fontSize: '16px' },
    });
    fireEvent.click(getByLabelText('Font size increase'));
    expect(onStyleField).toHaveBeenCalledWith('fontSize', '17px');
  });

  it('floors the font-size stepper at zero', () => {
    const { getByLabelText, onStyleField } = renderToolbar({
      styles: { ...emptyManualEditStyles(), fontSize: '0px' },
    });
    fireEvent.click(getByLabelText('Font size decrease'));
    expect(onStyleField).toHaveBeenCalledWith('fontSize', '0px');
  });

  it('disables the size stepper for non-numeric values instead of collapsing them to px', () => {
    const { getByLabelText } = renderToolbar({
      styles: { ...emptyManualEditStyles(), fontSize: '1.5rem' },
    });
    expect((getByLabelText('Font size increase') as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText('Font size decrease') as HTMLButtonElement).disabled).toBe(true);
  });

  it('steps line-height (unitless) and letter-spacing (px)', () => {
    const { getByLabelText, onStyleField } = renderToolbar({
      styles: { ...emptyManualEditStyles(), lineHeight: '1.4', letterSpacing: '0px' },
    });
    fireEvent.click(getByLabelText('Line height increase'));
    expect(onStyleField).toHaveBeenCalledWith('lineHeight', '2.4');
    onStyleField.mockClear();
    fireEvent.click(getByLabelText('Letter spacing increase'));
    expect(onStyleField).toHaveBeenCalledWith('letterSpacing', '1px');
  });

  it('sets text-align from an align button', () => {
    const { getByLabelText, onStyleField } = renderToolbar();
    fireEvent.click(getByLabelText('Align center'));
    expect(onStyleField).toHaveBeenCalledWith('textAlign', 'center');
  });

  it('toggles a set text-align off when its button is pressed again', () => {
    const { getByLabelText, onStyleField } = renderToolbar({
      styles: { ...emptyManualEditStyles(), textAlign: 'center' },
    });
    fireEvent.click(getByLabelText('Align center'));
    expect(onStyleField).toHaveBeenCalledWith('textAlign', '');
  });

  it('sets font weight from the weight select', () => {
    const { getByLabelText, onStyleField } = renderToolbar();
    fireEvent.change(getByLabelText('Weight') as HTMLSelectElement, { target: { value: '700' } });
    expect(onStyleField).toHaveBeenCalledWith('fontWeight', '700');
  });

  it('sets text color from a swatch tile', () => {
    const { getByLabelText, onStyleField } = renderToolbar();
    fireEvent.click(getByLabelText('Text color'));
    fireEvent.click(getByLabelText('#ef4444'));
    expect(onStyleField).toHaveBeenCalledWith('color', '#ef4444');
  });

  it('sets font-family from the font select', () => {
    const { getByLabelText, onStyleField } = renderToolbar();
    const select = getByLabelText('Font') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Georgia, serif' } });
    expect(onStyleField).toHaveBeenCalledWith('fontFamily', 'Georgia, serif');
  });
});
