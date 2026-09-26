import type { MailMessage } from './mailer';
import { addDays, toZonedParts } from './time';
import type { Locale } from './validation';

/**
 * Branded transactional emails (ro / ru / en), each with a plain-text alternative.
 *
 * Layout rules for email clients: tables and inline CSS only, one 480 px white card on the
 * blush field, ink pill buttons, the wordmark as live hot-pink text (no images to block).
 * Dark mode: Apple Mail and iOS Mail use the `prefers-color-scheme` block below; Gmail and
 * Outlook invert colours themselves, which this palette survives (no text baked into images,
 * no transparent logos). Every interpolated value is escaped; links must be http(s).
 */

const BRAND = 'Nails by Alynna';
const INK = '#252726';
const MUTED = '#5C605E';
const BLUSH = '#FDE7FC';
const HOT_PINK = '#FD2578';
const LINE = '#EFE6EC';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

const LOCALE_TAGS: Record<Locale, string> = { ro: 'ro-MD', ru: 'ru-MD', en: 'en-GB' };

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only absolute http(s) links make it into an email. */
function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

// ── Building blocks ────────────────────────────────────────────────────────────

interface Block {
  html: string;
  text: string;
}

const para = (value: string, style = `font-size:16px;line-height:1.55;color:${INK}`, cls = 'nba-text'): Block => ({
  html: `<p class="${cls}" style="margin:0 0 20px;${style}">${escapeHtml(value)}</p>`,
  text: value,
});

const small = (value: string): Block => para(value, `font-size:13px;line-height:1.5;color:${MUTED}`, 'nba-muted');

function codeBlock(code: string): Block {
  return {
    html:
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px"><tr>` +
      `<td class="nba-code" style="background:${BLUSH};border-radius:16px;padding:16px 22px;font-family:${MONO};font-size:34px;line-height:1;font-weight:800;letter-spacing:10px;color:${INK}">${escapeHtml(code)}</td>` +
      `</tr></table>`,
    text: `    ${code}`,
  };
}

function buttons(items: Array<{ label: string; url: string | null; primary?: boolean }>): Block {
  const valid = items.flatMap((item) => {
    const url = safeUrl(item.url);
    return url ? [{ ...item, url }] : [];
  });
  if (valid.length === 0) return { html: '', text: '' };
  const cells = valid
    .map((item) => {
      const style = item.primary
        ? `display:inline-block;background:${INK};color:#ffffff;border:1px solid ${INK}`
        : `display:inline-block;background:#ffffff;color:${INK};border:1px solid #D9D2D6`;
      return (
        `<td style="padding:0 8px 8px 0"><a class="${item.primary ? 'nba-btn' : 'nba-btn-alt'}" href="${escapeHtml(item.url)}" ` +
        `style="${style};text-decoration:none;font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;padding:13px 22px;border-radius:999px;white-space:nowrap">` +
        `${escapeHtml(item.label)}</a></td>`
      );
    })
    .join('');
  return {
    html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px"><tr>${cells}</tr></table>`,
    text: valid.map((item) => `${item.label}: ${item.url}`).join('\n'),
  };
}

function details(rows: Array<[label: string, value: string | null | undefined]>): Block {
  const present = rows.filter((row): row is [string, string] => Boolean(row[1]));
  const html = present
    .map(
      ([label, value], index) =>
        `<tr><td class="nba-muted nba-rule" style="padding:10px 12px 10px 0;vertical-align:top;font-size:13px;line-height:1.4;color:${MUTED};white-space:nowrap;${index > 0 ? `border-top:1px solid ${LINE};` : ''}">${escapeHtml(label)}</td>` +
        `<td class="nba-text nba-rule" style="padding:10px 0;vertical-align:top;font-size:15px;line-height:1.45;font-weight:600;color:${INK};${index > 0 ? `border-top:1px solid ${LINE};` : ''}">${escapeHtml(value).replace(/\n/g, '<br>')}</td></tr>`,
    )
    .join('');
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">${html}</table>`,
    text: present.map(([label, value]) => `${label}: ${value.replace(/\n/g, ', ')}`).join('\n'),
  };
}

