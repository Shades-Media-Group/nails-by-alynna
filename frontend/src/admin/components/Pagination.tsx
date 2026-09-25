import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/icons';

/** Previous / next with "Page 2 of 5" between (arrows only on phones); hidden when one page holds everything. */
export function Pagination({ page, pages, onPage, busy }: { page: number; pages: number; onPage: (page: number) => void; busy?: boolean }) {
  const { t } = useTranslation('admin');
  if (pages <= 1) return null;
  return (
    <nav aria-label={t('pagination.label')} className="flex items-center justify-between gap-3">
      <Button size="md" variant="outline" icon={ChevronLeftIcon} disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>
        <span className="sr-only sm:not-sr-only">{t('pagination.previous')}</span>
      </Button>
      <p className="tabular text-sm font-semibold text-ink-600" aria-live="polite">
        {t('pagination.page', { page, pages })}
      </p>
      <Button size="md" variant="outline" trailingIcon={ChevronRightIcon} disabled={page >= pages || busy} onClick={() => onPage(page + 1)}>
        <span className="sr-only sm:not-sr-only">{t('pagination.next')}</span>
      </Button>
    </nav>
  );
}
