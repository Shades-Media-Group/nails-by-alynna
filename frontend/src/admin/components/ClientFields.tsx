import { useTranslation } from 'react-i18next';
import { TextField } from '@/components/ui';
import { CallIcon, EmailIcon } from '@/components/ui/icons';
import type { ClientFieldValues } from './utils';

/** Name, surname, phone and email of a client, as staff type them at the desk or on the phone. */
export function ClientFields({
  values,
  onChange,
  errors,
  emailLocked,
  emailHint,
  phoneRequired = true,
}: {
  values: ClientFieldValues;
  onChange: (values: ClientFieldValues) => void;
  /** Messages per field, already translated. */
  errors: Partial<Record<keyof ClientFieldValues, string>>;
  /** Clients with their own login manage their email themselves. */
  emailLocked?: boolean;
  emailHint?: string;
  phoneRequired?: boolean;
}) {
  const { t } = useTranslation('admin');
  const set = (key: keyof ClientFieldValues, value: string) => onChange({ ...values, [key]: value });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label={t('booking.name')}
          autoComplete="off"
          autoCapitalize="words"
          maxLength={60}
          required
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
        />
        <TextField
          label={t('booking.surname')}
          autoComplete="off"
          autoCapitalize="words"
          maxLength={60}
          required
          value={values.surname}
          onChange={(e) => set('surname', e.target.value)}
          error={errors.surname}
        />
      </div>
      <TextField
        label={phoneRequired ? t('booking.phone') : `${t('booking.phone')} (${t('common.optional')})`}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        icon={CallIcon}
        maxLength={32}
        required={phoneRequired}
        placeholder="069 123 456"
        value={values.phone}
        onChange={(e) => set('phone', e.target.value)}
        error={errors.phone}
      />
      <TextField
        label={`${t('booking.email')} (${t('common.optional')})`}
        type="email"
        inputMode="email"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        icon={EmailIcon}
        maxLength={254}
        disabled={emailLocked}
        value={values.email}
        onChange={(e) => set('email', e.target.value)}
        error={errors.email}
        hint={emailHint}
      />
    </div>
  );
}
