import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useAuth } from '@/app/auth';
import { BUILD } from '@/build-info';
import { Alert } from '@/components/common/Alert';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { Avatar, Button, ListGroup, ListRow, PasswordField, Sheet, Skeleton, TextField, toast } from '@/components/ui';
import {
  CookieIcon,
  DeleteIcon,
  DevicesIcon,
  DownloadIcon,
  InstallIcon,
  KeyIcon,
  LanguageIcon,
  LogoutIcon,
  PersonOutlineIcon,
  PrivacyIcon,
  ShieldIcon,
} from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { openConsentSettings } from '@/lib/consent';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { nameIssue, normalizePhone, passwordIssue } from '@/lib/validation';
import { authApi, meApi } from '@/services/api/endpoints';
import { useStudio } from '@/hooks/useStudio';

type Panel = 'details' | 'password' | 'devices' | 'delete' | null;

export default function ProfilePage() {
  const { t } = useTranslation(['account', 'common']);
  const { lp, locale } = useLocale();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [panel, setPanel] = useState<Panel>(null);
  const close = () => setPanel(null);

  if (!user) return null;
  const memberSince = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(user.createdAt));

  const signOut = async () => {
    await logout().catch(() => undefined);
    navigate(lp('/login'), { replace: true });
  };

  return (
    <div className="pb-8">
      <header className="gutter-x flex items-center gap-4 pt-[calc(var(--safe-top)+1.25rem)] lg:px-0 lg:pt-10">
        <Avatar name={user.name} surname={user.surname} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-h1 font-extrabold">
            {user.name} {user.surname}
          </h1>
          <p className="truncate text-sm text-ink-600">{user.email}</p>
          <p className="text-xs text-ink-500">{t('profile.memberSince', { date: memberSince })}</p>
        </div>
      </header>

      <div className="gutter-x mt-6 flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:px-0">
        <div className="flex flex-col gap-6">
          <ListGroup title={t('profile.title')}>
            <ListRow icon={PersonOutlineIcon} label={t('profile.details')} description={t('profile.detailsText')} onClick={() => setPanel('details')} />
            <ListRow icon={LanguageIcon} label={t('profile.language')} trailing={<LanguageSwitcher compact />} />
          </ListGroup>

          <ListGroup title={t('profile.security')}>
            <ListRow
              icon={KeyIcon}
              label={user.hasPassword ? t('profile.passwordChange') : t('profile.passwordSet')}
              description={user.hasPassword ? undefined : user.hasGoogle ? t('profile.passwordSetText') : t('profile.passwordSetPlain')}
              onClick={() => setPanel('password')}
            />
            <ListRow icon={DevicesIcon} label={t('profile.devices')} description={t('profile.devicesText')} onClick={() => setPanel('devices')} />
          </ListGroup>
        </div>

        <div className="flex flex-col gap-6">
          <ListGroup title={t('profile.privacy')}>
            <ListRow icon={CookieIcon} label={t('profile.cookies')} onClick={openConsentSettings} />
            <ListRow icon={DownloadIcon} label={t('profile.export')} description={t('profile.exportText')} href={meApi.exportUrl()} />
            <ListRow icon={PrivacyIcon} label={t('profile.privacyPolicy')} to={lp('/privacy')} />
            <ListRow icon={ShieldIcon} label={t('profile.terms')} to={lp('/terms')} />
          </ListGroup>

          <ListGroup title={t('profile.app')}>
            <ListRow icon={InstallIcon} label={t('profile.install')} to={lp('/app')} />
            <ListRow icon={LogoutIcon} label={t('profile.logout')} onClick={() => void signOut()} />
            <ListRow icon={DeleteIcon} tone="danger" label={t('profile.delete')} onClick={() => setPanel('delete')} />
          </ListGroup>
        </div>
      </div>

      <footer className="gutter-x mt-10 text-center text-xs text-ink-500 lg:px-0">
        <p>{t('profile.version', { version: `${BUILD.version} (${BUILD.commit})` })}</p>
        <a href="https://shades.md" target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-semibold text-ink-700 underline-offset-4 hover:underline">
          {t('profile.credit')}
        </a>
      </footer>

      <DetailsSheet open={panel === 'details'} onClose={close} />
      <PasswordSheet open={panel === 'password'} onClose={close} />
      <DevicesSheet open={panel === 'devices'} onClose={close} onSignedOutEverywhere={() => void signOut()} />
      <DeleteSheet open={panel === 'delete'} onClose={close} />
    </div>
  );
}

function DetailsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['account', 'common']);
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({ name: user?.name ?? '', surname: user?.surname ?? '', phone: user?.phone ?? '' });
  const [touched, setTouched] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      meApi.update({ name: form.name.trim(), surname: form.surname.trim(), phone: normalizePhone(form.phone) ?? form.phone }),
    onSuccess: (updated) => {
      setUser(updated);
      toast.success(t('profile.saved'));
      onClose();
    },
  });

  const errors: Record<string, string | undefined> = {};
  if (touched) {
    const n = nameIssue(form.name);
    if (n) errors.name = t(`common:validation.${n}`);
    const s = nameIssue(form.surname);
    if (s) errors.surname = t(`common:validation.${s}`);
    if (form.phone && !normalizePhone(form.phone)) errors.phone = t('common:validation.invalid_phone');
  }
  const server = fieldErrors(t, save.error);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (nameIssue(form.name) || nameIssue(form.surname) || (form.phone && !normalizePhone(form.phone))) return;
    save.mutate();
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('profile.details')}>
      <form id="details-form" className="flex flex-col gap-4 py-2" onSubmit={submit} noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label={t('profile.name')} autoComplete="given-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name ?? server.name} />
          <TextField label={t('profile.surname')} autoComplete="family-name" value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} error={errors.surname ?? server.surname} />
        </div>
        <TextField label={t('profile.phone')} type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={errors.phone ?? server.phone} />
        <TextField label={t('profile.email')} value={user?.email ?? ''} readOnly hint={t('profile.emailHint')} />
        {save.isError && Object.keys(server).length === 0 ? <Alert>{errorMessage(t, save.error)}</Alert> : null}
        <Button type="submit" size="lg" fullWidth loading={save.isPending}>
          {t('profile.save')}
        </Button>
      </form>
    </Sheet>
  );
}

