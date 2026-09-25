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
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  backTo?: string;
  className?: string;
}) {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  return (
    <header className={cx('gutter-x flex flex-wrap items-end justify-between gap-3 pt-[calc(var(--safe-top)+1rem)] lg:px-0 lg:pt-8', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {backTo ? (
          <IconButton icon={ArrowBackIcon} label={t('common.back')} size="sm" variant="soft" onClick={() => navigate(backTo)} className="mt-0.5" />
        ) : null}
        <div className="min-w-0">
          <h1 className="text-h1 font-extrabold">{title}</h1>
          {subtitle ? <p className="mt-1 text-[0.9375rem] text-ink-600">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
