import { describe, expect, it } from 'vitest';
import type { DesignSystemSummary, PromptTemplateSummary, SkillSummary } from '../../src/types';
import {
  KOREAN_CONTENT_IDS,
  localizeDesignSystemSummary,
  localizePromptTemplateSummary,
  localizeSkillDescription,
  localizeSkillName,
  localizeSkillPrompt,
  hasLocalizedContent,
} from '../../src/i18n/content';
import {
  KO_DESIGN_SYSTEM_SUMMARIES,
  KO_PROMPT_TEMPLATE_CATEGORIES,
  KO_PROMPT_TEMPLATE_COPY,
  KO_PROMPT_TEMPLATE_TAGS,
  KO_SKILL_COPY,
} from '../../src/i18n/content.ko';
import { LOCALES } from '../../src/i18n/types';

function requireDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

describe('localized resource content', () => {
  it('derives localized ids only from localized dictionaries', () => {
    expect(KOREAN_CONTENT_IDS.skills).toContain('brandkit');
    expect(KOREAN_CONTENT_IDS.skills).not.toContain('nonexistent-skill');
    expect(KOREAN_CONTENT_IDS.designSystems).toContain('airbnb');
    expect(KOREAN_CONTENT_IDS.designSystems).not.toContain('nonexistent-system');
    expect(KOREAN_CONTENT_IDS.promptTemplates).toContain('3d-stone-staircase-evolution-infographic');
    expect(KOREAN_CONTENT_IDS.promptTemplates).not.toContain('nonexistent-template');
  });

  it('prefers localized skill copy and falls back to english field-by-field', () => {
    const localizedSkill = {
      id: 'brandkit',
      examplePrompt: '  English prompt from source.  ',
      description: '  English description from source.  ',
    } as unknown as SkillSummary;
    const brandkitCopy = requireDefined(KO_SKILL_COPY.brandkit);

    expect(localizeSkillPrompt('ko', localizedSkill)).toBe(
      brandkitCopy.examplePrompt,
    );
    expect(localizeSkillDescription('ko', localizedSkill)).toBe(
      brandkitCopy.description,
    );

    const englishOnlySkill = {
      id: 'english-only-skill',
      examplePrompt: '  English prompt from source.  ',
      description: '  English description from source.  ',
    } as unknown as SkillSummary;

    expect(localizeSkillPrompt('ko', englishOnlySkill)).toBe('English prompt from source.');
    expect(localizeSkillDescription('ko', englishOnlySkill)).toBe('English description from source.');
  });

  it('uses inline skill display metadata before falling back to source fields', () => {
    const inlineSkill = {
      id: 'inline-skill',
      name: 'inline-skill',
      displayName: {
        en: 'Inline Skill',
        ko: 'Inline Skill KO',
      },
      description: ' English description from source. ',
      descriptionI18n: {
        en: 'English inline description.',
        ko: 'Korean inline description.',
      },
      examplePrompt: ' English prompt from source. ',
      examplePromptI18n: {
        en: 'English inline prompt.',
        ko: 'Korean inline prompt.',
      },
    } as unknown as SkillSummary;

    expect(localizeSkillName('ko', inlineSkill)).toBe('Inline Skill KO');
    expect(localizeSkillName('en', inlineSkill)).toBe('Inline Skill');
    expect(localizeSkillDescription('ko', inlineSkill)).toBe('Korean inline description.');
    expect(localizeSkillDescription('en', inlineSkill)).toBe('English inline description.');
    expect(localizeSkillPrompt('ko', inlineSkill)).toBe('Korean inline prompt.');
    expect(localizeSkillPrompt('en', inlineSkill)).toBe('English inline prompt.');
  });

  it('prefers localized design system summaries and falls back to english when missing', () => {
    const localizedSystem = {
      id: 'agentic',
      summary: ' English summary from source. ',
      category: 'English category',
    } as DesignSystemSummary;

    expect(localizeDesignSystemSummary('ko', localizedSystem)).toBe(
      KO_DESIGN_SYSTEM_SUMMARIES.agentic,
    );

    const englishOnlySystem = {
      id: 'english-only-system',
      summary: ' English summary from source. ',
      category: 'English category',
    } as DesignSystemSummary;

    expect(localizeDesignSystemSummary('ko', englishOnlySystem)).toBe(' English summary from source. ');
  });

  it('prefers localized prompt template fields and falls back to english fields and tags', () => {
    const translatedTemplate = {
      id: '3d-stone-staircase-evolution-infographic',
      surface: 'image',
      title: 'English title',
      summary: 'English summary',
      category: 'Infographic',
      tags: ['3d', 'unknown-tag'],
      source: { repo: 'repo', license: 'MIT' },
    } satisfies PromptTemplateSummary;

    const localized = localizePromptTemplateSummary('ko', translatedTemplate);
    const expectedCopy = requireDefined(
      KO_PROMPT_TEMPLATE_COPY['3d-stone-staircase-evolution-infographic'],
    );
    expect(localized.title).toBe(expectedCopy.title);
    expect(localized.summary).toBe(expectedCopy.summary);
    expect(localized.category).toBe(KO_PROMPT_TEMPLATE_CATEGORIES.Infographic);
    expect(localized.tags).toEqual([KO_PROMPT_TEMPLATE_TAGS['3d'] ?? '3d', 'unknown-tag']);
    expect(
      localizePromptTemplateSummary('ko', { ...translatedTemplate, category: 'Unknown category' }).category,
    ).toBe('Unknown category');

    const englishOnlyTemplate = {
      ...translatedTemplate,
      id: 'english-only-template',
      title: ' English title from source ',
      summary: ' English summary from source ',
      category: 'General',
      tags: ['unknown-tag'],
    } satisfies PromptTemplateSummary;

    expect(localizePromptTemplateSummary('ko', englishOnlyTemplate)).toMatchObject({
      title: ' English title from source ',
      summary: ' English summary from source ',
      category: KO_PROMPT_TEMPLATE_CATEGORIES.General,
      tags: ['unknown-tag'],
    });
  });

  // Coverage lock: every supported non-English locale must resolve a
  // built-in-content bundle registered in LOCALIZED_CONTENT. When a locale has
  // no bundle, built-in copy silently renders English. This test locks every
  // non-English locale to a resolvable bundle so a future locale addition
  // cannot regress.
  it('resolves a built-in-content bundle for every supported non-English locale', () => {
    const missing = LOCALES.filter(
      (locale) => locale !== 'en' && !hasLocalizedContent(locale),
    );
    expect(
      missing,
      `These locales have no built-in-content bundle: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
