import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useAuth } from '@/app/auth';
import { BUILD } from '@/build-info';
import { OtpInput } from '@/components/auth/OtpInput';
import { ResendCodeButton } from '@/components/auth/ResendCodeButton';
import { Alert } from '@/components/common/Alert';
import { DataExportSheet } from '@/components/profile/DataExportSheet';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import {
  Avatar,
  Button,
  ListGroup,
  ListRow,
  PasswordField,
  Sheet,
  Skeleton,
  TextField,
  toast,
} from '@/components/ui';
import {
  CookieIcon,
  DeleteIcon,
  DevicesIcon,
  DownloadIcon,
  EmailIcon,
  InstallIcon,
  KeyIcon,
  LanguageIcon,
  LockIcon,
  LogoutIcon,
  LoyaltyIcon,
  NotificationsIcon,
  PersonOutlineIcon,
  PrivacyIcon,
  ShieldIcon,
} from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { openConsentSettings } from '@/lib/consent';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { signedOutStart } from '@/lib/platform';
import { disablePush } from '@/lib/push';
import { isEmail, nameIssue, normalizePhone, passwordIssue } from '@/lib/validation';
import { isApiError } from '@/services/api/client';
import { authApi, meApi } from '@/services/api/endpoints';
import { useStudio } from '@/hooks/useStudio';

type Panel = 'details' | 'password' | 'devices' | 'delete' | 'export' | null;

export default function ProfilePage() {
  // 'auth' too: the change-email code step uses its strings, loaded before the sheet opens.
  const { t } = useTranslation(['account', 'common', 'auth']);
  const { lp, locale } = useLocale();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [panel, setPanel] = useState<Panel>(null);
  const close = () => setPanel(null);

  if (!user) return null;
  const memberSince = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(user.createdAt),
  );

  const signOut = async () => {
    // The next person using this phone must not get this account's notifications.
    await disablePush().catch(() => undefined);
    await logout().catch(() => undefined);
    navigate(lp(signedOutStart()), { replace: true });
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
            <ListRow
              icon={PersonOutlineIcon}
              label={t('profile.details')}
              description={t('profile.detailsText')}
              onClick={() => setPanel('details')}
            />
            <ListRow
              icon={NotificationsIcon}
              label={t('profile.notifications')}
              description={t('profile.notificationsText')}
              to={lp('/profile/notifications')}
            />
            <ListRow
              icon={LoyaltyIcon}
              label={t('profile.loyalty')}
              description={t('profile.loyaltyText')}
              to={lp('/loyalty')}
            />
            <ListRow
              icon={LanguageIcon}
              label={t('profile.language')}
              trailing={<LanguageSwitcher compact />}
            />
          </ListGroup>

          <ListGroup title={t('profile.security')}>
            {user.isDemo ? (
              <ListRow
                icon={KeyIcon}
                label={t('profile.passwordChange')}
                description={t('profile.demoLocked')}
                trailing={<Locked />}
              />
            ) : (
              <ListRow
                icon={KeyIcon}
                label={user.hasPassword ? t('profile.passwordChange') : t('profile.passwordSet')}
                description={
                  user.hasPassword
                    ? undefined
                    : user.hasGoogle
                      ? t('profile.passwordSetText')
                      : t('profile.passwordSetPlain')
                }
                onClick={() => setPanel('password')}
              />
            )}
            <ListRow
              icon={DevicesIcon}
              label={t('profile.devices')}
              description={t('profile.devicesText')}
              onClick={() => setPanel('devices')}
            />
          </ListGroup>
        </div>

        <div className="flex flex-col gap-6">
          <ListGroup title={t('profile.privacy')}>
            <ListRow icon={CookieIcon} label={t('profile.cookies')} onClick={openConsentSettings} />
            <ListRow
              icon={DownloadIcon}
              label={t('profile.export')}
              description={t('profile.exportText')}
              onClick={() => setPanel('export')}
            />
            <ListRow icon={PrivacyIcon} label={t('profile.privacyPolicy')} to={lp('/privacy')} />
            <ListRow
              icon={ShieldIcon}
              label={t('profile.terms')}
              description={t('profile.termsText')}
              to={lp('/terms')}
            />
          </ListGroup>

          <ListGroup title={t('profile.app')}>
            <ListRow icon={InstallIcon} label={t('profile.install')} to={lp('/app')} />
            <ListRow icon={LogoutIcon} label={t('profile.logout')} onClick={() => void signOut()} />
            {user.isDemo ? (
              <ListRow
                icon={DeleteIcon}
                label={t('profile.delete')}
                description={t('profile.demoLocked')}
                trailing={<Locked />}
              />
            ) : (
              <ListRow
                icon={DeleteIcon}
                tone="danger"
                label={t('profile.delete')}
                onClick={() => setPanel('delete')}
              />
            )}
          </ListGroup>
        </div>
      </div>

      <footer className="gutter-x mt-10 text-center text-xs text-ink-500 lg:px-0">
        <p>{t('profile.version', { version: BUILD.version })}</p>
        <a
          href="https://shades.md"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block font-semibold text-ink-700 underline-offset-4 hover:underline"
        >
          {t('profile.credit')}
        </a>
      </footer>

      <DetailsSheet open={panel === 'details'} onClose={close} />
      <DataExportSheet open={panel === 'export'} onClose={close} />
      <PasswordSheet open={panel === 'password'} onClose={close} />
      <DevicesSheet
        open={panel === 'devices'}
        onClose={close}
        onSignedOutEverywhere={() => void signOut()}
      />
      <DeleteSheet open={panel === 'delete'} onClose={close} />
    </div>
  );
}

