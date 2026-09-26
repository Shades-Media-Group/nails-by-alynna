import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/app/auth';
import { Logo } from '@/components/brand/Logo';
import { Avatar, ListGroup, ListRow, Sheet } from '@/components/ui';
import {
  AddIcon,
  AdminIcon,
  CalendarIcon,
  DashboardIcon,
  GroupIcon,
  HistoryIcon,
  HomeIcon,
  LocalOfferIcon,
  LogoutIcon,
  MoreHorizIcon,
  PersonIcon,
  QrCodeScannerIcon,
  ScheduleIcon,
  SettingsIcon,
  SpaIcon,
  type IconComponent,
} from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { SWATCH, type SwatchColor } from '@/lib/swatch';
import { signedOutStart } from '@/lib/platform';
import { adminQueries } from '../api';

/** Each part of the admin has its own brand colour (a tile behind its icon), like iOS Settings. */
type Tone = SwatchColor | 'ink';
const TONES: Record<Tone, { tile: string; icon: string }> = {
  blush: { tile: SWATCH.blush.field, icon: SWATCH.blush.ink },
  cyan: { tile: SWATCH.cyan.field, icon: SWATCH.cyan.ink },
  peach: { tile: SWATCH.peach.field, icon: SWATCH.peach.ink },
  mint: { tile: SWATCH.mint.field, icon: SWATCH.mint.ink },
  lilac: { tile: SWATCH.lilac.field, icon: SWATCH.lilac.ink },
  ink: { tile: 'bg-ink-100', icon: 'text-ink-700' },
};

interface Item {
  to: string;
  label: string;
  icon: IconComponent;
  tone: Tone;
  end?: boolean;
  ownerOnly?: boolean;
  masterOnly?: boolean;
}

/**
 * Staff shell. Computers get a sidebar with every section; phones get a bottom bar with the
 * daily four (today, calendar, new booking, clients) and the rest under "More".
 */