function render(opts: {
  locale: Locale;
  to: string;
  toName?: string;
  subject: string;
  preheader: string;
  heading: string;
  blocks: Block[];
  footer: Block[];
  replyTo?: string;
}): MailMessage {
  const body = opts.blocks.filter((b) => b.html).map((b) => b.html).join('\n');
  const footer = opts.footer
    .map((b) => b.html.replace('margin:0 0 20px', 'margin:0 0 8px'))
    .join('\n');
  const html = `<!doctype html>
<html lang="${opts.locale}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(opts.subject)}</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
a{color:${INK}}
@media (prefers-color-scheme:dark){
.nba-bg{background:#1C1B1C !important}
.nba-card{background:#2A2C2B !important}
.nba-text{color:#F5F1F4 !important}
.nba-muted{color:#C8C1C6 !important}
.nba-rule{border-color:#3C3E3D !important}
.nba-code{background:#1C1B1C !important;color:#FFFFFF !important}
.nba-btn{background:#FFFFFF !important;color:${INK} !important;border-color:#FFFFFF !important}
.nba-btn-alt{background:transparent !important;color:#F5F1F4 !important;border-color:#6B6F6D !important}
.nba-brand{color:#FF5C9A !important}
}
[data-ogsc] .nba-text{color:#F5F1F4 !important}
[data-ogsc] .nba-muted{color:#C8C1C6 !important}
[data-ogsc] .nba-brand{color:#FF5C9A !important}
</style>
</head>
<body class="nba-bg" style="margin:0;padding:0;background:${BLUSH};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(opts.preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="nba-bg" style="background:${BLUSH}">
<tr><td align="center" style="padding:32px 16px">
<!--[if mso]><table role="presentation" width="480" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="nba-card" style="max-width:480px;background:#FFFFFF;border-radius:24px">
<tr><td style="padding:32px 28px 12px;font-family:${FONT};color:${INK}">
<p class="nba-brand" style="margin:0 0 24px;font-size:14px;letter-spacing:.22em;text-transform:uppercase;font-weight:800;color:${HOT_PINK}">${BRAND}</p>
<h1 class="nba-text" style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:800;color:${INK}">${escapeHtml(opts.heading)}</h1>
${body}
</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">
<tr><td style="padding:20px 28px 0;font-family:${FONT}">
${footer}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
  const text = [
    BRAND.toUpperCase(),
    '',
    opts.heading,
    '',
    ...opts.blocks.filter((b) => b.text).flatMap((b) => [b.text, '']),
    '--',
    ...opts.footer.map((b) => b.text),
    '',
  ].join('\n');
  return { to: opts.to, toName: opts.toName, subject: opts.subject, html, text, replyTo: opts.replyTo };
}

// ── Shared copy ──────────────────────────────────────────────────────────────────

const COMMON: Record<
  Locale,
  { greeting: (name: string) => string; signature: string; neverShare: string }
> = {
  ro: {
    greeting: (name) => (name ? `Bună, ${name}!` : 'Bună!'),
    signature: `${BRAND} · Chișinău`,
    neverShare: 'Nu da nimănui acest cod. Salonul nu ți-l va cere niciodată.',
  },
  ru: {
    greeting: (name) => (name ? `Здравствуйте, ${name}!` : 'Здравствуйте!'),
    signature: `${BRAND} · Кишинёв`,
    neverShare: 'Никому не сообщайте этот код. Салон никогда его не спросит.',
  },
  en: {
    greeting: (name) => (name ? `Hi ${name},` : 'Hi,'),
    signature: `${BRAND} · Chișinău`,
    neverShare: 'Never share this code. The studio will never ask you for it.',
  },
};

// ── Codes: email confirmation, new email, password reset ─────────────────────────

export type CodeEmailPurpose = 'verify_email' | 'change_email';

const CODE_COPY: Record<
  CodeEmailPurpose,
  Record<Locale, { subject: (code: string) => string; heading: string; body: (email: string) => string; ignore: string }>
> = {
  verify_email: {
    ro: {
      subject: (code) => `Confirmă emailul: codul ${code}`,
      heading: 'Confirmă adresa de email',
      body: (email) => `Introdu acest cod în aplicație ca să confirmi adresa ${email}. Codul este valabil 10 minute.`,
      ignore: 'Nu ți-ai creat cont la noi? Ignoră acest mesaj: fără cod nu se schimbă nimic.',
    },
    ru: {
      subject: (code) => `Подтверждение email: код ${code}`,
      heading: 'Подтвердите email',
      body: (email) => `Введите этот код в приложении, чтобы подтвердить адрес ${email}. Код действует 10 минут.`,
      ignore: 'Не создавали аккаунт? Просто проигнорируйте письмо: без кода ничего не изменится.',
    },
    en: {
      subject: (code) => `Confirm your email: code ${code}`,
      heading: 'Confirm your email',
      body: (email) => `Enter this code in the app to confirm ${email}. It's valid for 10 minutes.`,
      ignore: "Didn't create an account? Ignore this email: nothing changes without the code.",
    },
  },
  change_email: {
    ro: {
      subject: (code) => `Confirmă noul email: codul ${code}`,
      heading: 'Confirmă noul email',
      body: (email) => `Introdu acest cod în aplicație ca să folosești ${email} pentru contul ${BRAND}. Codul este valabil 10 minute.`,
      ignore: 'Nu ai cerut această schimbare? Ignoră mesajul: contul rămâne neschimbat.',
    },
    ru: {
      subject: (code) => `Подтверждение нового email: код ${code}`,
      heading: 'Подтвердите новый email',
      body: (email) => `Введите этот код в приложении, чтобы использовать ${email} для аккаунта ${BRAND}. Код действует 10 минут.`,
      ignore: 'Не запрашивали изменение? Проигнорируйте письмо: аккаунт останется прежним.',
    },
    en: {
      subject: (code) => `Confirm your new email: code ${code}`,
      heading: 'Confirm your new email',
      body: (email) => `Enter this code in the app to use ${email} for your ${BRAND} account. It's valid for 10 minutes.`,
      ignore: "Didn't ask for this? Ignore this email: your account stays as it is.",
    },
  },
};

/** 6-digit code that confirms an email address (sign-up, login) or a new address (Profile). */
export function verificationCodeEmail(opts: {
  to: string;
  name: string;
  locale: Locale;
  code: string;
  purpose: CodeEmailPurpose;
  replyTo?: string;
}): MailMessage {
  const t = CODE_COPY[opts.purpose][opts.locale];
  const c = COMMON[opts.locale];
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    subject: t.subject(opts.code),
    preheader: t.body(opts.to),
    heading: t.heading,
    blocks: [para(c.greeting(opts.name)), para(t.body(opts.to)), codeBlock(opts.code), small(c.neverShare), small(t.ignore)],
    footer: [small(c.signature)],
    replyTo: opts.replyTo,
  });
}

const RESET_COPY: Record<
  Locale,
  { subject: (code: string) => string; heading: string; body: string; orLink: string; cta: string; ignore: string }