type DetailsView =
  | { step: 'details'; changedTo?: string }
  | { step: 'email' }
  | { step: 'code'; email: string; resendAfterSec: number };
type DetailsFields = { name: string; surname: string; phone: string };

function DetailsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['account', 'common']);
  const { user } = useAuth();
  const [view, setView] = useState<DetailsView>({ step: 'details' });
  // Kept here, so a detour through "Change email" never loses what was typed.
  const [form, setForm] = useState<DetailsFields>({
    name: user?.name ?? '',
    surname: user?.surname ?? '',
    phone: user?.phone ?? '',
  });
  const close = () => {
    onClose();
    setView({ step: 'details' });
  };
  const title =
    view.step === 'details'
      ? t('profile.details')
      : view.step === 'email'
        ? t('profile.emailChange.title')
        : t('profile.emailChange.codeTitle');

  return (
    <Sheet open={open} onClose={close} title={title}>
      {view.step === 'details' ? (
        <DetailsForm
          form={form}
          onForm={setForm}
          changedTo={view.changedTo}
          onDone={close}
          onChangeEmail={() => setView({ step: 'email' })}
        />
      ) : view.step === 'email' ? (
        <EmailChangeForm
          onBack={() => setView({ step: 'details' })}
          onSent={(email, resendAfterSec) => setView({ step: 'code', email, resendAfterSec })}
        />
      ) : (
        <EmailCodeForm
          email={view.email}
          resendAfterSec={view.resendAfterSec}
          onBack={() => setView({ step: 'email' })}
          onChanged={(email) => setView({ step: 'details', changedTo: email })}
        />
      )}
    </Sheet>
  );
}

