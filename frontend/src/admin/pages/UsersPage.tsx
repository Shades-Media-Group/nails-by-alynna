import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '@/app/auth';
import { Alert } from '@/components/common/Alert';
import { Avatar, Badge, Button, Chip, EmptyState, Sheet, Skeleton, Switch, toast, type BadgeTone } from '@/components/ui';
import { CheckCircleIcon, ChevronRightIcon, SearchIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { formatPhone, fullName } from '@/lib/format';
import type { Role } from '@/types/api';
import { adminApi, adminQueries, type AdminUser } from '../api';
import { AdminHeader } from '../components/AdminHeader';
import { useDebouncedValue, useNow } from '../components/hooks';
import { Pagination } from '../components/Pagination';
import { SearchField } from '../components/SearchField';
import { relativeTime } from '../components/utils';

const ROLES: Role[] = ['administrator', 'admin', 'client'];
const ROLE_TONE: Record<Role, BadgeTone> = { administrator: 'ink', admin: 'rose', client: 'neutral' };
const isRole = (value: string | null): value is Role => value !== null && (ROLES as string[]).includes(value);

function RoleBadge({ role }: { role: Role }) {
  const { t } = useTranslation('admin');
  return <Badge tone={ROLE_TONE[role]}>{t(`roles.${role}`)}</Badge>;
}

/** Who can do what (owner only): every account, its role and whether it can sign in. */
export default function UsersPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { user: me } = useAuth();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const rawRole = params.get('role');
  const role = isRole(rawRole) ? rawRole : null;
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1);
  const [text, setText] = useState(q);
  const typed = useDebouncedValue(text.trim(), 300);
  const now = useNow();
  const users = useQuery(adminQueries.users({ q: q || undefined, role: role ?? undefined, page }));
  const [managing, setManaging] = useState<AdminUser | null>(null);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
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

  const data = users.data;

  return (
    <div className="pb-8">
      <AdminHeader title={t('users.title')} subtitle={t('users.subtitle')} />

      <div className="gutter-x mt-6 flex flex-col gap-4 lg:px-0">
        <SearchField label={t('users.search')} value={text} onChange={setText} className="lg:max-w-md" />
        <div role="group" aria-label={t('users.filter')} className="no-scrollbar -mx-[var(--gutter)] flex gap-2 overflow-x-auto px-[var(--gutter)] lg:mx-0 lg:px-0">
          <Chip selected={!role} onClick={() => update({ role: null, page: null })}>
            {t('users.filters.all')}
          </Chip>
          {ROLES.map((r) => (
            <Chip key={r} selected={role === r} onClick={() => update({ role: r, page: null })}>
              {t(`users.filters.${r}`)}
            </Chip>
          ))}
        </div>

        {users.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} rounded="xl" className="h-20" />
            ))}
          </div>
        ) : users.isError ? (
          <Alert>{errorMessage(t, users.error)}</Alert>
        ) : data && data.users.length === 0 ? (
          <div className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
            <EmptyState icon={SearchIcon} tone="cyan" title={q ? t('users.noMatch', { q }) : t('users.empty')} />
          </div>
        ) : data ? (
          <>
            <p className="text-sm text-ink-600">{t('users.count', { count: data.total })}</p>
            <ul
              className={cx('flex flex-col rounded-2xl bg-white p-1 ring-1 ring-inset ring-ink-100 transition-opacity', users.isPlaceholderData && 'opacity-60')}
              aria-busy={users.isPlaceholderData || undefined}
            >
              {data.users.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setManaging(u)}
                    className="press group flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-ink-50"
                  >
                    <Avatar name={u.name} surname={u.surname} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="break-words font-semibold">{fullName(u)}</span>
                        {u.id === me?.id ? <Badge tone="lilac">{t('users.you')}</Badge> : null}
                      </span>
                      <span className="tabular block break-words text-sm text-ink-600">
                        {[u.email, formatPhone(u.phone)].filter(Boolean).join(' · ') || t('client.noContact')}
                      </span>
                      <span className="block text-xs text-ink-500">
                        {u.lastLoginAt
                          ? t('users.lastSeen', { when: relativeTime(u.lastLoginAt, locale, now) })
                          : u.hasAccount
                            ? t('users.neverSignedIn')
                            : t('users.noLogin')}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <RoleBadge role={u.role} />
                      {!u.isActive ? <Badge tone="red">{t('users.deactivated')}</Badge> : null}
                    </span>
                    <ChevronRightIcon fontSize="inherit" className="shrink-0 text-xl text-ink-400" />
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} pages={data.pages} busy={users.isPlaceholderData} onPage={(p) => update({ page: p > 1 ? String(p) : null })} />
          </>
        ) : null}
      </div>

      {managing ? <UserSheet user={managing} isSelf={managing.id === me?.id} onClose={() => setManaging(null)} /> : null}
    </div>
  );
}

