// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ManualEditShapeToolbar } from '../../src/components/ManualEditShapeToolbar';
import { emptyManualEditStyles, type ManualEditPatch, type ManualEditStyles, type ManualEditTarget } from '../../src/edit-mode/types';

function target(overrides: Partial<ManualEditTarget> = {}): ManualEditTarget {
  return {
    id: 'hero-box',
    kind: 'container',
    label: 'Hero box',
    tagName: 'section',
    className: '',
    text: '',
    rect: { x: 0, y: 0, width: 120, height: 80 },
    fields: {},
    attributes: { 'data-od-id': 'hero-box' },
    styles: emptyManualEditStyles(),
    isLayoutContainer: false,
    outerHtml: '<section data-od-id="hero-box"></section>',
    ...overrides,
  };
}

function renderToolbar(overrides: {
  target?: ManualEditTarget;
  styles?: ManualEditStyles;
  error?: string | null;
  getActiveTarget?: () => ManualEditTarget | null;
  onPickImage?: (file: File) => Promise<string | null>;
} = {}) {
  const onStyleField = vi.fn<(key: keyof ManualEditStyles, value: string) => void>();
  const onStyleFields = vi.fn<(styles: Partial<ManualEditStyles>) => void>();
  const onApplyPatch = vi.fn<(patch: ManualEditPatch, label: string) => void>();
  const onUndo = vi.fn<() => void>();
  const onRedo = vi.fn<() => void>();
  const onError = vi.fn<(message: string) => void>();
  const utils = render(
    <ManualEditShapeToolbar
      target={overrides.target ?? target()}
      styles={overrides.styles ?? emptyManualEditStyles()}
      draftAlt="Hero alt"
      error={overrides.error}
      busy={false}
      canUndo
      canRedo
      getActiveTarget={overrides.getActiveTarget}
      onStyleField={onStyleField}
      onStyleFields={onStyleFields}
      onApplyPatch={onApplyPatch}
      onPickImage={overrides.onPickImage}
      onError={onError}
      onUndo={onUndo}
      onRedo={onRedo}
    />,
  );
  return { ...utils, onStyleField, onStyleFields, onApplyPatch, onUndo, onRedo, onError };
}

afterEach(() => {
  cleanup();
});

