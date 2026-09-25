import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ButtonAnchor, Sheet } from '@/components/ui';
import { contactLinks } from '@/lib/contact';
import { queries } from '@/services/queries';

export function ContactSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('common');
  const config = useQuery({ ...queries.config(), enabled: open });
  const links = config.data ? contactLinks(config.data.studio, t) : [];

  return (
    <Sheet open={open} onClose={onClose} title={t('contact.title')} description={t('contact.subtitle')}>
      {links.length === 0 ? (
        <p className="py-4 text-ink-600">{config.isPending ? t('a11y.loading') : t('contact.none')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 py-2 sm:grid-cols-2">
          {links.map((link) => (
            <ButtonAnchor
              key={link.key}
              href={link.href}
              variant={link.key === 'call' ? 'primary' : 'soft'}
              icon={link.icon}
              fullWidth
              {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {link.label}
            </ButtonAnchor>
          ))}
        </div>
      )}
    </Sheet>
  );
}
