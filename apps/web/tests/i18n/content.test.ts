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
import { LOCALES } from '../../src/i18n/types';

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
    const partiallyLocalizedSkill = {
      id: 'brandkit',
      examplePrompt: '  English prompt from source.  ',
      description: '  English description from source.  ',
    } as unknown as SkillSummary;

    expect(localizeSkillPrompt('ko', partiallyLocalizedSkill)).toBe(
      '이 제품을 위한 프리미엄 브랜드 키트 개요 이미지를 만들어 주세요: 로고 방향성, 팔레트, 타이포그래피, 적용 사례, 그리고 일관된 비주얼 월드.',
    );
    expect(localizeSkillDescription('ko', partiallyLocalizedSkill)).toBe(
      'English description from source.',
    );
  });

  it('uses inline skill display metadata before falling back to source fields', () => {
    const inlineSkill = {
      id: 'inline-skill',
      name: 'inline-skill',
      displayName: {
        en: 'Inline Skill',
        ko: '인라인 스킬',
      },
      description: ' English description from source. ',
      descriptionI18n: {
        en: 'English inline description.',
        ko: '한국어 인라인 설명.',
      },
      examplePrompt: ' English prompt from source. ',
      examplePromptI18n: {
        en: 'English inline prompt.',
        ko: '한국어 인라인 prompt.',
      },
    } as unknown as SkillSummary;

    expect(localizeSkillName('ko', inlineSkill)).toBe('인라인 스킬');
    expect(localizeSkillName('en', inlineSkill)).toBe('Inline Skill');
    expect(localizeSkillDescription('ko', inlineSkill)).toBe('한국어 인라인 설명.');
    expect(localizeSkillDescription('en', inlineSkill)).toBe('English inline description.');
    expect(localizeSkillPrompt('ko', inlineSkill)).toBe('한국어 인라인 prompt.');
    expect(localizeSkillPrompt('en', inlineSkill)).toBe('English inline prompt.');
  });

  it('falls back to english design system summaries when localized copy is missing', () => {
    const englishOnlySystem = {
      id: 'agentic',
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
    expect(localized.title).toBe('3D 스톤 계단 진화 인포그래픽');
    expect(localized.summary).toBe(
      '평면의 진화 타임라인을 입체적인 돌 계단 형태의 3D 인포그래픽으로 전환하세요. 생명체의 상세한 렌더링과 구조화된 사이드 패널을 포함합니다.',
    );
    expect(localized.category).toBe('인포그래픽');
    expect(localized.tags).toEqual(['3d', 'unknown-tag']);
    expect(
      localizePromptTemplateSummary('ko', { ...translatedTemplate, category: 'Unknown category' }).category,
    ).toBe('Unknown category');

    const englishOnlyTemplate = {
      ...translatedTemplate,
      id: 'notion-team-dashboard-live-artifact',
      title: ' English title from source ',
      summary: ' English summary from source ',
      category: 'General',
      tags: ['unknown-tag'],
    } satisfies PromptTemplateSummary;

    expect(localizePromptTemplateSummary('ko', englishOnlyTemplate)).toMatchObject({
      title: ' English title from source ',
      summary: ' English summary from source ',
      category: '일반',
      tags: ['unknown-tag'],
    });
  });

  // Coverage lock: every supported non-English locale must resolve a
  // built-in-content bundle registered in LOCALIZED_CONTENT. When a locale has
  // no bundle, built-in copy silently renders English — this test locks every
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
