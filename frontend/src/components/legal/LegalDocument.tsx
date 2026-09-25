import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Logo } from '@/components/brand/Logo';
import { IconButton } from '@/components/ui';
import { ArrowBackIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { formatPhone } from '@/lib/format';

/** Bump when a legal text changes in substance; shown as "Last updated". */
const LEGAL_UPDATED = '2026-09-25';

interface Section {
  id: string;
  title: string;
  body?: string[];
  items?: string[];
  after?: string[];
}

/**
 * Terms and Privacy share one reading layout: comfortable line length, a short contents list,
 * and the studio's own details (name, address, contact, cancellation window) filled in from
 * Settings, so the texts stay true when the studio changes them.
 */
export function LegalDocument({ doc }: { doc: 'privacy' | 'terms' }) {
  const { t } = useTranslation('legal');
  const { locale, lp } = useLocale();
  const navigate = useNavigate();
  const { data: config } = useStudio();
  const studio = config?.studio;

  const name = studio?.name || 'Nails by Alynna';
  const operator = studio?.legalName
    ? studio.legalId
      ? t('operatorFull', { legalName: studio.legalName, legalId: studio.legalId })
      : studio.legalName
    : name;
  const contact = [studio?.email, formatPhone(studio?.phone)].filter(Boolean).join(' · ') || name;
  const values = {
    studio: name,
    operator,
    city: studio?.city || 'Chișinău',
    place: [studio?.address, studio?.city].filter(Boolean).join(', ') || 'Chișinău',
    contact,
    hours: config?.booking.cancellationWindowHours ?? 12,
    interpolation: { escapeValue: false },
  };
  const sections = t(`${doc}.sections`, { returnObjects: true, ...values }) as Section[];
  const updated = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${LEGAL_UPDATED}T12:00:00Z`));

  return (
    <div className="min-h-dvh bg-white">
      <header className="gutter-x sticky top-0 z-20 border-b border-ink-100 bg-white/95 pt-[var(--safe-top)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3">
          <IconButton
            icon={ArrowBackIcon}
            label={t('common:actions.back')}
            size="sm"
            variant="soft"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(lp('/'), { replace: true }))}
          />
          <Logo variant="mark" className="w-10" />
        </div>
      </header>

      <article className="gutter-x mx-auto max-w-3xl pb-[calc(var(--safe-bottom)+3rem)] pt-6 animate-page">
        <h1 className="text-h1 font-extrabold lg:text-[2.25rem]">{t(`${doc}.title`)}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('updated', { date: updated })}</p>
        <p className="mt-4 max-w-[68ch] text-[0.9375rem] leading-relaxed text-ink-700">{t(`${doc}.intro`, values)}</p>

        <nav aria-labelledby="toc-title" className="mt-6 rounded-2xl bg-ink-50 p-4">
          <h2 id="toc-title" className="text-sm font-semibold text-ink-600">
            {t('contents')}
          </h2>
          <ol className="mt-2 grid list-decimal gap-x-6 gap-y-1 pl-5 text-[0.9375rem] marker:text-ink-400 sm:grid-cols-2">
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="font-medium text-ink-800 underline-offset-4 hover:text-rose-700 hover:underline">
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-8 flex flex-col gap-8">
          {sections.map((section, index) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="max-w-[68ch] scroll-mt-20">
              <h2 id={`${section.id}-title`} className="text-h2 font-extrabold">
                <span className="mr-2 tabular text-ink-400">{index + 1}.</span>
                {section.title}
              </h2>
              {section.body?.map((paragraph, i) => (
                <p key={i} className="mt-3 text-[0.9375rem] leading-relaxed text-ink-700">
                  {paragraph}
                </p>
              ))}
              {section.items ? (
                <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[0.9375rem] leading-relaxed text-ink-700 marker:text-rose-400">
                  {section.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {section.after?.map((paragraph, i) => (
                <p key={i} className="mt-3 text-[0.9375rem] leading-relaxed text-ink-700">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </div>
  );
}
