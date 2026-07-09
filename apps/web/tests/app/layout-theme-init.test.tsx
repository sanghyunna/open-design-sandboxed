// @vitest-environment jsdom

import { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import RootLayout from '../../app/layout';
import { EXPLICIT_THEME_OPTIONS } from '../../src/state/themes';

function findThemeInitScript(node: ReactNode): string | null {
  if (!isValidElement(node)) return null;

  const props = node.props as {
    children?: ReactNode;
    dangerouslySetInnerHTML?: { __html?: string };
  };
  if (node.type === 'script') return props.dangerouslySetInnerHTML?.__html ?? null;

  for (const child of Children.toArray(props.children)) {
    const found = findThemeInitScript(child);
    if (found) return found;
  }
  return null;
}

describe('RootLayout theme init script', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-scheme');
  });

  it.each(EXPLICIT_THEME_OPTIONS)(
    'prehydrates the $id theme from the registry',
    (theme) => {
      const script = findThemeInitScript(RootLayout({ children: null }));
      expect(script).toBeTruthy();

      localStorage.setItem('open-design:config', JSON.stringify({ theme: theme.id }));
      new Function(script ?? '')();

      expect(document.documentElement.getAttribute('data-theme')).toBe(theme.id);
      expect(document.documentElement.getAttribute('data-theme-scheme')).toBe(theme.scheme);
    },
  );
});