describe('ManualEditShapeToolbar', () => {
  it('calls onStyleField for direct fill, size, linked spacing, border, radius, and opacity controls', () => {
    const { getByLabelText, onStyleField, onStyleFields } = renderToolbar();

    fireEvent.click(getByLabelText('Fill'));
    fireEvent.click(getByLabelText('#ef4444'));
    expect(onStyleField).toHaveBeenCalledWith('backgroundColor', '#ef4444');

    fireEvent.change(getByLabelText('Width'), { target: { value: '240' } });
    expect(onStyleField).toHaveBeenCalledWith('width', '240px');

    fireEvent.change(getByLabelText('Height'), { target: { value: '180' } });
    expect(onStyleField).toHaveBeenCalledWith('height', '180px');

    fireEvent.change(getByLabelText('Padding'), { target: { value: '16' } });
    expect(onStyleFields).toHaveBeenCalledWith({
      paddingTop: '16px',
      paddingRight: '16px',
      paddingBottom: '16px',
      paddingLeft: '16px',
    });

    fireEvent.change(getByLabelText('Border widths'), { target: { value: '2' } });
    expect(onStyleFields).toHaveBeenCalledWith({
      borderTopWidth: '2px',
      borderRightWidth: '2px',
      borderBottomWidth: '2px',
      borderLeftWidth: '2px',
    });

    fireEvent.change(getByLabelText('Style'), { target: { value: 'dashed' } });
    expect(onStyleField).toHaveBeenCalledWith('borderStyle', 'dashed');

    fireEvent.click(getByLabelText('Border color'));
    fireEvent.click(getByLabelText('#3b82f6'));
    expect(onStyleField).toHaveBeenCalledWith('borderColor', '#3b82f6');

    fireEvent.change(getByLabelText('Radius'), { target: { value: '8' } });
    expect(onStyleField).toHaveBeenCalledWith('borderRadius', '8px');

    fireEvent.change(getByLabelText('Opacity'), { target: { value: '0.5' } });
    expect(onStyleField).toHaveBeenCalledWith('opacity', '0.5');
  });

  it('keeps per-side spacing and border widths in accessible popover groups', () => {
    const { getByLabelText, getByRole, onStyleField } = renderToolbar();

    fireEvent.click(getByLabelText('Spacing'));
    expect(getByRole('group', { name: 'Spacing' })).toBeTruthy();
    fireEvent.change(getByLabelText('Padding top'), { target: { value: '12' } });
    expect(onStyleField).toHaveBeenCalledWith('paddingTop', '12px');

    fireEvent.click(getByLabelText('Border'));
    expect(getByRole('group', { name: 'Border' })).toBeTruthy();
    fireEvent.change(getByLabelText('Border widths left'), { target: { value: '3' } });
    expect(onStyleField).toHaveBeenCalledWith('borderLeftWidth', '3px');
  });

  it('shows layout controls only for layout containers', () => {
    const nonLayout = renderToolbar();
    expect(nonLayout.queryByLabelText('Layout')).toBeNull();
    nonLayout.unmount();

    const layout = renderToolbar({ target: target({ isLayoutContainer: true }) });
    fireEvent.click(layout.getByLabelText('Layout'));
    fireEvent.change(layout.getByLabelText('Direction'), { target: { value: 'column' } });
    expect(layout.onStyleField).toHaveBeenCalledWith('flexDirection', 'column');
  });

  it('wires image replacement through set-image', async () => {
    const onPickImage = vi.fn(async () => '/assets/new.png');
    const { getByLabelText, container, onApplyPatch } = renderToolbar({
      target: target({ id: 'hero-image', kind: 'image', fields: { alt: 'Old alt' } }),
      onPickImage,
    });

    fireEvent.click(getByLabelText('More'));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'hero.png', { type: 'image/png' })] } });

    expect(onPickImage).toHaveBeenCalled();
    await waitFor(() => expect(onApplyPatch).toHaveBeenCalledWith(
      { id: 'hero-image', kind: 'set-image', src: '/assets/new.png', alt: 'Hero alt' },
      'Upload image',
    ));
  });

  it('does not replace any image when the selected target changes before upload resolves', async () => {
    let activeTarget = target({ id: 'hero-image', kind: 'image', fields: { alt: 'Old alt' } });
    const nextTarget = target({ id: 'next-image', kind: 'image', fields: { alt: 'Next alt' } });
    const onPickImage = vi.fn(async () => {
      activeTarget = nextTarget;
      return '/assets/new.png';
    });
    const { getByLabelText, container, onApplyPatch } = renderToolbar({
      target: activeTarget,
      getActiveTarget: () => activeTarget,
      onPickImage,
    });

    fireEvent.click(getByLabelText('More'));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'hero.png', { type: 'image/png' })] } });

    await waitFor(() => expect(onPickImage).toHaveBeenCalled());
    expect(onApplyPatch).not.toHaveBeenCalled();
  });

  it('keeps delete, undo, and redo reachable', () => {
    const { getByLabelText, onApplyPatch, onUndo, onRedo } = renderToolbar();

    fireEvent.click(getByLabelText('Undo'));
    expect(onUndo).toHaveBeenCalled();
    fireEvent.click(getByLabelText('Redo'));
    expect(onRedo).toHaveBeenCalled();

    fireEvent.click(getByLabelText('More'));
    fireEvent.click(getByLabelText('Delete element'));
    fireEvent.click(getByLabelText('Delete element'));
    expect(onApplyPatch).toHaveBeenCalledWith(
      { id: 'hero-box', kind: 'remove-element' },
      'Delete element',
    );
  });

  it('does not carry delete confirmation to a different selected shape', () => {
    const onStyleField = vi.fn<(key: keyof ManualEditStyles, value: string) => void>();
    const onStyleFields = vi.fn<(styles: Partial<ManualEditStyles>) => void>();
    const onApplyPatch = vi.fn<(patch: ManualEditPatch, label: string) => void>();
    const props = {
      styles: emptyManualEditStyles(),
      draftAlt: 'Hero alt',
      busy: false,
      canUndo: false,
      canRedo: false,
      onStyleField,
      onStyleFields,
      onApplyPatch,
      onError: vi.fn<(message: string) => void>(),
      onUndo: vi.fn<() => void>(),
      onRedo: vi.fn<() => void>(),
    };
    const { getByLabelText, rerender } = render(
      <ManualEditShapeToolbar target={target({ id: 'first-box' })} {...props} />,
    );

    fireEvent.click(getByLabelText('More'));
    fireEvent.click(getByLabelText('Delete element'));
    rerender(<ManualEditShapeToolbar target={target({ id: 'second-box' })} {...props} />);
    fireEvent.click(getByLabelText('Delete element'));

    expect(onApplyPatch).not.toHaveBeenCalled();
    fireEvent.click(getByLabelText('Delete element'));
    expect(onApplyPatch).toHaveBeenCalledWith(
      { id: 'second-box', kind: 'remove-element' },
      'Delete element',
    );
  });

  it('renders shape edit errors in the docked toolbar', () => {
    const { getByRole } = renderToolbar({ error: 'Target not found' });

    expect(getByRole('alert').textContent).toBe('Target not found');
  });
});