> = {
  ro: {
    subject: (code) => `Resetarea parolei: codul ${code}`,
    heading: 'Resetează parola',
    body: 'Am primit o cerere de resetare a parolei. Introdu acest cod în aplicație ca să setezi o parolă nouă. Codul este valabil 10 minute.',
    orLink: 'Sau folosește butonul de mai jos (linkul este valabil 30 de minute).',
    cta: 'Setează o parolă nouă',
    ignore: 'Dacă nu ai cerut tu resetarea, ignoră acest mesaj. Parola rămâne neschimbată.',
  },
  ru: {
    subject: (code) => `Сброс пароля: код ${code}`,
    heading: 'Сброс пароля',
    body: 'Мы получили запрос на сброс пароля. Введите этот код в приложении, чтобы задать новый пароль. Код действует 10 минут.',
    orLink: 'Или нажмите кнопку ниже (ссылка действует 30 минут).',
    cta: 'Задать новый пароль',
    ignore: 'Если вы не запрашивали сброс, просто проигнорируйте это письмо. Пароль не изменится.',
  },
  en: {
    subject: (code) => `Reset your password: code ${code}`,
    heading: 'Reset your password',
    body: 'We received a request to reset your password. Enter this code in the app to set a new one. It is valid for 10 minutes.',
    orLink: 'Or use the button below (the link is valid for 30 minutes).',
    cta: 'Set a new password',
    ignore: "If you didn't ask for this, ignore this email. Your password stays the same.",
  },
};

/** Password reset: a 6-digit code for the app, plus the one-tap link for the browser. */
export function passwordResetEmail(opts: {
  to: string;
  name: string;
  locale: Locale;
  link: string;
  code: string;
  replyTo?: string;
}): MailMessage {
  const t = RESET_COPY[opts.locale];
  const c = COMMON[opts.locale];
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    subject: t.subject(opts.code),
    preheader: t.body,
    heading: t.heading,
    blocks: [
      para(c.greeting(opts.name)),
      para(t.body),
      codeBlock(opts.code),
      para(t.orLink, `font-size:15px;line-height:1.5;color:${MUTED}`, 'nba-muted'),
      buttons([{ label: t.cta, url: opts.link, primary: true }]),
      small(c.neverShare),
      small(t.ignore),
    ],
    footer: [small(c.signature)],
    replyTo: opts.replyTo,
  });
}

const EMAIL_CHANGED_COPY: Record<Locale, { subject: string; heading: string; body: (email: string) => string; notYou: string }> = {
  ro: {
    subject: `Emailul contului ${BRAND} a fost schimbat`,
    heading: 'Emailul contului a fost schimbat',
    body: (email) => `De acum, contul tău folosește adresa ${email}. Mesajele despre vizite ajung acolo.`,
    notYou: 'Dacă nu ai făcut tu această schimbare, contactează imediat salonul.',
  },
  ru: {
    subject: `Email аккаунта ${BRAND} изменён`,
    heading: 'Email аккаунта изменён',
    body: (email) => `Теперь ваш аккаунт использует адрес ${email}. Письма о визитах будут приходить туда.`,
    notYou: 'Если это были не вы, срочно свяжитесь с салоном.',
  },
  en: {
    subject: `Your ${BRAND} email was changed`,
    heading: 'Your email was changed',
    body: (email) => `Your account now uses ${email}. Messages about your visits go there from now on.`,
    notYou: "If you didn't make this change, contact the studio right away.",
  },
};

