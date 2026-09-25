import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Logo } from '@/components/brand/Logo';
import { NailArt } from '@/components/brand/NailArt';
import { ContactSheet } from '@/components/common/ContactSheet';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { IconButton } from '@/components/ui';
import { ArrowBackIcon, SupportAgentIcon } from '@/components/ui/icons';

interface AuthLayoutProps {
  children: ReactNode;
  /** Blush band pinned to the bottom (Figma: "Don't have an account? Sign Up"): all of it is the link. */
  footer?: { text: string; action: string; to: string };
  back?: string | boolean;
}

/**
 * Sign-in screens. Phones follow the Figma prototype (white field, logo, blush footer band);
 * desktops add a blush brand panel on the left.
 */
export function AuthLayout({ children, footer, back }: AuthLayoutProps) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-white lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-blush-100 lg:flex lg:flex-col lg:items-center lg:justify-center lg:px-12">
        {/* The logo alone: the tagline already leads the form column. */}
        <Logo className="w-[min(22rem,70%)]" />
        <NailArt art="gel" color="blush" className="pointer-events-none absolute -bottom-6 -left-10 w-72 opacity-90" />
        <NailArt art="french" color="lilac" className="pointer-events-none absolute -right-8 top-10 w-56 rotate-12 opacity-80" />
      </aside>

      <div className="flex min-h-dvh flex-col">
        <div className="gutter-x flex items-center justify-between gap-3 pt-[calc(var(--safe-top)+0.75rem)] md:px-8 md:pt-6 lg:px-10 lg:pt-8">
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

        {/* Vertically centred on every size; long forms simply scroll from the top. */}
        <main id="main" className="gutter-x mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8 md:max-w-[28rem] md:px-0">
          {children}
        </main>

        {footer ? (
          <footer className="rounded-t-2xl bg-blush-100 text-center text-sm text-ink-700 md:mx-auto md:mb-8 md:w-full md:max-w-[28rem] md:rounded-2xl">
            <Link
              to={footer.to}
              className="group block rounded-[inherit] px-6 pb-[calc(var(--safe-bottom)+1.25rem)] pt-5 transition-colors hover:bg-blush-200/50 active:bg-blush-200/70 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-rose-700 md:pb-5"
            >
              {footer.text} <span className="font-bold text-rose-700 underline-offset-4 group-hover:underline">{footer.action}</span>
            </Link>
          </footer>
        ) : null}
      </div>
      <ContactSheet open={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  );
}
