import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { IconButton } from '@/components/ui';
import { ArrowBackIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Show a back button (navigates to `backTo`, or history back). */
  back?: boolean;
  backTo?: string;
  actions?: ReactNode;
  className?: string;
}

/** Screen title: large, tight and heavy; back button and actions sit on the same row. */
export function PageHeader({ title, subtitle, back, backTo, actions, className }: PageHeaderProps) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  return (
    <header className={cx('gutter-x pt-[calc(var(--safe-top)+1rem)] lg:px-0 lg:pt-10', className)}>
      {back || actions ? (
        <div className="mb-4 flex min-h-11 items-center justify-between gap-3">
          {back ? (
            <IconButton
              icon={ArrowBackIcon}
              label={t('actions.back')}
              variant="soft"
              onClick={() => (backTo ? navigate(backTo) : window.history.length > 1 ? navigate(-1) : navigate('/'))}
            />
          ) : (
            <span />
          )}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <h1 className="text-h1 font-extrabold">{title}</h1>
      {subtitle ? <div className="mt-2 text-ink-600">{subtitle}</div> : null}
    </header>
  );
}

/** Section heading with an optional trailing action (e.g. "See all"). */
export function SectionHeading({ title, action, className, id }: { title: string; action?: ReactNode; className?: string; id?: string }) {
  return (
    <div className={cx('mb-4 flex items-end justify-between gap-4', className)}>
      <h2 id={id} className="text-h2 font-extrabold">
        {title}
      </h2>
      {action}
    </div>
  );
}