/** Security notice to the previous address after an email change (the new one is masked). */
export function emailChangedNoticeEmail(opts: {
  to: string;
  name: string;
  locale: Locale;
  newEmail: string;
  replyTo?: string;
}): MailMessage {
  const t = EMAIL_CHANGED_COPY[opts.locale];
  const c = COMMON[opts.locale];
  const masked = maskEmail(opts.newEmail);
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    subject: t.subject,
    preheader: t.body(masked),
    heading: t.heading,
    blocks: [para(c.greeting(opts.name)), para(t.body(masked)), para(t.notYou)],
    footer: [small(c.signature)],
    replyTo: opts.replyTo,
  });
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}•••${local.length > 1 ? local.slice(-1) : ''}@${domain}`;
}

// ── Visits: reminder and changes made by the studio ─────────────────────────────

export interface VisitInfo {
  code: string;
  start: Date;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  /** Service names in the recipient's language. */
  services: string[];
  master: string | null;
  address: string | null;
  /** null when the client has no account yet (a walk-in): the link would lead to a login. */
  bookingUrl: string | null;
  directionsUrl: string | null;
  bookUrl: string;
  settingsUrl: string | null;
  /** Last moment the client may change or cancel online (null = no online changes). */
  changeDeadline: Date | null;
  studioPhone: string | null;
}

export interface VisitTime {
  /** "15:00" */
  time: string;
  /** "vineri, 3 octombrie" / "пятница, 3 октября" / "Friday 3 October" */
  date: string;
  relative: 'today' | 'tomorrow' | null;
}

/** When a visit happens, in the studio's zone and the reader's language. */
export function visitTime(start: Date, locale: Locale, timeZone: string, now: Date): VisitTime {
  const tag = LOCALE_TAGS[locale];
  const time = new Intl.DateTimeFormat(tag, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(start);
  const date = new Intl.DateTimeFormat(tag, { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(start);
  const day = toZonedParts(start, timeZone).date;
  const today = toZonedParts(now, timeZone).date;
  const relative = day === today ? 'today' : day === addDays(today, 1) ? 'tomorrow' : null;
  return { time, date, relative };
}

/** "3 octombrie la 03:00" / "3 октября в 03:00" / "3 October at 03:00" (no weekday: Russian would need its genitive). */
function formatDeadline(deadline: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    timeZone,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(deadline);
}

const VISIT_COPY: Record<
  Locale,
  {
    when: (v: VisitTime) => string;
    labels: { when: string; services: string; master: string; where: string; code: string };
    view: string;
    directions: string;
    bookAgain: string;
    pending: string;
    canChange: (deadline: string) => string;
    tooLate: (phone: string | null) => string;
    reminder: { subject: (v: VisitTime) => string; heading: string; lead: (name: string) => string; why: string };
    /** The client's own request, waiting for the master (studios that confirm bookings). */
    requested: { subject: (v: VisitTime) => string; heading: string; lead: (master: string | null) => string };
    /** The client booked (or the studio booked them) and the visit is already confirmed. */
    booked: { subject: (v: VisitTime) => string; heading: string; lead: string };
    confirmed: { subject: (v: VisitTime) => string; heading: string; lead: string };
    rescheduled: { subject: (v: VisitTime) => string; heading: string; lead: string };
    cancelled: { subject: (v: VisitTime) => string; heading: string; lead: string; next: string };
    updatesWhy: string;
    /** For clients without an account (booked at the desk): no settings to point to. */
    guestWhy: string;
    settings: string;
  }
> = {
  ro: {
    when: (v) => (v.relative === 'today' ? `Azi, ${v.time}` : v.relative === 'tomorrow' ? `Mâine, ${v.time}` : `${capitalize(v.date)}, ${v.time}`),
    labels: { when: 'Când', services: 'Servicii', master: 'Maestru', where: 'Unde', code: 'Codul programării' },
    view: 'Vezi programarea',
    directions: 'Cum ajungi',
    bookAgain: 'Alege altă oră',
    pending: 'Salonul nu a confirmat încă această programare. Îți scriem imediat ce o confirmă.',
    canChange: (deadline) => `Vrei să schimbi ceva? Poți reprograma sau anula în aplicație până pe ${deadline}.`,
    tooLate: (phone) =>
      phone
        ? `Acum modificările se fac doar prin salon. Dacă ți s-au schimbat planurile, sună la ${phone}.`
        : 'Acum modificările se fac doar prin salon. Dacă ți s-au schimbat planurile, contactează salonul.',
    reminder: {
      subject: (v) =>
        v.relative === 'today'
          ? `Memento: vizita ta de azi, la ${v.time}`
          : v.relative === 'tomorrow'
            ? `Memento: vizita ta de mâine, la ${v.time}`
            : `Memento: vizita ta din ${v.date}, la ${v.time}`,
      heading: 'Ne vedem curând',
      lead: (name) => (name ? `Bună, ${name}! Îți amintim de vizita ta la ${BRAND}.` : `Bună! Îți amintim de vizita ta la ${BRAND}.`),
      why: 'Primești mementouri pentru că sunt pornite în Profil → Notificări.',
    },
    requested: {
      subject: (v) => `Cerere trimisă: ${v.relative === 'today' ? 'azi' : v.relative === 'tomorrow' ? 'mâine' : v.date}, la ${v.time}`,
      heading: 'Cererea ta a ajuns la salon',
      lead: (master) =>
        master
          ? `${master} confirmă programarea în scurt timp. Îți scriem imediat ce e confirmată.`
          : 'Salonul confirmă programarea în scurt timp. Îți scriem imediat ce e confirmată.',
    },
    booked: {
      subject: (v) => `Te-ai programat: ${v.relative === 'today' ? 'azi' : v.relative === 'tomorrow' ? 'mâine' : v.date}, la ${v.time}`,
      heading: 'Te-ai programat',
      lead: 'Vizita ta este în calendarul salonului. Te așteptăm!',
    },
    confirmed: {
      subject: (v) => `Programarea ta este confirmată: ${v.relative === 'today' ? 'azi' : v.relative === 'tomorrow' ? 'mâine' : v.date}, la ${v.time}`,
      heading: 'Programare confirmată',
      lead: 'Salonul ți-a confirmat vizita. Te așteptăm!',
    },
    rescheduled: {
      subject: (v) => `Vizita ta a fost mutată: ${v.relative === 'today' ? 'azi' : v.relative === 'tomorrow' ? 'mâine' : v.date}, la ${v.time}`,
      heading: 'Vizita ta are o oră nouă',
      lead: 'Salonul a mutat vizita ta. Iată noile detalii.',
    },
    cancelled: {
      subject: (v) =>
        v.relative === 'today'
          ? 'Vizita ta de azi a fost anulată'
          : v.relative === 'tomorrow'
            ? 'Vizita ta de mâine a fost anulată'
            : `Vizita ta din ${v.date} a fost anulată`,
      heading: 'Vizită anulată',
      lead: 'Salonul a anulat vizita de mai jos. Ne pare rău pentru schimbare.',
      next: 'Poți alege oricând o altă oră în aplicație.',
    },
    updatesWhy: 'Primești aceste mesaje pentru că actualizările programărilor sunt pornite în Profil → Notificări.',
    guestWhy: `Primești acest mesaj pentru că ai o programare la ${BRAND}. Dacă nu vrei să mai primești mesaje, răspunde la acest email.`,
    settings: 'Setări notificări',
  },
  ru: {
    when: (v) => (v.relative === 'today' ? `Сегодня, ${v.time}` : v.relative === 'tomorrow' ? `Завтра, ${v.time}` : `${capitalize(v.date)}, ${v.time}`),
    labels: { when: 'Когда', services: 'Услуги', master: 'Мастер', where: 'Где', code: 'Код записи' },
    view: 'Открыть запись',
    directions: 'Как добраться',
    bookAgain: 'Выбрать другое время',
    pending: 'Салон ещё не подтвердил эту запись. Мы напишем, как только это произойдёт.',
    canChange: (deadline) => `Планы изменились? Перенести или отменить запись в приложении можно до ${deadline}.`,
    tooLate: (phone) =>
      phone
        ? `Изменить запись онлайн уже нельзя. Если планы поменялись, позвоните в салон: ${phone}.`
        : 'Изменить запись онлайн уже нельзя. Если планы поменялись, свяжитесь с салоном.',
    reminder: {
      subject: (v) =>
        v.relative === 'today'
          ? `Напоминание: ваш визит сегодня в ${v.time}`
          : v.relative === 'tomorrow'
            ? `Напоминание: ваш визит завтра в ${v.time}`
            : `Напоминание о визите: ${v.date}, ${v.time}`,
      heading: 'Скоро увидимся',
      lead: (name) => (name ? `Здравствуйте, ${name}! Напоминаем о вашем визите в ${BRAND}.` : `Здравствуйте! Напоминаем о вашем визите в ${BRAND}.`),
      why: 'Вы получаете напоминания, потому что они включены в разделе Профиль → Уведомления.',
    },
    requested: {
      subject: (v) => `Заявка отправлена: ${v.relative === 'today' ? 'сегодня' : v.relative === 'tomorrow' ? 'завтра' : v.date}, ${v.time}`,
      heading: 'Заявка уже в салоне',
      lead: (master) =>
        master
          ? `Мастер ${master} скоро подтвердит запись. Мы напишем, как только это произойдёт.`
          : 'Салон скоро подтвердит запись. Мы напишем, как только это произойдёт.',
    },
    booked: {
      subject: (v) => `Вы записаны: ${v.relative === 'today' ? 'сегодня' : v.relative === 'tomorrow' ? 'завтра' : v.date}, ${v.time}`,
      heading: 'Вы записаны',
      lead: 'Визит уже в календаре салона. Ждём вас!',
    },
    confirmed: {
      subject: (v) => `Запись подтверждена: ${v.relative === 'today' ? 'сегодня' : v.relative === 'tomorrow' ? 'завтра' : v.date}, ${v.time}`,
      heading: 'Запись подтверждена',
      lead: 'Салон подтвердил ваш визит. Ждём вас!',
    },
    rescheduled: {
      subject: (v) => `Визит перенесён: ${v.relative === 'today' ? 'сегодня' : v.relative === 'tomorrow' ? 'завтра' : v.date}, ${v.time}`,
      heading: 'Новое время визита',
      lead: 'Салон перенёс ваш визит. Новые детали ниже.',
    },
    cancelled: {
      subject: (v) => `Визит отменён: ${v.relative === 'today' ? 'сегодня' : v.relative === 'tomorrow' ? 'завтра' : v.date}, ${v.time}`,
      heading: 'Визит отменён',
      lead: 'Салон отменил визит ниже. Приносим извинения за изменения.',
      next: 'Выбрать другое время можно в приложении в любой момент.',
    },
    updatesWhy: 'Вы получаете эти письма, потому что изменения записей включены в разделе Профиль → Уведомления.',
    guestWhy: `Вы получили это письмо, потому что записаны в ${BRAND}. Чтобы больше не получать писем, ответьте на это сообщение.`,
    settings: 'Настройки уведомлений',
  },
  en: {
    when: (v) => (v.relative === 'today' ? `Today, ${v.time}` : v.relative === 'tomorrow' ? `Tomorrow, ${v.time}` : `${v.date}, ${v.time}`),
    labels: { when: 'When', services: 'Services', master: 'Master', where: 'Where', code: 'Booking code' },
    view: 'View booking',
    directions: 'Directions',
    bookAgain: 'Book another time',
    pending: "The studio hasn't confirmed this booking yet. We'll let you know as soon as it does.",
    canChange: (deadline) => `Plans changed? You can reschedule or cancel in the app until ${deadline}.`,
    tooLate: (phone) =>
      phone
        ? `It's too late to change it online. If your plans changed, call the studio at ${phone}.`
        : "It's too late to change it online. If your plans changed, contact the studio.",
    reminder: {
      subject: (v) =>
        v.relative === 'today'
          ? `Reminder: your visit today at ${v.time}`
          : v.relative === 'tomorrow'
            ? `Reminder: your visit tomorrow at ${v.time}`
            : `Reminder: your visit on ${v.date} at ${v.time}`,
      heading: 'See you soon',
      lead: (name) => (name ? `Hi ${name}, this is a reminder of your visit to ${BRAND}.` : `Hi, this is a reminder of your visit to ${BRAND}.`),
      why: 'You get reminders because they are on in Profile → Notifications.',
    },
    requested: {
      subject: (v) => `Request sent: ${v.relative === 'today' ? 'today' : v.relative === 'tomorrow' ? 'tomorrow' : v.date} at ${v.time}`,
      heading: 'Your request is with the studio',
      lead: (master) =>
        master
          ? `${master} will confirm your booking shortly. We'll write as soon as it's confirmed.`
          : "The studio will confirm your booking shortly. We'll write as soon as it's confirmed.",
    },
    booked: {
      subject: (v) => `You're booked: ${v.relative === 'today' ? 'today' : v.relative === 'tomorrow' ? 'tomorrow' : v.date} at ${v.time}`,
      heading: "You're booked",
      lead: 'Your visit is in the studio calendar. See you there!',
    },
    confirmed: {
      subject: (v) => `Booking confirmed: ${v.relative === 'today' ? 'today' : v.relative === 'tomorrow' ? 'tomorrow' : v.date} at ${v.time}`,
      heading: 'Booking confirmed',
      lead: 'The studio confirmed your visit. See you there!',
    },
    rescheduled: {
      subject: (v) => `Your visit was moved to ${v.relative === 'today' ? 'today' : v.relative === 'tomorrow' ? 'tomorrow' : v.date} at ${v.time}`,
      heading: 'New time for your visit',
      lead: 'The studio moved your visit. Here are the new details.',
    },
    cancelled: {
      subject: (v) => `Your visit ${v.relative === 'today' ? 'today' : v.relative === 'tomorrow' ? 'tomorrow' : `on ${v.date}`} was cancelled`,
      heading: 'Visit cancelled',
      lead: 'The studio cancelled the visit below. We are sorry for the change.',
      next: 'You can pick another time in the app whenever you like.',
    },
    updatesWhy: 'You get these emails because booking updates are on in Profile → Notifications.',
    guestWhy: `You get this email because you have a booking at ${BRAND}. To stop these emails, reply to this message.`,
    settings: 'Notification settings',
  },
};

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