function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['account', 'common']);
  const { user, setUser } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [touched, setTouched] = useState(false);
  const change = useMutation({
    mutationFn: () => meApi.changePassword({ ...(user?.hasPassword ? { currentPassword: current } : {}), newPassword: next }),
    onSuccess: () => {
      if (user) setUser({ ...user, hasPassword: true });
      toast.success(t('profile.passwordChanged'));
      setCurrent('');
      setNext('');
      onClose();
    },
  });
  const issue = passwordIssue(next, user?.email ?? '');
  const server = fieldErrors(t, change.error);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (issue || (user?.hasPassword && !current)) return;
    change.mutate();
  };

  return (
    <Sheet open={open} onClose={onClose} title={user?.hasPassword ? t('profile.passwordChange') : t('profile.passwordSet')} description={user?.hasPassword ? undefined : user?.hasGoogle ? t('profile.passwordSetText') : t('profile.passwordSetPlain')}>
      <form className="flex flex-col gap-4 py-2" onSubmit={submit} noValidate>
        <input type="email" name="username" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
        {user?.hasPassword ? (
          <PasswordField
            label={t('profile.currentPassword')}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            error={touched && !current ? t('common:validation.required') : server.currentPassword}
          />
        ) : null}
        <PasswordField
          label={t('profile.newPassword')}
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={touched && issue ? t(`common:validation.${issue}`) : server.newPassword}
        />
        {change.isError && Object.keys(server).length === 0 ? <Alert>{errorMessage(t, change.error)}</Alert> : null}
        <Button type="submit" size="lg" fullWidth loading={change.isPending}>
          {t('profile.save')}
        </Button>
      </form>
    </Sheet>
  );
}

function DevicesSheet({ open, onClose, onSignedOutEverywhere }: { open: boolean; onClose: () => void; onSignedOutEverywhere: () => void }) {
  const { t } = useTranslation(['account', 'common']);
  const { locale } = useLocale();
  const { timeZone } = useStudio();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: authApi.sessions, enabled: open });
  const revoke = useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast.success(t('profile.deviceSignedOut'));
    },
  });
  const all = useMutation({
    mutationFn: authApi.logoutAll,
    onSuccess: () => {
      toast.success(t('profile.loggedOutAll'));
      onClose();
      onSignedOutEverywhere();
    },
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('profile.devices')}
      description={t('profile.devicesText')}
      footer={
        <Button variant="outline" size="md" fullWidth loading={all.isPending} onClick={() => all.mutate()} className="text-red-700">
          {t('profile.logoutAll')}
        </Button>
      }
    >
      <ul className="flex flex-col divide-y divide-ink-100 py-1">
        {sessions.isPending
          ? [0, 1].map((i) => (
              <li key={i} className="py-3">
                <Skeleton className="h-10" />
              </li>
            ))
          : (sessions.data ?? []).map((session) => (
              <li key={session.id} className="flex items-center gap-3 py-3">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-ink-50 text-xl text-ink-800">
                  <DevicesIcon fontSize="inherit" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem] font-semibold">{deviceName(session.userAgent)}</span>
                  <span className="block text-sm text-ink-600">
                    {session.current ? t('profile.thisDevice') : t('profile.lastActive', { date: formatDateTime(session.lastUsedAt, locale, timeZone) })}
                  </span>
                </span>
                {session.current ? null : (
                  <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables === session.id} onClick={() => revoke.mutate(session.id)}>
                    {t('profile.signOutDevice')}
                  </Button>
                )}
              </li>
            ))}
      </ul>
    </Sheet>
  );
}

/** "iPhone · Safari" from a user agent, good enough to recognise your own devices. */
function deviceName(userAgent: string): string {
  const ua = userAgent || '';
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [device, browser].filter(Boolean).join(' · ') || ua.slice(0, 40) || '?';
}

function DeleteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['account', 'common']);
  const { lp } = useLocale();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const remove = useMutation({
    mutationFn: () => meApi.deleteAccount(user?.hasPassword ? password : undefined),
    onSuccess: async () => {
      toast.success(t('profile.deleted'));
      await logout().catch(() => undefined);
      navigate(lp('/login'), { replace: true });
    },
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('profile.deleteTitle')}
      description={t('profile.deleteText')}
      footer={
        <Button variant="danger" size="md" fullWidth loading={remove.isPending} disabled={user?.hasPassword && !password} onClick={() => remove.mutate()}>
          {t('profile.deleteConfirm')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 py-2">
        {user?.hasPassword ? (
          <PasswordField label={t('profile.deletePassword')} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        ) : null}
        {remove.isError ? <Alert>{errorMessage(t, remove.error)}</Alert> : null}
      </div>
    </Sheet>
  );
}
