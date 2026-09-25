import type { Locale } from './validation';
import type { MailMessage } from './mailer';

const COPY: Record<
  Locale,
  { subject: string; greeting: (name: string) => string; body: string; cta: string; ignore: string }
> = {
  ro: {
    subject: 'Resetează parola pentru Nails by Alynna',
    greeting: (name) => `Bună, ${name}!`,
    body: 'Am primit o cerere de resetare a parolei. Linkul este valabil 30 de minute.',
    cta: 'Setează o parolă nouă',
    ignore: 'Dacă nu ai cerut tu resetarea, ignoră acest mesaj. Parola rămâne neschimbată.',
  },
  ru: {
    subject: 'Сброс пароля в Nails by Alynna',
    greeting: (name) => `Привет, ${name}!`,
    body: 'Мы получили запрос на сброс пароля. Ссылка действует 30 минут.',
    cta: 'Задать новый пароль',
    ignore: 'Если вы не запрашивали сброс, просто проигнорируйте это письмо. Пароль не изменится.',
  },
  en: {
    subject: 'Reset your password for Nails by Alynna',
    greeting: (name) => `Hi ${name},`,
    body: 'We received a request to reset your password. The link is valid for 30 minutes.',
    cta: 'Set a new password',
    ignore: "If you didn't ask for this, ignore this email. Your password stays the same.",
  },
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function passwordResetEmail(opts: {
  to: string;
  name: string;
  locale: Locale;
  link: string;
}): MailMessage {
  const t = COPY[opts.locale];
  const link = escapeHtml(opts.link);
  const html = `<!doctype html><html lang="${opts.locale}"><body style="margin:0;background:#FDE7FC;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#252726">
<table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px">
<tr><td>
<p style="margin:0 0 24px;font-size:12px;letter-spacing:.24em;text-transform:uppercase;font-weight:700">Nails by Alynna</p>
<p style="margin:0 0 12px;font-size:20px;font-weight:700">${escapeHtml(t.greeting(opts.name))}</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5">${escapeHtml(t.body)}</p>
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#252726;color:#ffffff;text-decoration:none;font-weight:600;padding:14px 24px;border-radius:999px">${escapeHtml(t.cta)}</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#5b5e5c">${escapeHtml(t.ignore)}</p>
</td></tr></table></body></html>`;
  const text = `${t.greeting(opts.name)}\n\n${t.body}\n\n${t.cta}: ${opts.link}\n\n${t.ignore}\n`;
  return { to: opts.to, subject: t.subject, html, text };
}
