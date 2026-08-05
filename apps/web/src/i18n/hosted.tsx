'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ar } from './hosted-locales/ar';
import { de } from './hosted-locales/de';
import { esES } from './hosted-locales/es-ES';
import { fa } from './hosted-locales/fa';
import { fr } from './hosted-locales/fr';
import { hu } from './hosted-locales/hu';
import { id } from './hosted-locales/id';
import { ja } from './hosted-locales/ja';
import { pl } from './hosted-locales/pl';
import { ptBR } from './hosted-locales/pt-BR';
import { ru } from './hosted-locales/ru';
import { th } from './hosted-locales/th';
import { tr } from './hosted-locales/tr';
import { uk } from './hosted-locales/uk';
import { zhCN } from './hosted-locales/zh-CN';
import { zhTW } from './hosted-locales/zh-TW';
import { en } from './locales/en';
import { ko } from './locales/ko';
import type { Dict } from './types';

export const HOSTED_LOCALES = [
  'ar', 'de', 'en', 'es-ES', 'fa', 'fr', 'hu', 'id', 'ja', 'ko', 'pl',
  'pt-BR', 'ru', 'th', 'tr', 'uk', 'zh-CN', 'zh-TW',
] as const;

export type HostedLocale = (typeof HOSTED_LOCALES)[number];

export const HOSTED_PROVIDER_KEYS = [
  'hosted.provider.eyebrow',
  'hosted.provider.title',
  'hosted.provider.description',
  'hosted.provider.runtime',
  'hosted.provider.provider',
  'hosted.provider.apiKey',
  'hosted.provider.apiKeyPlaceholder',
  'hosted.provider.save',
  'hosted.provider.test',
  'hosted.provider.clear',
  'hosted.provider.loading',
  'hosted.provider.configured',
  'hosted.provider.notConfigured',
  'hosted.provider.setSuccess',
  'hosted.provider.testSuccess',
  'hosted.provider.clearSuccess',
  'hosted.provider.error',
] as const satisfies readonly (keyof Dict)[];

export type HostedProviderMessageKey = (typeof HOSTED_PROVIDER_KEYS)[number];

export type HostedProviderMessages = {
  [Key in HostedProviderMessageKey]: string;
};

function hostedMessagesFromGlobal(dict: Dict): HostedProviderMessages {
  return Object.fromEntries(
    HOSTED_PROVIDER_KEYS.map((key) => [key, dict[key]]),
  ) as HostedProviderMessages;
}

export const HOSTED_PROVIDER_MESSAGES: Record<HostedLocale, HostedProviderMessages> = {
  'ar': ar,
  'de': de,
  'en': hostedMessagesFromGlobal(en),
  'es-ES': esES,
  'fa': fa,
  'fr': fr,
  'hu': hu,
  'id': id,
  'ja': ja,
  'ko': hostedMessagesFromGlobal(ko),
  'pl': pl,
  'pt-BR': ptBR,
  'ru': ru,
  'th': th,
  'tr': tr,
  'uk': uk,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};

export function resolveHostedLocale(languages: readonly string[]): HostedLocale {
  for (const raw of languages) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) continue;
    const exact = HOSTED_LOCALES.find((locale) => locale.toLowerCase() === normalized);
    if (exact) return exact;
    const language = normalized.split('-')[0];
    const base = HOSTED_LOCALES.find((locale) => locale.toLowerCase().split('-')[0] === language);
    if (base) return base;
  }
  return 'en';
}

export function hostedDirection(locale: HostedLocale): 'ltr' | 'rtl' {
  return locale === 'ar' || locale === 'fa' ? 'rtl' : 'ltr';
}

export function translateHosted(
  locale: HostedLocale,
  key: HostedProviderMessageKey,
  vars?: Record<string, string | number>,
): string {
  const raw = HOSTED_PROVIDER_MESSAGES[locale][key];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = vars[name];
    return value == null ? `{${name}}` : String(value);
  });
}

type HostedTranslator = (
  key: HostedProviderMessageKey,
  vars?: Record<string, string | number>,
) => string;

const HostedI18nContext = createContext<HostedTranslator>((key, vars) => translateHosted('en', key, vars));

export function HostedI18nProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: HostedLocale;
}) {
  const [locale] = useState<HostedLocale>(() => initial ?? resolveHostedLocale(
    typeof navigator === 'undefined'
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language],
  ));

  useEffect(() => {
    document.documentElement.setAttribute('lang', locale);
    document.documentElement.setAttribute('dir', hostedDirection(locale));
  }, [locale]);

  const t = useCallback<HostedTranslator>(
    (key, vars) => translateHosted(locale, key, vars),
    [locale],
  );
  return <HostedI18nContext.Provider value={t}>{children}</HostedI18nContext.Provider>;
}

export function useHostedT(): HostedTranslator {
  return useContext(HostedI18nContext);
}