export function AdminLayout() {
  const { t } = useTranslation(['admin', 'loyalty', 'promo']);
  const { lp } = useLocale();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const isOwner = user?.role === 'administrator';
  // Staff with a master profile set their own week; reception staff have none.
  const isMaster = useQuery(adminQueries.myStaff()).isSuccess;

  const items: Item[] = ([
    { to: lp('/admin'), label: t('nav.dashboard'), icon: DashboardIcon, tone: 'blush', end: true },
    { to: lp('/admin/calendar'), label: t('nav.calendar'), icon: CalendarIcon, tone: 'cyan' },
    { to: lp('/admin/clients'), label: t('nav.clients'), icon: GroupIcon, tone: 'peach' },
    { to: lp('/admin/scan'), label: t('loyalty:scan.nav'), icon: QrCodeScannerIcon, tone: 'lilac' },
    { to: lp('/admin/services'), label: t('nav.services'), icon: SpaIcon, tone: 'mint' },
    { to: lp('/admin/promo'), label: t('promo:admin.title'), icon: LocalOfferIcon, tone: 'blush' },
    { to: lp('/admin/schedule'), label: t('nav.mySchedule'), icon: ScheduleIcon, tone: 'cyan', masterOnly: true },
    { to: lp('/admin/team'), label: t('nav.team'), icon: PersonIcon, tone: 'peach' },
    { to: lp('/admin/settings'), label: t('nav.settings'), icon: SettingsIcon, tone: 'ink' },
    { to: lp('/admin/users'), label: t('nav.users'), icon: AdminIcon, tone: 'lilac', ownerOnly: true },
    { to: lp('/admin/audit'), label: t('nav.audit'), icon: HistoryIcon, tone: 'ink', ownerOnly: true },
  ] satisfies Item[]).filter((item) => (!item.ownerOnly || isOwner) && (!item.masterOnly || isMaster));

  const signOut = async () => {
    await logout().catch(() => undefined);
    navigate(lp(signedOutStart()), { replace: true });
  };

  return (
    <div className="min-h-dvh bg-ink-50/60">
      {/* Computers: sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-ink-100 bg-white px-4 pb-4 pt-5 lg:flex">
        <Link to={lp('/admin')} className="flex items-center gap-2 px-2">
          <Logo variant="mark" className="w-12" />
        </Link>
        <Link
          to={lp('/admin/appointments/new')}
          className="press group mt-6 flex h-11 items-center justify-center gap-2 rounded-pill bg-ink-900 px-4 text-[0.9375rem] font-semibold text-white hover:bg-ink-800"
        >
          <AddIcon fontSize="inherit" className="text-xl" />
          {t('nav.newBooking')}
        </Link>
        <nav aria-label={t('nav.menu')} className="mt-6 flex flex-1 flex-col gap-0.5">
          {items.map((item) => (
            <SideLink key={item.to} item={item} />
          ))}
        </nav>
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-ink-50 p-3">
          {user ? <Avatar name={user.name} surname={user.surname} size="sm" /> : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {user?.name} {user?.surname}
            </p>
            <p className="truncate text-xs text-ink-500">{user ? t(`roles.${user.role}`, { defaultValue: user.role }) : ''}</p>
          </div>
        </div>
        <div className="mt-2 flex flex-col gap-0.5">
          <SideLink item={{ to: lp('/home'), label: t('nav.clientApp'), icon: HomeIcon, tone: 'blush' }} />
          <button
            type="button"
            onClick={() => void signOut()}
            className="press flex h-11 items-center gap-3 rounded-xl px-2 text-[0.9375rem] font-medium text-ink-700 hover:bg-ink-50"
          >
            <span className={cx('inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-lg', TONES.ink.tile, TONES.ink.icon)}>
              <LogoutIcon fontSize="inherit" />
            </span>
            {t('nav.logout')}
          </button>
        </div>
      </aside>

      <main key={pathname} className="animate-page pb-[calc(var(--safe-bottom)+6rem)] lg:pb-12 lg:pl-64">
        <div className="mx-auto w-full max-w-6xl lg:px-8">
          <Outlet />
        </div>
      </main>

      {/* Phones: bottom bar */}
      <nav
        aria-label={t('nav.menu')}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white pb-[var(--safe-bottom)] lg:hidden"
      >
        <ul className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          <BarLink to={lp('/admin')} end icon={DashboardIcon} tone="blush" label={t('nav.dashboard')} />
          <BarLink to={lp('/admin/calendar')} icon={CalendarIcon} tone="cyan" label={t('nav.calendar')} />
          <li className="flex justify-center">
            <Link
              to={lp('/admin/appointments/new')}
              aria-label={t('nav.newBooking')}
              className="press flex size-12 items-center justify-center rounded-pill bg-ink-900 text-2xl text-white shadow-float"
            >
              <AddIcon fontSize="inherit" />
            </Link>
          </li>
          <BarLink to={lp('/admin/clients')} icon={GroupIcon} tone="peach" label={t('nav.clients')} />
          <li className="flex justify-center">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="press flex h-12 w-16 flex-col items-center justify-center gap-0.5 rounded-xl text-ink-600"
            >
              <MoreHorizIcon fontSize="inherit" className="text-2xl" />
              <span className="text-[0.6875rem] font-semibold">{t('nav.more')}</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t('nav.more')}>
        <div className="flex flex-col gap-4 py-2" onClick={() => setMoreOpen(false)}>
          <ListGroup>
            {items.slice(3).map((item) => (
              <ListRow key={item.to} icon={item.icon} iconTone={item.tone === 'ink' ? undefined : item.tone} label={item.label} to={item.to} />
            ))}
          </ListGroup>
          <ListGroup>
            <ListRow icon={HomeIcon} iconTone="blush" label={t('nav.clientApp')} to={lp('/home')} />
            <ListRow icon={LogoutIcon} label={t('nav.logout')} onClick={() => void signOut()} />
          </ListGroup>
        </div>
      </Sheet>
    </div>
  );
}

function SideLink({ item }: { item: Item }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cx(
          'press flex h-11 items-center gap-3 rounded-xl px-2 text-[0.9375rem] font-medium transition-colors',
          isActive ? 'bg-ink-50 font-semibold text-ink-900' : 'text-ink-700 hover:bg-ink-50',
        )
      }
    >
      <span className={cx('inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-lg', TONES[item.tone].tile, TONES[item.tone].icon)}>
        <item.icon fontSize="inherit" />
      </span>
      {item.label}
    </NavLink>
  );
}

/** Phones: the open section's icon sits on a pill in its own colour. */
function BarLink({ to, icon: Icon, label, tone, end }: { to: string; icon: IconComponent; label: string; tone: Tone; end?: boolean }): ReactNode {
  return (
    <li className="flex justify-center">
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) =>
          cx('press flex h-12 w-16 flex-col items-center justify-center gap-0.5 rounded-xl transition-colors', isActive ? 'text-ink-900' : 'text-ink-600')
        }
      >
        {({ isActive }) => (
          <>
            <span
              className={cx(
                'inline-flex h-7 w-12 items-center justify-center rounded-pill text-[1.35rem] transition-colors',
                isActive && [TONES[tone].tile, TONES[tone].icon],
              )}
            >
              <Icon fontSize="inherit" />
            </span>
            <span className="text-[0.6875rem] font-semibold">{label}</span>
          </>
        )}
      </NavLink>
    </li>
  );
}
