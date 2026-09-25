import {
  CallIcon,
  DirectionsIcon,
  EmailIcon,
  InstagramIcon,
  TelegramIcon,
  WhatsAppIcon,
  type IconComponent,
} from '@/components/ui/icons';
import type { PublicConfig } from '@/types/api';

export interface ContactLink {
  key: string;
  label: string;
  href: string;
  icon: IconComponent;
  external: boolean;
}

const digits = (value: string) => value.replace(/[^\d+]/g, '');

/** Every way to reach the studio that the administrator has filled in (Settings). */
export function contactLinks(studio: PublicConfig['studio'], t: (key: string) => string): ContactLink[] {
  const links: ContactLink[] = [];
  if (studio.phone) links.push({ key: 'call', label: t('contact.call'), href: `tel:${digits(studio.phone)}`, icon: CallIcon, external: false });
  if (studio.whatsapp)
    links.push({ key: 'whatsapp', label: t('contact.whatsapp'), href: `https://wa.me/${digits(studio.whatsapp).replace('+', '')}`, icon: WhatsAppIcon, external: true });
  if (studio.viber)
    links.push({ key: 'viber', label: t('contact.viber'), href: `viber://chat?number=${encodeURIComponent(digits(studio.viber))}`, icon: CallIcon, external: true });
  if (studio.telegram)
    links.push({ key: 'telegram', label: t('contact.telegram'), href: `https://t.me/${encodeURIComponent(studio.telegram)}`, icon: TelegramIcon, external: true });
  if (studio.instagram)
    // ig.me/m opens a Direct chat with the studio (the Instagram app on phones, the web on computers).
    links.push({ key: 'instagram', label: t('contact.instagram'), href: `https://ig.me/m/${encodeURIComponent(studio.instagram)}`, icon: InstagramIcon, external: true });
  if (studio.email) links.push({ key: 'email', label: t('contact.email'), href: `mailto:${studio.email}`, icon: EmailIcon, external: false });
  if (studio.mapsUrl) links.push({ key: 'directions', label: t('contact.directions'), href: studio.mapsUrl, icon: DirectionsIcon, external: true });
  return links;
}
