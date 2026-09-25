import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui';
import { AutoAwesomeIcon, CheckCircleIcon } from '@/components/ui/icons';
import { useI18nText } from '@/hooks/useStudio';
import { cx } from '@/lib/cx';
import type { AdminStaff } from '../api';

/** "Any master" (the first one free) or a specific master, as a radio list. */
export function MasterPicker({
  masters,
  value,
  onChange,
  anyLabel,
  anyText,
}: {
  masters: AdminStaff[];
  value: string | null;
  onChange: (staffId: string | null) => void;
  anyLabel: string;
  anyText: string;
}) {
  const { t } = useTranslation('admin');
  const pick = useI18nText();

  const option = (key: string, active: boolean, onClick: () => void, avatar: ReactNode, title: string, subtitle: string) => (
    <li key={key}>
      <button
        type="button"
        role="radio"
        aria-checked={active}
        onClick={onClick}
        className={cx(
          'press flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 ring-inset transition-colors',
          active ? 'bg-blush-50 ring-rose-400' : 'bg-white ring-ink-100 hover:ring-ink-300',
        )}
      >
        {avatar}
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{title}</span>
          {subtitle ? <span className="block text-sm text-ink-600">{subtitle}</span> : null}
        </span>
        <CheckCircleIcon
          fontSize="inherit"
          className={cx('shrink-0 text-2xl text-rose-600 transition-[opacity,transform] duration-200', active ? 'scale-100 opacity-100' : 'scale-50 opacity-0')}
        />
      </button>
    </li>
  );

  return (
    <ul role="radiogroup" aria-label={t('booking.master')} className="flex flex-col gap-2">
      {option(
        'any',
        value === null,
        () => onChange(null),
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-pill bg-ink-900 text-xl text-white">
          <AutoAwesomeIcon fontSize="inherit" />
        </span>,
        anyLabel,
        anyText,
      )}
      {masters.map((member) =>
        option(member.id, value === member.id, () => onChange(member.id), <Avatar name={member.name} color={member.color} />, member.name, pick(member.title)),
      )}
    </ul>
  );
}