/** "Today, 15:00" / "Mâine, 15:00" / "Пятница, 3 октября, 15:00" (push texts use it too). */
export function describeVisitTime(when: VisitTime, locale: Locale): string {
  return VISIT_COPY[locale].when(when);
}

function visitDetails(t: (typeof VISIT_COPY)[Locale], visit: VisitInfo, when: VisitTime): Block {
  return details([
    [t.labels.when, t.when(when)],
    [t.labels.services, visit.services.join('\n')],
    [t.labels.master, visit.master],
    [t.labels.where, visit.address],
    [t.labels.code, visit.code],
  ]);
}

function changeNote(t: (typeof VISIT_COPY)[Locale], visit: VisitInfo, locale: Locale, timeZone: string, now: Date): Block {
  if (visit.changeDeadline && visit.changeDeadline.getTime() > now.getTime()) {
    return small(t.canChange(formatDeadline(visit.changeDeadline, locale, timeZone)));
  }
  return small(t.tooLate(visit.studioPhone));
}

/** "Your visit is soon": when, what, with whom, where, and how to change it. */
export function appointmentReminderEmail(opts: {
  to: string;
  name: string;
  locale: Locale;
  timeZone: string;
  now: Date;
  visit: VisitInfo;
  replyTo?: string;
}): MailMessage {
  const t = VISIT_COPY[opts.locale];
  const when = visitTime(opts.visit.start, opts.locale, opts.timeZone, opts.now);
  const c = COMMON[opts.locale];
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    subject: t.reminder.subject(when),
    preheader: `${t.when(when)} · ${opts.visit.services.join(', ')}`,
    heading: t.reminder.heading,
    blocks: [
      para(t.reminder.lead(opts.name)),
      visitDetails(t, opts.visit, when),
      opts.visit.status === 'pending' ? para(t.pending, `font-size:15px;line-height:1.5;color:${INK}`) : { html: '', text: '' },
      buttons([
        { label: t.view, url: opts.visit.bookingUrl, primary: true },
        { label: t.directions, url: opts.visit.directionsUrl },
      ]),
      changeNote(t, opts.visit, opts.locale, opts.timeZone, opts.now),
    ],
    footer: opts.visit.settingsUrl
      ? [small(t.reminder.why), linkLine(t.settings, opts.visit.settingsUrl), small(c.signature)]
      : [small(t.guestWhy), small(c.signature)],
    replyTo: opts.replyTo,
  });
}

