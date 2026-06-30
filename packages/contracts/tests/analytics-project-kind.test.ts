import { describe, expect, it } from 'vitest';

import { projectKindToTracking } from '../src/analytics/events.js';

describe('projectKindToTracking', () => {
  it('maps the base project kinds to their tracking enum', () => {
    expect(projectKindToTracking('prototype')).toBe('prototype');
    expect(projectKindToTracking('deck')).toBe('slide_deck');
    expect(projectKindToTracking('template')).toBe('template');
    expect(projectKindToTracking('live-artifact')).toBe('live_artifact');
    expect(projectKindToTracking('other')).toBe('other');
    expect(projectKindToTracking(null)).toBeNull();
    expect(projectKindToTracking('bogus')).toBeNull();
  });
});
