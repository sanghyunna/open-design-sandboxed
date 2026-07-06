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

  it('steps font size up in px and never below zero', () => {
    const { getByLabelText, onStyleField } = renderToolbar();
    fireEvent.click(getByLabelText('Font size increase'));
    expect(onStyleField).toHaveBeenCalledWith('fontSize', expect.stringMatching(/px$/));

    onStyleField.mockClear();
    fireEvent.click(getByLabelText('Font size decrease'));
    expect(onStyleField).toHaveBeenCalledWith('fontSize', '0px');
  });

  it('sets text-align from an align button', () => {
    const { getByLabelText, onStyleField } = renderToolbar();
    fireEvent.click(getByLabelText('Align center'));
    expect(onStyleField).toHaveBeenCalledWith('textAlign', 'center');
  });

  it('sets font-family from the font select', () => {
    const { getByLabelText, onStyleField } = renderToolbar();
    const select = getByLabelText('Font') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Georgia, serif' } });
    expect(onStyleField).toHaveBeenCalledWith('fontFamily', 'Georgia, serif');
  });
});
