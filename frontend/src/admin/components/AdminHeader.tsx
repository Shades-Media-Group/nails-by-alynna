import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui';
import { ArrowBackIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';

/** Page title row for staff screens: optional back, title and subtitle, actions on the right. */
export function AdminHeader({
  title,
  subtitle,
  actions,
  backTo,
  backInHistory,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  backTo?: string;
  /**
   * Back returns to the previous screen of the app when there is one (a detail opened from the
   * dashboard, a client or the log), and to `backTo` when the page was opened directly.
   */
  backInHistory?: boolean;
  className?: string;
}) {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const back = () => {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (backInHistory && index > 0) navigate(-1);
    else if (backTo) navigate(backTo);
  };
  return (
    <header className={cx('gutter-x flex flex-wrap items-end justify-between gap-3 pt-[calc(var(--safe-top)+1rem)] lg:px-0 lg:pt-8', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {backTo ? <IconButton icon={ArrowBackIcon} label={t('common.back')} size="sm" variant="soft" onClick={back} className="mt-0.5" /> : null}
        <div className="min-w-0">
          <h1 className="text-h1 font-extrabold">{title}</h1>
          {subtitle ? <p className="mt-1 text-[0.9375rem] text-ink-600">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
