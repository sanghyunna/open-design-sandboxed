// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberRow, QuadField, Section } from '../../src/components/ManualEditInspectorRows';

afterEach(cleanup);

describe('manual edit inspector rows', () => {
  it('keeps control help visible beside the property name', () => {
    render(
      <Section title="Shape" description="Change the selected element's appearance and box model.">
        <NumberRow
          label="Width"
          description="Horizontal size. CSS units are supported."
          value="320px"
          unit="px"
          onChange={vi.fn()}
        />
      </Section>,
    );

    expect(screen.getByText("Change the selected element's appearance and box model.")).toBeTruthy();
    expect(screen.getByText('Horizontal size. CSS units are supported.')).toBeTruthy();
  });

  it('shows which side each box-model input changes', () => {
    render(
      <QuadField
        label="Padding"
        description="Space between the content and border."
        sideLabels={{ t: 'Top', r: 'Right', b: 'Bottom', l: 'Left' }}
        values={{ t: '1px', r: '2px', b: '3px', l: '4px' }}
        onChange={vi.fn()}
      />,
    );

    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      expect(screen.getByText(side)).toBeTruthy();
    }
  });
});
