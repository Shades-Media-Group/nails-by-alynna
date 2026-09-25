import { useTranslation } from 'react-i18next';
import { CalendarIcon, HomeIcon, PersonIcon, SpaIcon, type IconComponent } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';

export interface NavItem {
  to: string;
  label: string;
  icon: IconComponent;
}

export function useClientNav(): NavItem[] {
  const { t } = useTranslation('common');
  const { lp } = useLocale();
  return [
    { to: lp('/home'), label: t('nav.home'), icon: HomeIcon },
    { to: lp('/services'), label: t('nav.services'), icon: SpaIcon },
    { to: lp('/bookings'), label: t('nav.bookings'), icon: CalendarIcon },
    { to: lp('/profile'), label: t('nav.profile'), icon: PersonIcon },
  ];
}