/** What happened to a visit, told to its client: their own request or booking, or the studio's change. */
export type BookingChange = 'requested' | 'booked' | 'confirmed' | 'rescheduled' | 'cancelled';

/** The studio confirmed, moved or cancelled a visit. */
export function bookingUpdateEmail(opts: {
  to: string;
  name: string;
  locale: Locale;
  timeZone: string;
  now: Date;
  kind: BookingChange;
  visit: VisitInfo;
  replyTo?: string;
}): MailMessage {
  const t = VISIT_COPY[opts.locale];
  const copy = t[opts.kind];
  const lead = opts.kind === 'requested' ? t.requested.lead(opts.visit.master) : t[opts.kind].lead;
  const when = visitTime(opts.visit.start, opts.locale, opts.timeZone, opts.now);
  const c = COMMON[opts.locale];
  const cancelled = opts.kind === 'cancelled';
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    subject: copy.subject(when),
    preheader: lead,
    heading: copy.heading,
    blocks: [
      para(c.greeting(opts.name)),
      para(lead),
      cancelled
        ? details([
            [t.labels.when, t.when(when)],
            [t.labels.services, opts.visit.services.join('\n')],
          ])
        : visitDetails(t, opts.visit, when),
      cancelled ? para(t.cancelled.next) : { html: '', text: '' },
      cancelled
        ? buttons([{ label: t.bookAgain, url: opts.visit.bookUrl, primary: true }])
        : buttons([
            { label: t.view, url: opts.visit.bookingUrl, primary: true },
            { label: t.directions, url: opts.visit.directionsUrl },
          ]),
      cancelled ? { html: '', text: '' } : changeNote(t, opts.visit, opts.locale, opts.timeZone, opts.now),
    ],
    footer: opts.visit.settingsUrl
      ? [small(t.updatesWhy), linkLine(t.settings, opts.visit.settingsUrl), small(c.signature)]
      : [small(t.guestWhy), small(c.signature)],
    replyTo: opts.replyTo,
  });
}

// ── Staff: what clients did with their bookings ──────────────────────────────

/** A client's own action on a booking, told to its master and the owner. */
export type StaffBookingEvent = 'requested' | 'booked' | 'cancelled' | 'rescheduled';

