import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Logo } from '@/components/brand/Logo';
import { NailArt } from '@/components/brand/NailArt';
import { ContactSheet } from '@/components/common/ContactSheet';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { IconButton } from '@/components/ui';
import { ArrowBackIcon, SupportAgentIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';

interface AuthLayoutProps {
  children: ReactNode;
  /** Blush band pinned to the bottom (Figma: "Don't have an account? Sign Up"). */
  footer?: ReactNode;
  back?: string | boolean;
  /** Centre the content vertically (welcome screen) instead of top-aligning (forms). */
  centered?: boolean;
}

/**
 * Sign-in screens. Phones follow the Figma prototype (white field, logo, blush footer band);
 * desktops add a blush brand panel on the left.
 */
export function AuthLayout({ children, footer, back, centered }: AuthLayoutProps) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-white lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-blush-100 lg:flex lg:flex-col lg:items-center lg:justify-center lg:px-12">
        <Logo className="w-[min(22rem,70%)]" />
        <p className="mt-10 text-center text-h1 font-extrabold uppercase">
          <span className="block text-ink-900">{t('brand.tagline1')}</span>
          <span className="block text-rose-500">{t('brand.tagline2')}</span>
        </p>
        <NailArt art="gel" color="blush" className="pointer-events-none absolute -bottom-6 -left-10 w-72 opacity-90" />
        <NailArt art="french" color="lilac" className="pointer-events-none absolute -right-8 top-10 w-56 rotate-12 opacity-80" />
      </aside>

      <div className="flex min-h-dvh flex-col">
        <div className="gutter-x flex items-center justify-between gap-3 pt-[calc(var(--safe-top)+0.75rem)] lg:px-10 lg:pt-8">
          <div className="flex items-center gap-2">
            {back ? (
              <IconButton
                icon={ArrowBackIcon}
                label={t('actions.back')}
                variant="soft"
                onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
              />
            ) : null}
            <LanguageSwitcher compact />
          </div>
          <IconButton
            icon={SupportAgentIcon}
            label={t('contact.title')}
            variant="outline"
            onClick={() => setContactOpen(true)}
          />
        </div>

        <main
          id="main"
          className={cx(
            'gutter-x mx-auto flex w-full max-w-md flex-1 flex-col pb-8 lg:px-0',
            centered ? 'justify-center' : 'pt-6',
          )}
        >
          {children}
        </main>

        {footer ? (
          <footer className="rounded-t-2xl bg-blush-100 px-6 pb-[calc(var(--safe-bottom)+1.25rem)] pt-5 text-center text-sm text-ink-700 lg:mx-auto lg:mb-8 lg:w-full lg:max-w-md lg:rounded-2xl lg:pb-5">
            {footer}
          </footer>
        ) : null}
      </div>
      <ContactSheet open={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  );
}
