import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '@/i18n/useLocale';
import { STUDIO_TZ_FALLBACK } from '@/lib/format';
import { queries } from '@/services/queries';
import type { Category, I18nText, Service } from '@/types/api';

/** Studio config (time zone, currency, contacts, booking rules). */
export function useStudio() {
  const config = useQuery(queries.config());
  return {
    ...config,
    timeZone: config.data?.studio.timezone ?? STUDIO_TZ_FALLBACK,
    currency: config.data?.studio.currency ?? 'MDL',
  };
}

/** Picks the current language from an {ro, ru, en} text with sensible fallbacks. */
export function useI18nText() {
  const { locale } = useLocale();
  return (text: I18nText | undefined | null): string => (text ? text[locale] || text.en || text.ro || '' : '');
}

/** Catalog with lookup helpers. */
export function useCatalog() {
  const catalog = useQuery(queries.catalog());
  const { i18n } = useTranslation();
  const helpers = useMemo(() => {
    const services = catalog.data?.services ?? [];
    const categories = catalog.data?.categories ?? [];
    const byId = new Map(services.map((s) => [s.id, s]));
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const grouped: Array<{ category: Category; services: Service[] }> = categories
      .map((category) => ({ category, services: services.filter((s) => s.categoryId === category.id) }))
      .filter((g) => g.services.length > 0);
    return { services, categories, byId, categoryById, grouped };
  }, [catalog.data]);
  return { ...catalog, ...helpers, language: i18n.language };
}
