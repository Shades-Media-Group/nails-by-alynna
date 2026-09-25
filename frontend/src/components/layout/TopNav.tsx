import { useTranslation } from 'react-i18next';
import { Link, NavLink } from 'react-router';
import { useAuth } from '@/app/auth';
import { Logo } from '@/components/brand/Logo';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { Avatar, ButtonLink } from '@/components/ui';
import { AddIcon, DashboardIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { useClientNav } from './nav';

/** Desktop navigation (lg+). Phones use the floating TabBar instead. */
export function TopNav() {
  const { t } = useTranslation('common');
  const { lp } = useLocale();
  const { user, isStaff } = useAuth();
  const items = useClientNav();

  return (
    <header className="sticky top-0 z-40 hidden border-b border-ink-100 bg-white/90 backdrop-blur-md lg:block">
      <div className="mx-auto flex h-18 max-w-6xl items-center gap-8 px-8">
        <Link to={lp('/home')} className="shrink-0" aria-label={t('nav.home')}>
          <Logo variant="mark" className="w-24" />
        </Link>
        <nav aria-label={t('nav.main')} className="flex items-center gap-1">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cx(
                  'flex h-10 items-center gap-2 rounded-pill px-4 text-sm font-semibold transition-colors',
                  isActive ? 'bg-blush-100 text-ink-900' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900',
                )
              }
            >
              <item.icon fontSize="inherit" className="text-lg" />
              {item.label}
            </NavLink>
          ))}
          {isStaff ? (
            <NavLink
              to={lp('/admin')}
              className="flex h-10 items-center gap-2 rounded-pill px-4 text-sm font-semibold text-ink-600 hover:bg-ink-50 hover:text-ink-900"
            >
              <DashboardIcon fontSize="inherit" className="text-lg" />
              {t('nav.admin')}
            </NavLink>
          ) : null}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LanguageSwitcher compact />
          <ButtonLink to={lp('/book')} size="md" icon={AddIcon}>
            {t('actions.bookNow')}
          </ButtonLink>
          {user ? (
            <Link to={lp('/profile')} aria-label={t('nav.profile')} className="rounded-pill">
              <Avatar name={user.name} surname={user.surname} size="md" />
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