/** Role and access for one account, with a confirmation step that says what will happen. */
function UserSheet({ user, isSelf, onClose }: { user: AdminUser; isSelf: boolean; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [role, setRole] = useState<Role>(user.role);
  const [active, setActive] = useState(user.isActive);
  const [confirming, setConfirming] = useState(false);
  const changed = role !== user.role || active !== user.isActive;

  const save = useMutation({
    mutationFn: () =>
      adminApi.updateUser(user.id, {
        ...(role !== user.role ? { role } : {}),
        ...(active !== user.isActive ? { isActive: active } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'staff'] });
      toast.success(t('users.saved', { name: user.name }));
      onClose();
    },
  });

  const summary: string[] = [];
  if (role !== user.role) summary.push(t('users.roleChange', { from: t(`roles.${user.role}`), to: t(`roles.${role}`) }));
  if (active !== user.isActive) summary.push(active ? t('users.willActivate') : t('users.willDeactivate'));

  return (
    <Sheet
      open
      onClose={onClose}
      title={fullName(user)}
      description={user.email ?? formatPhone(user.phone) ?? undefined}
      footer={
        isSelf ? (
          <Button size="md" variant="soft" fullWidth onClick={onClose}>
            {t('common.close')}
          </Button>
        ) : confirming ? (
          <div className="grid grid-cols-2 gap-2">
            <Button size="md" variant="soft" onClick={() => setConfirming(false)}>
              {t('common.back')}
            </Button>
            <Button size="md" variant={active ? 'primary' : 'danger'} loading={save.isPending} onClick={() => save.mutate()}>
              {t('users.confirm')}
            </Button>
          </div>
        ) : (
          <Button size="md" disabled={!changed} onClick={() => setConfirming(true)} className="min-w-32">
            {t('common.save')}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-5 py-2">
        {isSelf ? <Alert tone="info">{t('users.selfNote')}</Alert> : null}

        {confirming ? (
          <div className="flex flex-col gap-3">
            <p className="font-semibold">{t('users.confirmTitle')}</p>
            <ul className="flex flex-col gap-2">
              {summary.map((line) => (
                <li key={line} className="rounded-xl bg-ink-50 px-4 py-3 text-[0.9375rem]">
                  {line}
                </li>
              ))}
            </ul>
            <p className="text-sm text-ink-600">{t('users.signOutNote')}</p>
            {save.isError ? <Alert>{errorMessage(t, save.error)}</Alert> : null}
          </div>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2" disabled={isSelf}>
              <legend className="mb-2 text-sm font-semibold text-ink-700">{t('users.role')}</legend>
              <div role="radiogroup" aria-label={t('users.role')} className="flex flex-col gap-2">
                {ROLES.map((r) => {
                  const selected = role === r;
                  const locked = isSelf || (!user.hasAccount && r !== 'client');
                  return (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={locked}
                      onClick={() => setRole(r)}
                      className={cx(
                        'press flex w-full items-start gap-3 rounded-2xl p-3 text-left ring-1 ring-inset transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        selected ? 'bg-blush-50 ring-rose-400' : 'bg-white ring-ink-100 hover:ring-ink-300',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold">{t(`roles.${r}`)}</span>
                        <span className="block text-sm text-ink-600">{t(`users.roleText.${r}`)}</span>
                      </span>
                      <CheckCircleIcon
                        fontSize="inherit"
                        className={cx('mt-0.5 shrink-0 text-2xl text-rose-600 transition-opacity', selected ? 'opacity-100' : 'opacity-0')}
                      />
                    </button>
                  );
                })}
              </div>
              {!user.hasAccount ? <p className="text-sm text-ink-600">{t('users.noLoginNote')}</p> : null}
            </fieldset>
            <div className="rounded-2xl bg-ink-50 p-4">
              <Switch
                checked={active}
                disabled={isSelf}
                onChange={setActive}
                label={t('users.active')}
                description={active ? t('users.activeText') : t('users.inactiveText')}
              />
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