const STAFF_COPY: Record<
  Locale,
  {
    subject: Record<StaffBookingEvent, (client: string, when: string) => string>;
    heading: Record<StaffBookingEvent, string>;
    lead: Record<StaffBookingEvent, string>;
    open: Record<StaffBookingEvent, string>;
    labels: { client: string; phone: string };
    why: string;
  }
> = {
  ro: {
    subject: {
      requested: (client, when) => `Cerere nouă: ${client}, ${when}`,
      booked: (client, when) => `Programare nouă: ${client}, ${when}`,
      cancelled: (client, when) => `Anulată de client: ${client}, ${when}`,
      rescheduled: (client, when) => `Mutată de client: ${client}, ${when}`,
    },
    heading: {
      requested: 'Cerere nouă de programare',
      booked: 'Programare nouă',
      cancelled: 'Clientul a anulat vizita',
      rescheduled: 'Clientul a mutat vizita',
    },
    lead: {
      requested: 'Confirm-o în aplicație, iar clientul primește confirmarea pe loc.',
      booked: 'S-a programat online, iar vizita este deja în calendar.',
      cancelled: 'Ora s-a eliberat în calendar.',
      rescheduled: 'Vizita are o oră nouă. Detaliile sunt mai jos.',
    },
    open: { requested: 'Deschide cererea', booked: 'Vezi programarea', cancelled: 'Vezi programarea', rescheduled: 'Vezi programarea' },
    labels: { client: 'Client', phone: 'Telefon' },
    why: 'Primești aceste mesaje pentru că programările clienților sunt pornite în Profil → Notificări.',
  },
  ru: {
    subject: {
      requested: (client, when) => `Новая заявка: ${client}, ${when}`,
      booked: (client, when) => `Новая запись: ${client}, ${when}`,
      cancelled: (client, when) => `Клиент отменил: ${client}, ${when}`,
      rescheduled: (client, when) => `Клиент перенёс: ${client}, ${when}`,
    },
    heading: {
      requested: 'Новая заявка на запись',
      booked: 'Новая запись',
      cancelled: 'Клиент отменил визит',
      rescheduled: 'Клиент перенёс визит',
    },
    lead: {
      requested: 'Подтвердите её в приложении, и клиент сразу получит подтверждение.',
      booked: 'Клиент записался онлайн, визит уже в календаре.',
      cancelled: 'Время в календаре освободилось.',
      rescheduled: 'У визита новое время. Детали ниже.',
    },
    open: { requested: 'Открыть заявку', booked: 'Открыть запись', cancelled: 'Открыть запись', rescheduled: 'Открыть запись' },
    labels: { client: 'Клиент', phone: 'Телефон' },
    why: 'Вы получаете эти письма, потому что записи клиентов включены в разделе Профиль → Уведомления.',
  },
  en: {
    subject: {
      requested: (client, when) => `New request: ${client}, ${when}`,
      booked: (client, when) => `New booking: ${client}, ${when}`,
      cancelled: (client, when) => `Cancelled by the client: ${client}, ${when}`,
      rescheduled: (client, when) => `Moved by the client: ${client}, ${when}`,
    },
    heading: {
      requested: 'New booking request',
      booked: 'New booking',
      cancelled: 'The client cancelled',
      rescheduled: 'The client moved their visit',
    },
    lead: {
      requested: 'Confirm it in the app and the client gets the confirmation straight away.',
      booked: 'They booked online and the visit is already in the calendar.',
      cancelled: 'The time is free again in the calendar.',
      rescheduled: 'The visit has a new time. Details below.',
    },
    open: { requested: 'Open the request', booked: 'Open the booking', cancelled: 'Open the booking', rescheduled: 'Open the booking' },
    labels: { client: 'Client', phone: 'Phone' },
    why: "You get these emails because clients' bookings are on in Profile → Notifications.",
  },
};

/** For the master and the owner: a client asked for, booked, moved or cancelled a visit. */
export function staffBookingEmail(opts: {
  to: string;
  name: string;
  locale: Locale;
  timeZone: string;
  now: Date;
  event: StaffBookingEvent;
  visit: VisitInfo;
  client: { name: string; phone: string | null };
  openUrl: string;
  settingsUrl: string;
}): MailMessage {
  const t = STAFF_COPY[opts.locale];
  const v = VISIT_COPY[opts.locale];
  const when = visitTime(opts.visit.start, opts.locale, opts.timeZone, opts.now);
  const c = COMMON[opts.locale];
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    subject: t.subject[opts.event](opts.client.name, v.when(when)),
    preheader: t.lead[opts.event],
    heading: t.heading[opts.event],
    blocks: [
      para(t.lead[opts.event]),
      details([
        [t.labels.client, opts.client.name],
        [t.labels.phone, opts.client.phone],
        [v.labels.when, v.when(when)],
        [v.labels.services, opts.visit.services.join('\n')],
        [v.labels.master, opts.visit.master],
        [v.labels.code, opts.visit.code],
      ]),
      buttons([{ label: t.open[opts.event], url: opts.openUrl, primary: true }]),
    ],
    footer: [small(t.why), linkLine(v.settings, opts.settingsUrl), small(c.signature)],
  });
}

function linkLine(label: string, url: string | null): Block {
  const safe = safeUrl(url);
  if (!safe) return { html: '', text: '' };
  return {
    html: `<p class="nba-muted" style="margin:0 0 8px;font-size:13px;line-height:1.5;color:${MUTED}"><a class="nba-muted" href="${escapeHtml(safe)}" style="color:${MUTED};text-decoration:underline">${escapeHtml(label)}</a></p>`,
    text: `${label}: ${safe}`,
  };
}