/** Change email, step 1: the new address (and the password, when the account has one). */
function EmailChangeForm({
  onBack,
  onSent,
}: {
  onBack: () => void;
  onSent: (email: string, resendAfterSec: number) => void;
}) {
  const { t } = useTranslation(['account', 'common']);
  const { locale } = useLocale();
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const start = useMutation({
    mutationFn: () =>
      meApi.startEmailChange({
        email: email.trim().toLowerCase(),
        ...(user?.hasPassword ? { password } : {}),
        locale,
      }),
    onSuccess: (verification) => onSent(verification.email, verification.resendAfterSec),
  });
  const server = fieldErrors(t, start.error);
  const emailError =
    touched && !isEmail(email) ? t('common:validation.invalid_email') : server.email;
  const passwordError =
    touched && user?.hasPassword && !password ? t('common:validation.required') : server.password;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!isEmail(email) || (user?.hasPassword && !password)) return;
    start.mutate();
  };

  return (
    <form className="flex flex-col gap-4 py-2" onSubmit={submit} noValidate>
      <p className="text-[0.9375rem] text-ink-600">{t('profile.emailChange.text')}</p>
      <TextField
        label={t('profile.emailChange.newEmail')}
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (start.isError) start.reset();
        }}
        error={emailError}
      />
      {user?.hasPassword ? (
        <PasswordField
          label={t('profile.emailChange.password')}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={passwordError}
        />
      ) : null}
      {start.isError && Object.keys(server).length === 0 ? (
        <Alert>{errorMessage(t, start.error)}</Alert>
      ) : null}
      <Button type="submit" size="lg" fullWidth loading={start.isPending}>
        {t('profile.emailChange.send')}
      </Button>
      <Button variant="ghost" size="md" fullWidth onClick={onBack}>
        {t('profile.emailChange.back')}
      </Button>
    </form>
  );
}

/** Change email, step 2: the code that went to the new address. */
function EmailCodeForm({
  email,
  resendAfterSec,
  onBack,
  onChanged,
}: {
  email: string;
  resendAfterSec: number;
  onBack: () => void;
  onChanged: (email: string) => void;
}) {
  const { t } = useTranslation(['account', 'auth', 'common']);
  const { locale } = useLocale();
  const { setUser } = useAuth();
  const errorId = useId();
  const [code, setCode] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const confirm = useMutation({
    mutationFn: (value: string) => meApi.confirmEmailChange({ email, code: value }),
    onSuccess: (updated) => {
      setUser(updated);
      onChanged(updated.email);
    },
    onError: (error) => {
      // A wrong code starts over; a network hiccup keeps what was typed.
      if (isApiError(error, 'CODE_INVALID')) {
        setCode('');
        setErrorKey((k) => k + 1);
      }
    },
  });
  const submit = (value: string) => {
    if (value.length === 6 && !confirm.isPending) confirm.mutate(value);
  };

  return (
    <form
      className="flex flex-col gap-5 py-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit(code);
      }}
    >
      <div className="flex flex-col gap-2">
        <p className="text-[0.9375rem] text-ink-600">
          <Trans
            t={t}
            i18nKey="profile.emailChange.codeText"
            values={{ email }}
            components={{ email: <strong className="break-all font-semibold text-ink-900" /> }}
          />
        </p>
        <p className="text-sm text-ink-600">{t('auth:verify.spam')}</p>
      </div>
      {confirm.isError ? (
        <Alert>
          <span id={errorId}>{errorMessage(t, confirm.error)}</span>
        </Alert>
      ) : null}
      <OtpInput
        label={t('auth:verify.codeLabel')}
        value={code}
        onChange={(value) => {
          setCode(value);
          if (confirm.isError) confirm.reset();
        }}
        onComplete={submit}
        invalid={isApiError(confirm.error, 'CODE_INVALID')}
        errorKey={errorKey}
        describedBy={confirm.isError ? errorId : undefined}
        busy={confirm.isPending}
        autoFocus
      />
      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={confirm.isPending}
        disabled={code.length < 6}
      >
        {t('profile.emailChange.confirm')}
      </Button>
      <div className="-mt-2 flex flex-col">
        <ResendCodeButton
          seconds={resendAfterSec}
          onResend={() => meApi.resendEmailChange(email, locale)}
        />
        <Button variant="ghost" size="md" fullWidth onClick={onBack}>
          {t('auth:verify.otherEmail')}
        </Button>
      </div>
    </form>
  );
}

