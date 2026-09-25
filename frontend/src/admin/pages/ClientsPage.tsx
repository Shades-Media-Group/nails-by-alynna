import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Alert } from '@/components/common/Alert';
import { Avatar, Badge, Button, EmptyState, Skeleton } from '@/components/ui';
import { ChevronRightIcon, GroupIcon, PersonAddIcon, SearchIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { formatDayShort, formatPhone, fullName } from '@/lib/format';
import { adminQueries, type ClientListItem } from '../api';
import { AdminHeader } from '../components/AdminHeader';
import { useDebouncedValue } from '../components/hooks';
import { NewClientSheet } from '../components/NewClientSheet';
import { Pagination } from '../components/Pagination';
import { SearchField } from '../components/SearchField';
import { clientFromSearch } from '../components/utils';

/** Every client, newest first, searchable by name, phone or email; the query lives in the URL. */
export default function ClientsPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { lp } = useLocale();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1);
  const [text, setText] = useState(q);
  const [adding, setAdding] = useState(false);
  const typed = useDebouncedValue(text.trim(), 300);
  const clients = useQuery(adminQueries.clients({ q: q || undefined, page }));

  const setSearch = (patch: { q?: string; page?: number }) => {
    const next = new URLSearchParams(params);
    if (patch.q !== undefined) {
      if (patch.q) next.set('q', patch.q);
      else next.delete('q');
      next.delete('page');
    }
    if (patch.page !== undefined) {
      if (patch.page > 1) next.set('page', String(patch.page));
      else next.delete('page');
    }
    const search = next.toString();
    navigate({ pathname, search: search ? `?${search}` : '' }, { replace: true, preventScrollReset: true });
  };

  // The URL follows the search box once typing pauses.
  useEffect(() => {
    if (typed === q) return;
    const next = new URLSearchParams(params);
    if (typed) next.set('q', typed);
    else next.delete('q');
    next.delete('page');
    const search = next.toString();
    navigate({ pathname, search: search ? `?${search}` : '' }, { replace: true, preventScrollReset: true });
  }, [typed, q, params, pathname, navigate]);

  const data = clients.data;

  return (
    <div className="pb-8">
      <AdminHeader
        title={t('clients.title')}
        subtitle={data ? t('clients.count', { count: data.total }) : t('clients.subtitle')}
        actions={
          <Button size="sm" icon={PersonAddIcon} onClick={() => setAdding(true)}>
            {t('clients.new')}
          </Button>
        }
      />

      <div className="gutter-x mt-6 flex flex-col gap-4 lg:px-0">
        <SearchField label={t('clients.search')} value={text} onChange={setText} className="lg:max-w-md" />

        {clients.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} rounded="xl" className="h-20" />
            ))}
          </div>
        ) : clients.isError ? (
          <Alert>{errorMessage(t, clients.error)}</Alert>
        ) : data && data.clients.length === 0 ? (
          <div className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
            {q ? (
              <EmptyState
                icon={SearchIcon}
                tone="cyan"
                title={t('clients.noMatch', { q })}
                description={t('clients.noMatchText')}
                action={
                  <Button size="md" variant="soft" icon={PersonAddIcon} onClick={() => setAdding(true)}>
                    {t('clients.new')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={GroupIcon}
                title={t('clients.empty')}
                description={t('clients.emptyText')}
                action={
                  <Button size="md" icon={PersonAddIcon} onClick={() => setAdding(true)}>
                    {t('clients.new')}
                  </Button>
                }
              />
            )}
          </div>
        ) : data ? (
          <>
            <ul
              className={cx('flex flex-col rounded-2xl bg-white p-1 ring-1 ring-inset ring-ink-100 transition-opacity', clients.isPlaceholderData && 'opacity-60')}
              aria-busy={clients.isPlaceholderData || undefined}
            >
              {data.clients.map((client) => (
                <ClientRow key={client.id} client={client} to={lp(`/admin/clients/${client.id}`)} />
              ))}
            </ul>
            <Pagination page={data.page} pages={data.pages} busy={clients.isPlaceholderData} onPage={(p) => setSearch({ page: p })} />
          </>
        ) : null}
      </div>

      {adding ? (
        <NewClientSheet
          initial={q ? clientFromSearch(q) : undefined}
          onClose={() => setAdding(false)}
          onCreated={(client) => navigate(lp(`/admin/clients/${client.id}`))}
        />
      ) : null}
    </div>
  );
}

function ClientRow({ client: c, to }: { client: ClientListItem; to: string }) {
  const { t } = useTranslation(['admin', 'common']);
  const { locale } = useLocale();
  const { timeZone } = useStudio();
  return (
    <li>
      <Link to={to} className="press group flex items-center gap-3 rounded-xl p-3 hover:bg-ink-50 focus-visible:bg-ink-50">
        <Avatar name={c.name} surname={c.surname} />
        <span className="flex min-w-0 flex-1 flex-col gap-1 lg:flex-row lg:items-center lg:gap-6">
          <span className="min-w-0 lg:flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="break-words font-semibold">{fullName(c)}</span>
              {c.hasAccount ? <Badge tone="mint">{t('clients.inApp')}</Badge> : null}
              {c.bookingBlocked ? <Badge tone="red">{t('clients.blocked')}</Badge> : null}
              {!c.isActive ? <Badge tone="neutral">{t('clients.inactive')}</Badge> : null}
            </span>
            <span className="tabular mt-0.5 block break-words text-sm text-ink-600">
              {[formatPhone(c.phone), c.email].filter(Boolean).join(' · ') || t('client.noContact')}
            </span>
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-600 lg:w-72 lg:justify-end lg:text-sm">
            <span>{t('client.visits', { count: c.stats.visits })}</span>
            {c.stats.noShows > 0 ? <span className="font-semibold text-red-700">{t('appointment.noShowCount', { count: c.stats.noShows })}</span> : null}
            {c.stats.upcoming > 0 ? <span className="font-semibold text-rose-700">{t('clients.upcoming', { count: c.stats.upcoming })}</span> : null}
            {c.stats.lastVisit ? <span>{t('clients.lastVisit', { date: formatDayShort(c.stats.lastVisit, locale, timeZone) })}</span> : null}
          </span>
        </span>
        <ChevronRightIcon
          fontSize="inherit"
          className="shrink-0 text-xl text-ink-400 transition-transform duration-200 ease-(--ease-out) group-hover:translate-x-1"
        />
      </Link>
    </li>
  );
}
