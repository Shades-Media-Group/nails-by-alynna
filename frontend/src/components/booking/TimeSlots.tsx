import { useTranslation } from 'react-i18next';
import { cx } from '@/lib/cx';
import type { Slot } from '@/types/api';

/** Free start times grouped into morning / afternoon / evening. */
export function TimeSlots({ slots, selected, onSelect }: { slots: Slot[]; selected: string | null; onSelect: (slot: Slot) => void }) {
  const { t } = useTranslation('common');
  const groups = [
    { key: 'morning', label: t('time.morning'), items: slots.filter((s) => s.time < '12:00') },
    { key: 'afternoon', label: t('time.afternoon'), items: slots.filter((s) => s.time >= '12:00' && s.time < '17:00') },
    { key: 'evening', label: t('time.evening'), items: slots.filter((s) => s.time >= '17:00') },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <fieldset key={group.key}>
          <legend className="mb-2 text-sm font-semibold text-ink-600">{group.label}</legend>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2">
            {group.items.map((slot) => {
              const isSelected = slot.start === selected;
              return (
                <button
                  key={slot.start}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(slot)}
                  className={cx(
                    'press tabular h-11 rounded-pill text-[0.9375rem] font-semibold transition-colors duration-150',
                    isSelected ? 'bg-ink-900 text-white' : 'bg-white text-ink-900 ring-1 ring-inset ring-ink-200 hover:ring-ink-400',
                  )}
                >
                  {slot.time}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
