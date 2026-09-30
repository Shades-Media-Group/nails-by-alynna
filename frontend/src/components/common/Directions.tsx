import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui';
import {
  ChevronRightIcon,
  DirectionsCarIcon,
  LocalTaxiIcon,
  MapIcon,
  NearMeIcon,
  type IconComponent,
} from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { cx } from '@/lib/cx';
import { directionsApps, directionsUrl, type DirectionsApp } from '@/lib/directions';

const ICONS: Record<DirectionsApp, IconComponent> = {
  apple: NearMeIcon,
  google: MapIcon,
  waze: DirectionsCarIcon,
  yandexGo: LocalTaxiIcon,
};

/** The taxi reads apart from the maps: a ride, not a route. */
const tone = (app: DirectionsApp) => (app === 'yandexGo' ? 'bg-peach-100 text-peach-800' : 'bg-blush-100 text-rose-700');

/** The studio's pin and address, from the public config. */
function useStudioPlace() {
  const { data: config } = useStudio();
  const studio = config?.studio;
  const address = [studio?.address.trim(), studio?.city].filter(Boolean).join(', ');
  return { point: studio?.location ?? null, address };
}

/** "Directions" on a visit or the studio page: `children` draws the button; it opens the choice of apps. */
export function GetDirections({ children }: { children: (open: () => void) => ReactNode }) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const { point, address } = useStudioPlace();
  if (!point) return null;
  return (
    <>
      {children(() => setOpen(true))}
      <Sheet open={open} onClose={() => setOpen(false)} title={t('directions.title')} description={address || undefined}>
        <ul className="flex flex-col gap-2 py-2">
          {directionsApps().map((app) => {
            const Icon = ICONS[app];
            return (
              <li key={app}>
                <a
                  href={directionsUrl(app, point)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="press flex w-full items-center gap-3 rounded-2xl bg-ink-50 px-4 py-3.5 text-left hover:bg-ink-100"
                >
                  <span className={cx('inline-flex size-9 shrink-0 items-center justify-center rounded-pill text-xl', tone(app))}>
                    <Icon fontSize="inherit" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{t(`directions.apps.${app}`)}</span>
                    <span className="block text-sm text-ink-600">{t(`directions.hints.${app === 'yandexGo' ? 'taxi' : 'route'}`)}</span>
                  </span>
                  <ChevronRightIcon fontSize="inherit" className="shrink-0 text-xl text-ink-400" />
                </a>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}