function DetailsForm({
  form,
  onForm,
  changedTo,
  onDone,
  onChangeEmail,
}: {
  form: DetailsFields;
  onForm: (form: DetailsFields) => void;
  /** Set right after an email change: said here, since a toast would sit behind the sheet. */
  changedTo?: string;
  onDone: () => void;
  onChangeEmail: () => void;
}) {
  const { t } = useTranslation(['account', 'common']);
  const { user, setUser } = useAuth();
  const emailHintId = useId();
  const [touched, setTouched] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      meApi.update({
        name: form.name.trim(),
        surname: form.surname.trim(),
        phone: normalizePhone(form.phone) ?? form.phone,
      }),
    onSuccess: (updated) => {
      setUser(updated);
      toast.success(t('profile.saved'));
      onDone();
    },
  });

  const errors: Record<string, string | undefined> = {};
  if (touched) {
    const n = nameIssue(form.name);
    if (n) errors.name = t(`common:validation.${n}`);
    const s = nameIssue(form.surname);
    if (s) errors.surname = t(`common:validation.${s}`);
    if (form.phone && !normalizePhone(form.phone))
      errors.phone = t('common:validation.invalid_phone');
  }
  const server = fieldErrors(t, save.error);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (
      nameIssue(form.name) ||
      nameIssue(form.surname) ||
      (form.phone && !normalizePhone(form.phone))
    )
      return;
    save.mutate();
  };

  return (
    <form id="details-form" className="flex flex-col gap-4 py-2" onSubmit={submit} noValidate>
      {changedTo ? (
        <Alert tone="success">{t('profile.emailChange.changed', { email: changedTo })}</Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label={t('profile.name')}
          autoComplete="given-name"
          autoCapitalize="words"
          disabled={user?.isDemo}
          value={form.name}
          onChange={(e) => onForm({ ...form, name: e.target.value })}
          error={errors.name ?? server.name}
        />
        <TextField
          label={t('profile.surname')}
          autoComplete="family-name"
          autoCapitalize="words"
          disabled={user?.isDemo}
          value={form.surname}
          onChange={(e) => onForm({ ...form, surname: e.target.value })}
          error={errors.surname ?? server.surname}
        />
      </div>
      <TextField
        label={t('profile.phone')}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        disabled={user?.isDemo}
        value={form.phone}
        onChange={(e) => onForm({ ...form, phone: e.target.value })}
        error={errors.phone ?? server.phone}
      />
      {/* Not typed here: the address changes through its own flow (a code to the new one). */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-700">{t('profile.email')}</span>
        {user?.isDemo ? (
          <div className="flex min-h-14 items-center gap-3 rounded-[1.75rem] bg-ink-50 px-5 py-3">
            <EmailIcon fontSize="inherit" className="shrink-0 text-[1.25rem] text-ink-400" />
            <span className="min-w-0 flex-1 text-[0.9375rem] text-ink-900 [overflow-wrap:anywhere]">
              <EmailText email={user.email} />
            </span>
            <Locked />
          </div>
        ) : (
          <button
            type="button"
            onClick={onChangeEmail}
            aria-label={`${t('profile.emailChange.title')}: ${user?.email ?? ''}`}
            aria-describedby={emailHintId}
            className="group flex min-h-14 w-full items-center gap-3 rounded-[1.75rem] bg-ink-50 px-5 py-3 text-left transition-colors hover:bg-ink-100 active:bg-ink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900"
          >
            <EmailIcon fontSize="inherit" className="shrink-0 text-[1.25rem] text-ink-400" />
            <span className="min-w-0 flex-1 text-[0.9375rem] text-ink-900 [overflow-wrap:anywhere]">
              <EmailText email={user?.email ?? ''} />
            </span>
            <span className="shrink-0 text-sm font-semibold text-rose-700 underline-offset-4 group-hover:underline">
              {t('profile.changeEmail')}
            </span>
          </button>
        )}
        <p id={emailHintId} className="pl-1 text-sm text-ink-600">
          {user?.isDemo ? t('profile.emailDemo') : t('profile.emailHint')}
        </p>
      </div>
      {user?.isDemo ? (
        <Alert tone="info">{t('common:errors.codes.DEMO_READ_ONLY')}</Alert>
      ) : (
        <>
          {save.isError && Object.keys(server).length === 0 ? (
            <Alert>{errorMessage(t, save.error)}</Alert>
          ) : null}
          <Button type="submit" size="lg" fullWidth loading={save.isPending}>
            {t('profile.save')}
          </Button>
        </>
      )}
    </form>
  );
}

function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['account', 'common']);
  const { user, setUser } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [touched, setTouched] = useState(false);
  const change = useMutation({
    mutationFn: () =>
      meApi.changePassword({
        ...(user?.hasPassword ? { currentPassword: current } : {}),
        newPassword: next,
      }),
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
    <Sheet
      open={open}
      onClose={onClose}
      title={user?.hasPassword ? t('profile.passwordChange') : t('profile.passwordSet')}
      description={
        user?.hasPassword
          ? undefined
          : user?.hasGoogle
            ? t('profile.passwordSetText')
            : t('profile.passwordSetPlain')
      }
    >
      <form className="flex flex-col gap-4 py-2" onSubmit={submit} noValidate>
        <input
          type="email"
          name="username"
          autoComplete="username"
          value={user?.email ?? ''}
          readOnly
          hidden
        />
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
        {change.isError && Object.keys(server).length === 0 ? (
          <Alert>{errorMessage(t, change.error)}</Alert>
        ) : null}
        <Button type="submit" size="lg" fullWidth loading={change.isPending}>
          {t('profile.save')}
        </Button>
      </form>
    </Sheet>
  );
}

function DevicesSheet({
  open,
  onClose,
  onSignedOutEverywhere,
}: {
  open: boolean;
  onClose: () => void;
  onSignedOutEverywhere: () => void;
}) {
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
        <Button
          variant="outline"
          size="md"
          fullWidth
          loading={all.isPending}
          onClick={() => all.mutate()}
          className="text-red-700"
        >
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
                  <span className="block truncate text-[0.9375rem] font-semibold">
                    {deviceName(session.userAgent)}
                  </span>
                  <span className="block text-sm text-ink-600">
                    {session.current
                      ? t('profile.thisDevice')
                      : t('profile.lastActive', {
                          date: formatDateTime(session.lastUsedAt, locale, timeZone),
                        })}
                  </span>
                </span>
                {session.current ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={revoke.isPending && revoke.variables === session.id}
                    onClick={() => revoke.mutate(session.id)}
                  >
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
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
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
      await disablePush().catch(() => undefined);
      await logout().catch(() => undefined);
      navigate(lp(signedOutStart()), { replace: true });
    },
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('profile.deleteTitle')}
      description={t('profile.deleteText')}
      footer={
        <Button
          variant="danger"
          size="md"
          fullWidth
          loading={remove.isPending}
          disabled={user?.hasPassword && !password}
          onClick={() => remove.mutate()}
        >
          {t('profile.deleteConfirm')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 py-2">
        {user?.hasPassword ? (
          <PasswordField
            label={t('profile.deletePassword')}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        ) : null}
        {remove.isError ? <Alert>{errorMessage(t, remove.error)}</Alert> : null}
      </div>
    </Sheet>
  );
}

/** A long address breaks after the @, not in the middle of a word. */
function EmailText({ email }: { email: string }) {
  const at = email.indexOf('@');
  if (at < 0) return <>{email}</>;
  return (
    <>
      {email.slice(0, at + 1)}
      <wbr />
      {email.slice(at + 1)}
    </>
  );
}

function Locked() {
  return <LockIcon fontSize="inherit" className="shrink-0 text-[1.15rem] text-ink-400" />;
}
