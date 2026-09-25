import { useTranslation } from 'react-i18next';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { formatPhone } from '@/lib/format';

/** Bump when a legal text changes in substance; shown as "Last updated". */
export const LEGAL_UPDATED = '2026-09-25';

export type LegalDoc = 'privacy' | 'terms';

interface Section {
  id: string;
  title: string;
  body?: string[];
  items?: string[];
  after?: string[];
}

/**
 * The text of Terms or Privacy with the studio's own details (name, address, contact,
 * cancellation window) filled in from Settings, so it stays true when the studio changes them.
 * Rendered by the full page and by the in-app sheet (sign-up), which never leaves the app.
 */
export function LegalContent({ doc, inSheet = false }: { doc: LegalDoc; inSheet?: boolean }) {
  const { t } = useTranslation('legal');
  const { locale } = useLocale();
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
  const anchor = (id: string) => (inSheet ? `legal-sheet-${id}` : id);

  // Contents links scroll in place. A plain #hash click would add a history entry the router
  // treats as a new page (Back needing two taps, the scroll snapping back to the top). On the
  // page the address still gets the #section, so it can be shared; in a sheet only the sheet moves.
  const jump = (id: string) => (event: React.MouseEvent) => {
    const target = document.getElementById(anchor(id));
    if (!target) return;
    event.preventDefault();
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (inSheet) {
      const box = target.closest<HTMLElement>('[data-sheet-body]');
      if (!box) return;
      const top = target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 12;
      box.scrollTo({ top, behavior });
      return;
    }
    target.scrollIntoView({ behavior, block: 'start' });
    window.history.replaceState(window.history.state, '', `#${id}`);
  };

  return (
    <>
      {inSheet ? null : <h1 className="text-h1 font-extrabold lg:text-[2.25rem]">{t(`${doc}.title`)}</h1>}
      <p className={inSheet ? 'text-sm text-ink-500' : 'mt-1 text-sm text-ink-500'}>{t('updated', { date: updated })}</p>
      <p className="mt-4 max-w-[68ch] text-[0.9375rem] leading-relaxed text-ink-700">{t(`${doc}.intro`, values)}</p>

      <nav aria-label={t('contents')} className="mt-6 rounded-2xl bg-ink-50 p-4">
        <p className="text-sm font-semibold text-ink-600">{t('contents')}</p>
        <ol className="mt-2 grid list-decimal gap-x-6 gap-y-1 pl-5 text-[0.9375rem] marker:text-ink-400 sm:grid-cols-2">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${anchor(section.id)}`}
                onClick={jump(section.id)}
                className="font-medium text-ink-800 underline-offset-4 hover:text-rose-700 hover:underline"
              >
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-8 flex flex-col gap-8">
        {sections.map((section, index) => (
          <section
            key={section.id}
            id={anchor(section.id)}
            aria-labelledby={`${anchor(section.id)}-title`}
            className="max-w-[68ch] scroll-mt-20"
          >
            <h2 id={`${anchor(section.id)}-title`} className={inSheet ? 'text-h3 font-extrabold' : 'text-h2 font-extrabold'}>
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
    </>
  );
}
