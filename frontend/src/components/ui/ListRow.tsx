import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from '@/lib/cx';
import { ChevronRightIcon, type IconComponent } from './icons';

interface ListRowProps {
  icon?: IconComponent;
  label: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  to?: string;
  href?: string;
  external?: boolean;
  onClick?: () => void;
  tone?: 'default' | 'danger';
  trailing?: ReactNode;
}

/** Settings-style row. Renders a link, button or static row depending on props. */
export function ListRow({ icon: Icon, label, description, value, to, href, external, onClick, tone = 'default', trailing }: ListRowProps) {
  const interactive = Boolean(to || href || onClick);
  const body = (
    <>
      {Icon ? (
        <span
          className={cx(
            'inline-flex size-10 shrink-0 items-center justify-center rounded-pill text-[1.3rem]',
            tone === 'danger' ? 'bg-red-50 text-red-600' : 'bg-ink-50 text-ink-800',
          )}
        >
          <Icon fontSize="inherit" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className={cx('block text-[0.9375rem] font-semibold', tone === 'danger' ? 'text-red-700' : 'text-ink-900')}>
          {label}
        </span>
        {description ? <span className="mt-0.5 block text-sm text-ink-600">{description}</span> : null}
      </span>
      {value ? <span className="shrink-0 text-sm text-ink-600">{value}</span> : null}
      {trailing}
      {interactive && !trailing ? <ChevronRightIcon fontSize="inherit" className="shrink-0 text-[1.35rem] text-ink-400" /> : null}
    </>
  );
  const classes = cx(
    'flex w-full items-center gap-3.5 px-4 py-3.5 text-left',
    interactive && 'press rounded-lg hover:bg-ink-50 focus-visible:bg-ink-50',
  );
  if (to) {
    return (
      <Link to={to} className={classes}>
        {body}
      </Link>
    );
  }
  if (href) {
    return (
      <a href={href} className={classes} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
}

export function ListGroup({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx('flex flex-col', className)}>
      {title ? <h2 className="caps mb-2 px-4 text-ink-600">{title}</h2> : null}
      <div className="flex flex-col rounded-xl bg-white p-1 ring-1 ring-inset ring-ink-100">{children}</div>
    </section>
  );
}
