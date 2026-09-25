import { useTranslation } from 'react-i18next';
import { Avatar, Skeleton } from '@/components/ui';
import { AutoAwesomeIcon, CheckCircleIcon } from '@/components/ui/icons';
import { useI18nText } from '@/hooks/useStudio';
import { useEligibleMasters } from '@/hooks/useEligibleMasters';
import { cx } from '@/lib/cx';

export function MasterStep({
  serviceIds,
  selected,
  onSelect,
}: {
  serviceIds: string[];
  selected: string | null;
  onSelect: (staffId: string | null) => void;
}) {
  const { t } = useTranslation('booking');
  const pick = useI18nText();
  const { eligible, isPending } = useEligibleMasters(serviceIds);

  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} rounded="xl" className="h-18" />
        ))}
      </div>
    );
  }

  const option = (key: string, active: boolean, onClick: () => void, avatar: React.ReactNode, title: string, subtitle: string) => (
    <li key={key}>
      <button
        type="button"
        role="radio"
        aria-checked={active}
        onClick={onClick}
        className={cx(
          'press lift flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 ring-inset transition-colors',
          active ? 'bg-blush-50 ring-rose-400' : 'bg-white ring-ink-100 hover:ring-ink-300',
        )}
      >
        {avatar}
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{title}</span>
          <span className="block truncate text-sm text-ink-600">{subtitle}</span>
        </span>
        <CheckCircleIcon
          fontSize="inherit"
          className={cx('shrink-0 text-2xl text-rose-600 transition-[opacity,transform] duration-200', active ? 'scale-100 opacity-100' : 'scale-50 opacity-0')}
        />
      </button>
    </li>
  );

  return (
    <ul role="radiogroup" aria-label={t('flow.chooseMaster')} className="flex flex-col gap-2">
      {option(
        'any',
        selected === null,
        () => onSelect(null),
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-pill bg-ink-900 text-xl text-white">
          <AutoAwesomeIcon fontSize="inherit" />
        </span>,
        t('flow.anyMaster'),
        t('flow.anyMasterText'),
      )}
      {eligible.map((member) =>
        option(
          member.id,
          selected === member.id,
          () => onSelect(member.id),
          <Avatar name={member.name} color={member.color} />,
          member.name,
          pick(member.title),
        ),
      )}
    </ul>
  );
}