// ── Welcome and loyalty ───────────────────────────────────────────────────────

const WELCOME_COPY: Record<
  Locale,
  {
    subject: string;
    heading: string;
    body: string;
    loyalty: (rewards: string) => string;
    reward: (visit: number, percent: number) => string;
    book: string;
    install: string;
    installNote: string;
  }
> = {
  ro: {
    subject: 'Bun venit la Nails by Alynna',
    heading: 'Contul tău e gata',
    body: 'Te programezi într-un minut: alegi serviciile, maestrul și ora potrivită. Programările, memento-urile și cardul de fidelitate sunt toate în aplicație.',
    loyalty: (rewards) => `Fiecare vizită e o ștampilă pe cardul de fidelitate: ${rewards}.`,
    reward: (visit, percent) => `${visit === 1 ? 'prima' : `a ${visit}-a`} vizită are −${percent}%`,
    book: 'Programează-te',
    install: 'Pune aplicația pe ecran',
    installNote: 'Pe telefon, adaugă aplicația pe ecranul principal: se deschide pe tot ecranul și primești memento-uri.',
  },
  ru: {
    subject: 'Добро пожаловать в Nails by Alynna',
    heading: 'Ваш аккаунт готов',
    body: 'Запись занимает минуту: выберите услуги, мастера и удобное время. Записи, напоминания и карта лояльности — всё в приложении.',
    loyalty: (rewards) => `Каждый визит — отметка на карте лояльности: ${rewards}.`,
    reward: (visit, percent) => `${visit}-й визит −${percent}%`,
    book: 'Записаться',
    install: 'Добавить на экран',
    installNote: 'На телефоне добавьте приложение на экран «Домой»: оно откроется на весь экран, и вы будете получать напоминания.',
  },
  en: {
    subject: 'Welcome to Nails by Alynna',
    heading: 'Your account is ready',
    body: 'Booking takes a minute: pick services, a master and a time that suits you. Your bookings, reminders and loyalty card are all in the app.',
    loyalty: (rewards) => `Every visit is a stamp on your loyalty card: ${rewards}.`,
    reward: (visit, percent) => {
      const suffix = visit % 10 === 1 && visit !== 11 ? 'st' : visit % 10 === 2 && visit !== 12 ? 'nd' : visit % 10 === 3 && visit !== 13 ? 'rd' : 'th';
      return `your ${visit}${suffix} visit is ${percent}% off`;
    },
    book: 'Book a visit',
    install: 'Add the app',
    installNote: 'On your phone, add the app to your Home Screen: it opens full screen and sends you reminders.',
  },
};

const localeSegment = (locale: Locale) => (locale === 'ro' ? '' : `/${locale}`);

/** Sent once, when a new account is ready (email confirmed, or first Google sign-in). */
export function welcomeEmail(opts: {
  to: string;
  name: string;
  locale: Locale;
  appUrl: string;
  rewards: Array<{ visit: number; percent: number }>;
  replyTo?: string;
}): MailMessage {
  const t = WELCOME_COPY[opts.locale];
  const c = COMMON[opts.locale];
  const base = `${opts.appUrl.replace(/\/$/, '')}${localeSegment(opts.locale)}`;
  const rewards = opts.rewards.map((r) => t.reward(r.visit, r.percent)).join(', ');
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    subject: t.subject,
    preheader: t.body,
    heading: t.heading,
    blocks: [
      para(c.greeting(opts.name)),
      para(t.body),
      rewards ? para(t.loyalty(rewards)) : { html: '', text: '' },
      buttons([
        { label: t.book, url: `${base}/book`, primary: true },
        { label: t.install, url: `${base}/app` },
      ]),
      small(t.installNote),
    ],
    footer: [small(c.signature)],
    replyTo: opts.replyTo,
  });
}

const LOYALTY_NEXT_COPY: Record<Locale, { subject: (percent: number) => string; heading: (percent: number) => string; body: string; book: string }> = {
  ro: {
    subject: (percent) => `Următoarea vizită are −${percent}%`,
    heading: (percent) => `Următoarea ta vizită are −${percent}%`,
    body: 'Mulțumim pentru vizită! Cardul de fidelitate a ajuns la reducere: se aplică la salon, la prețul următoarei vizite.',
    book: 'Programează-te',
  },
  ru: {
    subject: (percent) => `Следующий визит со скидкой −${percent}%`,
    heading: (percent) => `Ваш следующий визит −${percent}%`,
    body: 'Спасибо за визит! На карте лояльности набралась скидка: она применяется в салоне к стоимости следующего визита.',
    book: 'Записаться',
  },
  en: {
    subject: (percent) => `Your next visit is ${percent}% off`,
    heading: (percent) => `Your next visit is ${percent}% off`,
    body: 'Thank you for coming in! Your loyalty card has reached a discount: it is applied at the studio, on the price of your next visit.',
    book: 'Book a visit',
  },
};

/** After a visit, when the next one on the card carries a discount. */
export function loyaltyNextEmail(opts: { to: string; name: string; locale: Locale; appUrl: string; percent: number }): MailMessage {
  const t = LOYALTY_NEXT_COPY[opts.locale];
  const c = COMMON[opts.locale];
  const base = `${opts.appUrl.replace(/\/$/, '')}${localeSegment(opts.locale)}`;
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    subject: t.subject(opts.percent),
    preheader: t.body,
    heading: t.heading(opts.percent),
    blocks: [para(c.greeting(opts.name)), para(t.body), buttons([{ label: t.book, url: `${base}/book`, primary: true }])],
    footer: [small(c.signature)],
  });
}
