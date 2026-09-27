import type { MailMessage } from './mailer';
import { NBSP, noOrphan } from './text';
import { addDays, toZonedParts } from './time';
import type { Locale } from './validation';

/**
 * Branded transactional emails (ro / ru / en), each with a plain-text alternative.
 *
 * The look is the studio's Wallet-style pass, the same object as the loyalty card in the app:
 * a white page with the logo and one headline, then what the email is about (a visit, a code,
 * the card) on a pass in the colour of its state, with a perforated stub underneath. Blush is
 * booked or confirmed, peach waits for the master, cyan is a new time, stone is cancelled, ink
 * is for codes and for staff.
 *
 * Email-client rules: tables and inline CSS only; Onest from Google Fonts where the client
 * loads web fonts (Apple Mail, iOS Mail), the system sans elsewhere; the logo is a PNG from the
 * app (Gmail shows no SVG) with the name as alt text. Dark mode: Apple Mail uses the
 * `prefers-color-scheme` block below; Gmail and Outlook invert colours themselves, which this
 * palette survives. Every interpolated value is escaped; links must be http(s).
 */

const BRAND = 'Nails by Alynna';
const INK = '#252726';
const MUTED = '#5C605E';
const LINE = '#E9E4E7';
const PAGE = '#FFFFFF';
const FONT = "Onest,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

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

// ── The pass ─────────────────────────────────────────────────────────────────────

/**
 * A pass's field, its accent (the status dot), its deep tone (secondary text on the field, from
 * the same hue, never grey), the perforation colour and the text colour.
 */
type ToneName = 'blush' | 'peach' | 'cyan' | 'stone' | 'ink';
const TONES: Record<ToneName, { field: string; accent: string; deep: string; perf: string; text: string}> = {
  blush: { field: '#FDE7FC', accent: '#FD2578', deep: '#8F1446', perf: '#F2B9E7', text: INK },
  peach: { field: '#FFF3E0', accent: '#FD9B1D', deep: '#7A4400', perf: '#F6D39F', text: INK },
  cyan: { field: '#E6FAFC', accent: '#3DBFCC', deep: '#155C63', perf: '#AEE3E8', text: INK },
  stone: { field: '#F2F0F1', accent: '#8A8E8C', deep: '#4A4D4C', perf: '#D8D3D6', text: INK },
  ink: { field: INK, accent: '#FD2578', deep: '#D9D3D7', perf: '#4B4D4C', text: '#FFFFFF' },
};

interface Block {
  html: string;
  text: string;
}
const NONE: Block = { html: '', text: '' };

const para = (value: string, style = `font-size:16px;line-height:1.55;color:${INK}`, cls = 'nba-text'): Block => ({
  html: `<p class="${cls}" style="margin:0 0 16px;${style}">${escapeHtml(noOrphan(value))}</p>`,
  text: value,
});

const small = (value: string): Block => para(value, `font-size:13px;line-height:1.5;color:${MUTED}`, 'nba-muted');

/** A status on a pass: a dot in the accent colour and a short word. */
/** The ticket cut between the pass and its stub: two notches and a dashed line. */
function perforation(tone: ToneName): string {
  const t = TONES[tone];
  const notch = (side: 'left' | 'right') =>
    `<td width="12" class="nba-page" style="width:12px;height:24px;background:${PAGE};border-radius:${side === 'left' ? '0 12px 12px 0' : '12px 0 0 12px'};font-size:0;line-height:0">&nbsp;</td>`;
  return (
    `<tr><td style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    notch('left') +
    `<td style="vertical-align:middle;padding:0 6px"><div class="nba-perf-${tone}" style="border-top:2px dashed ${t.perf};height:0;font-size:0;line-height:0">&nbsp;</div></td>` +
    notch('right') +
    `</tr></table></td></tr>`
  );
}

/**
 * The pass itself: its main content (the time, the code, the card), the fields under it, and
 * (optionally) the stub under the perforation. Corner radius 16px, colour only (no border, no
 * shadow). What happened is the headline's job; the pass holds the facts.
 */
function pass(opts: { tone: ToneName; main: Block; fields?: Block; stub?: Block }): Block {
  const t = TONES[opts.tone];
  const fields = opts.fields?.html ? `<tr><td style="padding:0 20px 16px">${opts.fields.html}</td></tr>` : '';
  const stub = opts.stub?.html ? perforation(opts.tone) + `<tr><td style="padding:14px 20px 18px">${opts.stub.html}</td></tr>` : '';
  return {
    html:
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="nba-pass-${opts.tone}" style="background:${t.field};border-radius:16px;margin:0 0 20px;border-collapse:separate">` +
      `<tr><td style="padding:20px 20px ${fields || stub ? '16px' : '20px'}">${opts.main.html}</td></tr>` +
      fields +
      stub +
      `</table>`,
    text: [opts.main.text, opts.fields?.text ?? '', opts.stub?.text ?? ''].filter(Boolean).join('\n'),
  };
}

/**
 * Label-over-value fields, two to a row, as on the pass in the app ("Member", "Card code"): a
 * small sentence-case label in the pass's deep tone over a bold value. A value can be a link
 * (Directions, a phone number) or tabular (a code).
 */
interface Field {
  label: string;
  value: string | null | undefined;
  href?: string | null;
  tabular?: boolean;
  /** Takes the whole row (an address). */
  wide?: boolean;
  /** A second link after the value ("str. Ismail 88 · Directions"). */
  extra?: { label: string; href: string | null };
}
function fields(tone: ToneName, items: Field[]): Block {
  const present = items.filter((f): f is Field & { value: string } => Boolean(f.value));
  if (present.length === 0) return NONE;
  const main = onPass(tone);
  const deep = onPass(tone, true);
  const cell = (f: Field & { value: string }, span = 1) => {
    const safe = safeUrl(f.href);
    const extraHref = safeUrl(f.extra?.href);
    const valueStyle = `font-size:15px;line-height:1.4;font-weight:700;color:${main.color};${f.tabular ? 'font-variant-numeric:tabular-nums;letter-spacing:0.02em;' : ''}`;
    const value = safe
      ? `<a class="${main.cls}" href="${escapeHtml(safe)}" style="${valueStyle}text-decoration:underline;text-underline-offset:3px">${escapeHtml(noOrphan(f.value))}</a>`
      : `<span class="${main.cls}" style="${valueStyle}">${escapeHtml(noOrphan(f.value))}</span>`;
    const extra = f.extra && extraHref
      ? `<span class="${deep.cls}" style="color:${deep.color}"> · </span><a class="${main.cls}" href="${escapeHtml(extraHref)}" style="font-size:15px;font-weight:700;color:${main.color};text-decoration:underline;text-underline-offset:3px">${escapeHtml(f.extra.label)}</a>`
      : '';
    return (
      `<td valign="top"${span > 1 ? ` colspan="${span}"` : ''} style="padding:0 12px 12px 0">` +
      `<p class="${deep.cls}" style="margin:0 0 2px;font-size:12px;line-height:1.35;color:${deep.color}">${escapeHtml(f.label)}</p>` +
      `<p style="margin:0">${value}${extra}</p></td>`
    );
  };
  const rows: string[] = [];
  let pair: Array<Field & { value: string }> = [];
  const flush = () => {
    if (pair.length) rows.push(`<tr>${pair.map((f) => cell(f)).join('')}${pair.length === 1 ? '<td></td>' : ''}</tr>`);
    pair = [];
  };
  for (const f of present) {
    if (f.wide) {
      flush();
      rows.push(`<tr>${cell(f, 2)}</tr>`);
    } else {
      pair.push(f);
      if (pair.length === 2) flush();
    }
  }
  flush();
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed">${rows.join('')}</table>`,
    text: present.map((f) => `${f.label}: ${f.value}${f.extra && safeUrl(f.extra.href) ? ` (${f.extra.label}: ${safeUrl(f.extra.href)})` : ''}`).join('\n'),
  };
}

/** A field label on a pass (above its value), in the pass's own deep tone. */
function passLabel(tone: ToneName, value: string): string {
  const deep = onPass(tone, true);
  return `<p class="${deep.cls}" style="margin:0 0 4px;font-size:12px;line-height:1.35;color:${deep.color}">${escapeHtml(value)}</p>`;
}

/** Text on a pass: the main colour or the deep tone of its hue. */
const onPass = (tone: ToneName, deep = false) =>
  deep ? { cls: `nba-deep-${tone}`, color: TONES[tone].deep } : { cls: 'nba-pass-text', color: TONES[tone].text };

/** Rows of name and amount (prices), with an optional total under a dashed rule. */
function lines(tone: ToneName, rows: Array<[string, string]>, total?: [string, string] | null): Block {
  const main = onPass(tone);
  const deep = onPass(tone, true);
  const row = ([name, amount]: [string, string], strong = false, rule = false) =>
    `<tr><td class="${strong ? main.cls : main.cls}" style="padding:${rule ? '10px' : '3px'} 12px 3px 0;font-size:15px;line-height:1.45;color:${main.color};${strong ? 'font-weight:700;' : ''}${rule ? `border-top:1px dashed ${TONES[tone].perf};` : ''}">${escapeHtml(noOrphan(name))}</td>` +
    `<td align="right" class="${strong ? main.cls : deep.cls}" style="padding:${rule ? '10px' : '3px'} 0 3px;font-size:15px;line-height:1.45;white-space:nowrap;font-variant-numeric:tabular-nums;color:${strong ? main.color : deep.color};${strong ? 'font-weight:700;' : 'font-weight:600;'}${rule ? `border-top:1px dashed ${TONES[tone].perf};` : ''}">${escapeHtml(amount)}</td></tr>`;
  const html =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    rows.map((r) => row(r)).join('') +
    (total ? row(total, true, rows.length > 0) : '') +
    `</table>`;
  const text = [...rows, ...(total ? [total] : [])].map(([name, amount]) => `${name}: ${amount}`).join('\n');
  return { html, text };
}

/** Plain lines of text on a pass (a note, a list of services without prices). */
function passText(tone: ToneName, value: string, deep = true, size = 14): Block {
  const c = onPass(tone, deep);
  return {
    html: `<p class="${c.cls}" style="margin:0;font-size:${size}px;line-height:1.5;color:${c.color}">${value.split('\n').map((line) => escapeHtml(noOrphan(line))).join('<br>')}</p>`,
    text: value,
  };
}

/** The loyalty card's slots, as in the app: numbered circles, dashed ones carry a discount. */
function stampGrid(tone: ToneName, cycle: number, rewards: Array<{ visit: number; percent: number }>, stamped = 0): Block {
  const t = TONES[tone];
  const slots = Array.from({ length: cycle }, (_, i) => i + 1);
  const disc = (visit: number) => {
    const reward = rewards.find((r) => r.visit === visit);
    const filled = visit <= stamped;
    const next = visit === stamped + 1;
    const border = filled ? 0 : 2;
    const look = filled
      ? `background:${t.accent};color:#FFFFFF;`
      : reward
        ? `background:#FFFFFF;border:2px dashed ${t.accent};color:${t.deep};`
        : `background:#FFFFFF;border:2px solid ${next && stamped > 0 ? INK : t.perf};color:${t.deep};`;
    const label = reward && !filled ? `−${reward.percent}%` : String(visit);
    return (
      `<td align="center" width="25%" style="padding:0 0 10px"><div style="width:48px;height:48px;line-height:${48 - 2 * border}px;border-radius:48px;box-sizing:border-box;${look}` +
      `font-size:${reward && !filled ? 13 : 15}px;font-weight:800;text-align:center">${escapeHtml(label)}</div></td>`
    );
  };
  const rows: string[] = [];
  for (let i = 0; i < slots.length; i += 4) {
    const row = slots.slice(i, i + 4);
    rows.push(`<tr>${row.map(disc).join('')}${'<td width="25%"></td>'.repeat(4 - row.length)}</tr>`);
  }
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed">${rows.join('')}</table>`,
    text: `${stamped}/${cycle}` + (rewards.length ? ` (${rewards.map((r) => `${r.visit}: −${r.percent}%`).join(', ')})` : ''),
  };
}

/**
 * Pill buttons as inline blocks, so a second button drops under the first on a narrow phone
 * (or in a longer language) instead of widening the email.
 */
function buttons(items: Array<{ label: string; url: string | null; primary?: boolean }>): Block {
  const valid = items.flatMap((item) => {
    const url = safeUrl(item.url);
    return url ? [{ ...item, url }] : [];
  });
  if (valid.length === 0) return NONE;
  const links = valid
    .map((item) => {
      const look = item.primary
        ? `background:${INK};color:#FFFFFF;border:1px solid ${INK}`
        : `background:#FFFFFF;color:${INK};border:1px solid #D9D2D6`;
      return (
        `<a class="${item.primary ? 'nba-btn' : 'nba-btn-alt'}" href="${escapeHtml(item.url)}" ` +
        `style="display:inline-block;margin:0 8px 8px 0;${look};text-decoration:none;font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;padding:13px 22px;border-radius:999px;white-space:nowrap">` +
        `${escapeHtml(item.label)}</a>`
      );
    })
    .join('');
  return {
    html: `<div style="margin:0 0 8px;font-size:0;line-height:0">${links}</div>`,
    text: valid.map((item) => `${item.label}: ${item.url}`).join('\n'),
  };
}

function linkLine(label: string, url: string | null): Block {
  const safe = safeUrl(url);
  if (!safe) return NONE;
  return {
    html: `<p style="margin:0 0 8px;font-size:13px;line-height:1.5"><a class="nba-muted" href="${escapeHtml(safe)}" style="color:${MUTED};text-decoration:underline;text-underline-offset:3px">${escapeHtml(label)}</a></p>`,
    text: `${label}: ${safe}`,
  };
}

/** The app's address (for the logo and the email's own images), from any absolute app link. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function render(opts: {
  locale: Locale;
  to: string;
  toName?: string;
  /** Any absolute link into the app: the logo is loaded from the same address. */
  appUrl: string;
  subject: string;
  preheader: string;
  heading: string;
  lead?: string;
  blocks: Block[];
  footer: Block[];
  replyTo?: string;
}): MailMessage {
  const app = originOf(opts.appUrl);
  const home = `${app}${opts.locale === 'ro' ? '' : `/${opts.locale}`}`;
  const lead = opts.lead ? para(opts.lead, `font-size:17px;line-height:1.5;color:${MUTED}`, 'nba-muted') : NONE;
  const body = [lead, ...opts.blocks].filter((b) => b.html).map((b) => b.html).join('\n');
  const footer = opts.footer.filter((b) => b.html).map((b) => b.html.replace('margin:0 0 16px', 'margin:0 0 6px')).join('\n');
  const html = `<!doctype html>
<html lang="${opts.locale}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<title>${escapeHtml(opts.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;600;700;800&amp;display=swap" rel="stylesheet">
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
/* iOS Mail turns dates, times, addresses and numbers into its own links: keep them in our colours. */
a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;font-size:inherit !important;font-family:inherit !important;font-weight:inherit !important;line-height:inherit !important}
@media (prefers-color-scheme:dark){
.nba-page{background:#161516 !important}
.nba-text{color:#F5F1F4 !important}
.nba-muted{color:#B9B2B7 !important}
.nba-rule{border-color:#333133 !important}
.nba-btn{background:#FFFFFF !important;color:${INK} !important;border-color:#FFFFFF !important}
.nba-btn-alt{background:transparent !important;color:#F5F1F4 !important;border-color:#5A5C5B !important}
.nba-pass-text{color:#FFFFFF !important}
.nba-pass-blush{background:#3A1C35 !important}.nba-deep-blush{color:#F6B8DE !important}.nba-perf-blush{border-color:#6A3A62 !important}
.nba-pass-peach{background:#382711 !important}.nba-deep-peach{color:#F8CF94 !important}.nba-perf-peach{border-color:#6B4E24 !important}
.nba-pass-cyan{background:#0F3438 !important}.nba-deep-cyan{color:#A6E4EA !important}.nba-perf-cyan{border-color:#2A5F65 !important}
.nba-pass-stone{background:#2A292A !important}.nba-deep-stone{color:#D4CFD2 !important}.nba-perf-stone{border-color:#4C4A4C !important}
.nba-pass-ink{background:#2E302F !important}.nba-perf-ink{border-color:#4A4C4B !important}
}
[data-ogsc] .nba-text,[data-ogsc] .nba-pass-text{color:#F5F1F4 !important}
[data-ogsc] .nba-muted{color:#B9B2B7 !important}
</style>
</head>
<body class="nba-page" style="margin:0;padding:0;background:${PAGE};-webkit-text-size-adjust:100%">
<!-- THESIS: every message is the studio's pass, the same object as the loyalty card in the app; refuses the generic centred card with a tracked-caps wordmark. OWN-WORLD: white page, the pink logo, one tight bold headline, a 16px-radius pass in a state colour (blush, peach, cyan, stone, ink) with a perforated stub, ink pill buttons. STORY: the reader sees what happened and when at a glance, then acts with one button. FIRST VIEWPORT: logo top left, headline, one line of lead, the pass with the time in 44px and the day in 21px, then label-over-value fields (length, master, booking code, where). FORM: brief-pinned (the owner chose "Wallet-pass ticket"), position 1, no seed. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(opts.preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="nba-page" style="background:${PAGE}">
<tr><td align="center" style="padding:28px 16px 40px">
<!--[if mso]><table role="presentation" width="480" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;font-family:${FONT}">
<tr><td style="padding:0 4px 28px"><a href="${escapeHtml(home)}" style="text-decoration:none"><img src="${escapeHtml(`${app}/email/logo.png`)}" width="88" alt="${BRAND}" style="display:block;border:0;width:88px;height:auto;font-family:${FONT};font-size:18px;font-weight:800;color:#FD2578"></a></td></tr>
<tr><td style="padding:0 4px;font-family:${FONT};color:${INK}">
<h1 class="nba-text" style="margin:0 0 10px;font-size:28px;line-height:1.15;font-weight:800;letter-spacing:-0.02em;color:${INK};text-wrap:balance">${escapeHtml(noOrphan(opts.heading))}</h1>
${body}
</td></tr>
<tr><td class="nba-rule" style="padding:18px 4px 0;border-top:1px solid ${LINE};font-family:${FONT}">
${footer}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
  const text = [
    BRAND,
    '',
    opts.heading,
    ...(opts.lead ? ['', opts.lead] : []),
    '',
    ...opts.blocks.filter((b) => b.text).flatMap((b) => [b.text, '']),
    '--',
    ...opts.footer.filter((b) => b.text).map((b) => b.text),
    '',
  ].join('\n');
  return { to: opts.to, toName: opts.toName, subject: opts.subject, html, text, replyTo: opts.replyTo };
}

// ── Shared copy ──────────────────────────────────────────────────────────────────

/** "2 h 30 min", in one piece: the number, its unit and the minutes never split. */
function length(minutes: number, h: string, min: string): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}${NBSP}${min}`;
  return rest ? `${hours}${NBSP}${h}${NBSP}${rest}${NBSP}${min}` : `${hours}${NBSP}${h}`;
}

const COMMON: Record<
  Locale,
  {
    greeting: (name: string) => string;
    signature: string;
    neverShare: string;
    codeChip: string;
    codeValid: string;
    from: (value: string) => string;
    total: string;
    duration: (minutes: number) => string;
    withMaster: (name: string) => string;
  }
> = {
  ro: {
    greeting: (name) => (name ? `Bună, ${name}!` : 'Bună!'),
    signature: `${BRAND} · Chișinău`,
    neverShare: 'Nu da nimănui acest cod. Salonul nu ți-l va cere niciodată.',
    codeChip: 'Codul tău',
    codeValid: 'Valabil 10\u00a0minute',
    from: (value) => `de${NBSP}la${NBSP}${value}`,
    total: 'Total estimat',
    duration: (m) => length(m, 'h', 'min'),
    withMaster: (name) => `cu ${name}`,
  },
  ru: {
    greeting: (name) => (name ? `Здравствуйте, ${name}!` : 'Здравствуйте!'),
    signature: `${BRAND} · Кишинёв`,
    neverShare: 'Никому не сообщайте этот код. Салон никогда его не спросит.',
    codeChip: 'Ваш код',
    codeValid: 'Действует 10\u00a0минут',
    from: (value) => `от${NBSP}${value}`,
    total: 'Итого, ориентировочно',
    duration: (m) => length(m, 'ч', 'мин'),
    withMaster: (name) => `мастер ${name}`,
  },
  en: {
    greeting: (name) => (name ? `Hi ${name},` : 'Hi,'),
    signature: `${BRAND} · Chișinău`,
    neverShare: 'Never share this code. The studio will never ask you for it.',
    codeChip: 'Your code',
    codeValid: 'Valid for 10\u00a0minutes',
    from: (value) => `from${NBSP}${value}`,
    total: 'Estimated total',
    duration: (m) => length(m, 'h', 'min'),
    withMaster: (name) => `with ${name}`,
  },
};

function money(amount: number, currency: string, locale: Locale, from = false): string {
  // "550 MDL" and "1 200 MDL" in one piece (the narrow no-break space is not in every font).
  const number = new Intl.NumberFormat(LOCALE_TAGS[locale], { maximumFractionDigits: 0 }).format(amount).replace(/[\u202f ]/g, NBSP);
  const value = `${number}${NBSP}${currency}`;
  return from ? COMMON[locale].from(value) : value;
}

/**
 * The code on an ink pass: big tabular digits, spaced by tracking rather than a space so it
 * copies (and autofills from Mail) as one word; how long it lasts.
 */
function codePass(locale: Locale, code: string, stub?: string): Block {
  const c = COMMON[locale];
  return pass({
    tone: 'ink',
    main: {
      html:
        passLabel('ink', c.codeChip) +
        `<p class="nba-pass-text" style="margin:0;font-size:44px;line-height:1.05;font-weight:800;letter-spacing:0.12em;font-variant-numeric:tabular-nums;color:#FFFFFF">${escapeHtml(code)}</p>` +
        `<p class="nba-deep-ink" style="margin:8px 0 0;font-size:14px;line-height:1.4;color:${TONES.ink.deep}">${escapeHtml(c.codeValid)}</p>`,
      text: `${c.codeChip}: ${code} (${c.codeValid})`,
    },
    stub: stub ? passText('ink', stub) : undefined,
  });
}

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
      body: (email) => `Introdu acest cod în aplicație ca să confirmi adresa ${email}. Codul este valabil 10\u00a0minute.`,
      ignore: 'Nu ți-ai creat cont la noi? Ignoră acest mesaj: fără cod nu se schimbă nimic.',
    },
    ru: {
      subject: (code) => `Подтверждение email: код ${code}`,
      heading: 'Подтвердите email',
      body: (email) => `Введите этот код в приложении, чтобы подтвердить адрес ${email}. Код действует 10\u00a0минут.`,
      ignore: 'Не создавали аккаунт? Просто проигнорируйте письмо: без кода ничего не изменится.',
    },
    en: {
      subject: (code) => `Confirm your email: code ${code}`,
      heading: 'Confirm your email',
      body: (email) => `Enter this code in the app to confirm ${email}. It's valid for 10\u00a0minutes.`,
      ignore: "Didn't create an account? Ignore this email: nothing changes without the code.",
    },
  },
  change_email: {
    ro: {
      subject: (code) => `Confirmă noul email: codul ${code}`,
      heading: 'Confirmă noul email',
      body: (email) => `Introdu acest cod în aplicație ca să folosești ${email} pentru contul ${BRAND}. Codul este valabil 10\u00a0minute.`,
      ignore: 'Nu ai cerut această schimbare? Ignoră mesajul: contul rămâne neschimbat.',
    },
    ru: {
      subject: (code) => `Подтверждение нового email: код ${code}`,
      heading: 'Подтвердите новый email',
      body: (email) => `Введите этот код в приложении, чтобы использовать ${email} для аккаунта ${BRAND}. Код действует 10\u00a0минут.`,
      ignore: 'Не запрашивали изменение? Проигнорируйте письмо: аккаунт останется прежним.',
    },
    en: {
      subject: (code) => `Confirm your new email: code ${code}`,
      heading: 'Confirm your new email',
      body: (email) => `Enter this code in the app to use ${email} for your ${BRAND} account. It's valid for 10\u00a0minutes.`,
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
  /** The app's address (the logo is loaded from it). */
  appUrl: string;
  replyTo?: string;
}): MailMessage {
  const t = CODE_COPY[opts.purpose][opts.locale];
  const c = COMMON[opts.locale];
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    appUrl: opts.appUrl,
    subject: t.subject(opts.code),
    preheader: t.body(opts.to),
    heading: t.heading,
    lead: t.body(opts.to),
    blocks: [codePass(opts.locale, opts.code, c.neverShare)],
    footer: [small(t.ignore), small(c.signature)],
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
    body: 'Am primit o cerere de resetare a parolei. Introdu acest cod în aplicație ca să setezi o parolă nouă. Codul este valabil 10\u00a0minute.',
    orLink: 'Sau folosește butonul de mai jos (linkul este valabil 30\u00a0de\u00a0minute).',
    cta: 'Setează o parolă nouă',
    ignore: 'Dacă nu ai cerut tu resetarea, ignoră acest mesaj. Parola rămâne neschimbată.',
  },
  ru: {
    subject: (code) => `Сброс пароля: код ${code}`,
    heading: 'Сброс пароля',
    body: 'Мы получили запрос на сброс пароля. Введите этот код в приложении, чтобы задать новый пароль. Код действует 10\u00a0минут.',
    orLink: 'Или нажмите кнопку ниже (ссылка действует 30\u00a0минут).',
    cta: 'Задать новый пароль',
    ignore: 'Если вы не запрашивали сброс, просто проигнорируйте это письмо. Пароль не изменится.',
  },
  en: {
    subject: (code) => `Reset your password: code ${code}`,
    heading: 'Reset your password',
    body: 'We received a request to reset your password. Enter this code in the app to set a new one. It is valid for 10\u00a0minutes.',
    orLink: 'Or use the button below (the link is valid for 30\u00a0minutes).',
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
    appUrl: opts.link,
    subject: t.subject(opts.code),
    preheader: t.body,
    heading: t.heading,
    lead: t.body,
    blocks: [
      codePass(opts.locale, opts.code, c.neverShare),
      para(t.orLink, `font-size:15px;line-height:1.5;color:${MUTED}`, 'nba-muted'),
      buttons([{ label: t.cta, url: opts.link, primary: true }]),
    ],
    footer: [small(t.ignore), small(c.signature)],
    replyTo: opts.replyTo,
  });
}

const EMAIL_CHANGED_COPY: Record<Locale, { subject: string; heading: string; body: (email: string) => string; notYou: string; chip: string }> = {
  ro: {
    chip: 'Emailul nou',
    subject: `Emailul contului ${BRAND} a fost schimbat`,
    heading: 'Emailul contului a fost schimbat',
    body: (email) => `De acum, contul tău folosește adresa ${email}. Mesajele despre vizite ajung acolo.`,
    notYou: 'Dacă nu ai făcut tu această schimbare, contactează imediat salonul.',
  },
  ru: {
    chip: 'Новый email',
    subject: `Email аккаунта ${BRAND} изменён`,
    heading: 'Email аккаунта изменён',
    body: (email) => `Теперь ваш аккаунт использует адрес ${email}. Письма о визитах будут приходить туда.`,
    notYou: 'Если это были не вы, срочно свяжитесь с салоном.',
  },
  en: {
    chip: 'New email',
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
  /** The app's address (the logo is loaded from it). */
  appUrl: string;
  replyTo?: string;
}): MailMessage {
  const t = EMAIL_CHANGED_COPY[opts.locale];
  const c = COMMON[opts.locale];
  const masked = maskEmail(opts.newEmail);
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    appUrl: opts.appUrl,
    subject: t.subject,
    preheader: t.body(masked),
    heading: t.heading,
    lead: t.body(masked),
    blocks: [
      pass({
        tone: 'stone',
        main: { html: passLabel('stone', t.chip) + passText('stone', masked, false, 22).html, text: `${t.chip}: ${masked}` },
        stub: passText('stone', t.notYou),
      }),
    ],
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
  /** Each service with its list price, the visit's length and total (the price lines on the pass). */
  lines?: Array<{ name: string; price: number; priceFrom: boolean }>;
  total?: { amount: number; from: boolean; currency: string } | null;
  durationMin?: number;
  /** Signed "Add to calendar" (.ics) link, when there is one. */
  calendarUrl?: string | null;
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
  const date = keepDateTogether(new Intl.DateTimeFormat(tag, { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(start));
  const day = toZonedParts(start, timeZone).date;
  const today = toZonedParts(now, timeZone).date;
  const relative = day === today ? 'today' : day === addDays(today, 1) ? 'tomorrow' : null;
  return { time, date, relative };
}

/** "3 octombrie la 03:00" / "3 октября в 03:00" / "3 October at 03:00" (no weekday: Russian would need its genitive). */
function formatDeadline(deadline: Date, locale: Locale, timeZone: string): string {
  return keepDateTogether(
    new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
      timeZone,
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(deadline),
  );
}

/**
 * The parts of a date that read as one ("3 octombrie", "la 03:00", "в 03:00", "at 03:00"), as in
 * the app's lib/format.ts: a line can still break after the weekday and before "la", "в", "at".
 */
function keepDateTogether(text: string): string {
  return text
    .replace(/(^|\s)(\d{1,2}) (?=\p{L})/gu, `$1$2${NBSP}`)
    .replace(/(\d{4}) (?=г\.)/gu, `$1${NBSP}`)
    .replace(/(^|\s)(\p{L}{1,2}) (?=\d{1,2}:\d{2})/gu, `$1$2${NBSP}`);
}

const VISIT_COPY: Record<
  Locale,
  {
    when: (v: VisitTime) => string;
    labels: { when: string; services: string; master: string; where: string; code: string; length: string; status: string };
    view: string;
    directions: string;
    calendar: string;
    bookAgain: string;
    chip: Record<'requested' | 'confirmed' | 'rescheduled' | 'cancelled', string> & { reminder: (v: VisitTime) => string };
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
    labels: { when: 'Când', services: 'Servicii', master: 'Maestru', where: 'Unde', code: 'Codul programării', length: 'Durata', status: 'Stare' },
    view: 'Vezi programarea',
    directions: 'Cum ajungi',
    calendar: 'Adaugă în calendar',
    chip: {
      requested: 'Așteaptă confirmarea',
      confirmed: 'Confirmată',
      rescheduled: 'Oră nouă',
      cancelled: 'Anulată',
      reminder: (v) => (v.relative === 'today' ? 'Azi' : v.relative === 'tomorrow' ? 'Mâine' : 'În curând'),
    },
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
    labels: { when: 'Когда', services: 'Услуги', master: 'Мастер', where: 'Где', code: 'Код записи', length: 'Длительность', status: 'Статус' },
    view: 'Открыть запись',
    directions: 'Как добраться',
    calendar: 'Добавить в календарь',
    chip: {
      requested: 'Ждёт подтверждения',
      confirmed: 'Подтверждена',
      rescheduled: 'Новое время',
      cancelled: 'Отменена',
      reminder: (v) => (v.relative === 'today' ? 'Сегодня' : v.relative === 'tomorrow' ? 'Завтра' : 'Скоро'),
    },
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
    labels: { when: 'When', services: 'Services', master: 'Master', where: 'Where', code: 'Booking code', length: 'Length', status: 'Status' },
    view: 'View booking',
    directions: 'Directions',
    calendar: 'Add to calendar',
    chip: {
      requested: 'Awaiting confirmation',
      confirmed: 'Confirmed',
      rescheduled: 'New time',
      cancelled: 'Cancelled',
      reminder: (v) => (v.relative === 'today' ? 'Today' : v.relative === 'tomorrow' ? 'Tomorrow' : 'Coming up'),
    },
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

/**
 * A visit on its pass: the time large, the day under it, length and master on the right; the
 * stub lists the services, with prices and an estimated total when `prices` is on.
 */
/**
 * A visit on its pass: the time large and the day under it, then label-over-value fields
 * (length, master, booking code, where with directions); the stub lists the services with
 * their prices and an estimated total when `prices` is on. `first` puts fields ahead (the
 * client and phone for staff, a status for a pending reminder).
 */
function visitPass(
  locale: Locale,
  tone: ToneName,
  visit: VisitInfo,
  when: VisitTime,
  opts: { prices: boolean; first?: Field[]; relative?: string | null },
): Block {
  const c = COMMON[locale];
  const v = VISIT_COPY[locale];
  const main = onPass(tone);
  const day = capitalize(opts.relative ? `${opts.relative}, ${when.date}` : when.date);
  const head =
    `<p class="${main.cls}" style="margin:0;font-size:44px;line-height:1;font-weight:800;letter-spacing:-0.02em;color:${main.color}">${escapeHtml(when.time)}</p>` +
    `<p class="${main.cls}" style="margin:8px 0 0;font-size:21px;line-height:1.25;font-weight:700;letter-spacing:-0.01em;color:${main.color}">${escapeHtml(day)}</p>`;
  const info = fields(tone, [
    ...(opts.first ?? []),
    { label: v.labels.length, value: visit.durationMin ? c.duration(visit.durationMin) : null },
    { label: v.labels.master, value: visit.master },
    { label: v.labels.code, value: visit.code, tabular: true },
    ...(visit.address || visit.directionsUrl
      ? [{ label: v.labels.where, value: visit.address ?? v.directions, wide: true, extra: visit.address ? { label: v.directions, href: visit.directionsUrl } : undefined, href: visit.address ? null : visit.directionsUrl }]
      : []),
  ]);
  const priced = opts.prices && visit.lines && visit.lines.length > 0;
  const stub = priced
    ? lines(
        tone,
        visit.lines!.map((l) => [l.name, money(l.price, visit.total?.currency ?? 'MDL', locale, l.priceFrom)]),
        visit.total ? [c.total, money(visit.total.amount, visit.total.currency, locale, visit.total.from)] : null,
      )
    : passText(tone, visit.services.join('\n'), false, 15);
  return pass({ tone, main: { html: head, text: `${when.time} · ${day}` }, fields: info, stub });
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
  const pending = opts.visit.status === 'pending';
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    appUrl: opts.visit.bookUrl,
    subject: t.reminder.subject(when),
    preheader: `${t.when(when)} · ${opts.visit.services.join(', ')}`,
    heading: t.reminder.heading,
    lead: t.reminder.lead(opts.name),
    blocks: [
      visitPass(opts.locale, pending ? 'peach' : 'blush', opts.visit, when, {
        prices: true,
        relative: when.relative ? t.chip.reminder(when) : null,
        first: pending ? [{ label: t.labels.status, value: t.chip.requested, wide: true }] : [],
      }),
      pending ? para(t.pending, `font-size:15px;line-height:1.5;color:${INK}`) : NONE,
      buttons([
        { label: t.view, url: opts.visit.bookingUrl, primary: true },
        { label: t.calendar, url: opts.visit.calendarUrl ?? null },
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
  const tone: ToneName = opts.kind === 'requested' ? 'peach' : opts.kind === 'rescheduled' ? 'cyan' : cancelled ? 'stone' : 'blush';
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    appUrl: opts.visit.bookUrl,
    subject: copy.subject(when),
    preheader: lead,
    heading: copy.heading,
    lead,
    blocks: [
      visitPass(opts.locale, tone, opts.visit, when, { prices: !cancelled }),
      cancelled ? para(t.cancelled.next) : NONE,
      cancelled
        ? buttons([{ label: t.bookAgain, url: opts.visit.bookUrl, primary: true }])
        : buttons([
            { label: t.view, url: opts.visit.bookingUrl, primary: true },
            { label: t.calendar, url: opts.visit.calendarUrl ?? null },
          ]),
      cancelled ? NONE : changeNote(t, opts.visit, opts.locale, opts.timeZone, opts.now),
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
  // The staff pass is ink: who comes and when, then what they booked.
  const visit = visitPass(opts.locale, 'ink', opts.visit, when, {
    prices: opts.event !== 'cancelled',
    first: [
      { label: t.labels.client, value: opts.client.name },
      { label: t.labels.phone, value: opts.client.phone, href: opts.client.phone ? `tel:${opts.client.phone.replace(/[^+\d]/g, '')}` : null },
    ],
  });
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    appUrl: opts.openUrl,
    subject: t.subject[opts.event](opts.client.name, v.when(when)),
    preheader: t.lead[opts.event],
    heading: t.heading[opts.event],
    lead: t.lead[opts.event],
    blocks: [
      visit,
      buttons([{ label: t.open[opts.event], url: opts.openUrl, primary: true }]),
    ],
    footer: [small(t.why), linkLine(v.settings, opts.settingsUrl), small(c.signature)],
  });
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
    card: string;
  }
> = {
  ro: {
    card: 'Cardul tău de fidelitate',
    subject: 'Bun venit la Nails by Alynna',
    heading: 'Contul tău e gata',
    body: 'Te programezi într-un minut: alegi serviciile, maestrul și ora potrivită. Programările, memento-urile și cardul de fidelitate sunt toate în aplicație.',
    loyalty: (rewards) => `Fiecare vizită e o ștampilă pe cardul de fidelitate: ${rewards}.`,
    reward: (visit, percent) => `${visit === 1 ? 'prima' : `a${NBSP}${visit}-a`} vizită are${NBSP}−${percent}%`,
    book: 'Programează-te',
    install: 'Pune aplicația pe ecran',
    installNote: 'Pe telefon, adaugă aplicația pe ecranul principal: se deschide pe tot ecranul și primești memento-uri.',
  },
  ru: {
    card: 'Ваша карта лояльности',
    subject: 'Добро пожаловать в Nails by Alynna',
    heading: 'Ваш аккаунт готов',
    body: 'Запись занимает минуту: выберите услуги, мастера и удобное время. Записи, напоминания и карта лояльности — всё в приложении.',
    loyalty: (rewards) => `Каждый визит — отметка на карте лояльности: ${rewards}.`,
    reward: (visit, percent) => `${visit}-й визит${NBSP}−${percent}%`,
    book: 'Записаться',
    install: 'Добавить на экран',
    installNote: 'На телефоне добавьте приложение на экран «Домой»: оно откроется на весь экран, и вы будете получать напоминания.',
  },
  en: {
    card: 'Your loyalty card',
    subject: 'Welcome to Nails by Alynna',
    heading: 'Your account is ready',
    body: 'Booking takes a minute: pick services, a master and a time that suits you. Your bookings, reminders and loyalty card are all in the app.',
    loyalty: (rewards) => `Every visit is a stamp on your loyalty card: ${rewards}.`,
    reward: (visit, percent) => {
      const suffix = visit % 10 === 1 && visit !== 11 ? 'st' : visit % 10 === 2 && visit !== 12 ? 'nd' : visit % 10 === 3 && visit !== 13 ? 'rd' : 'th';
      return `your ${visit}${suffix} visit is ${percent}%${NBSP}off`;
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
  const cycle = Math.max(0, ...opts.rewards.map((r) => r.visit));
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    appUrl: opts.appUrl,
    subject: t.subject,
    preheader: t.body,
    heading: t.heading,
    lead: t.body,
    blocks: [
      rewards && cycle > 0 && cycle <= 12
        ? pass({
            tone: 'blush',
            main: { html: passLabel('blush', t.card) + stampGrid('blush', cycle, opts.rewards).html, text: t.card },
            stub: passText('blush', t.loyalty(rewards)),
          })
        : NONE,
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

const LOYALTY_NEXT_COPY: Record<
  Locale,
  { subject: (percent: number) => string; heading: (percent: number) => string; body: string; book: string; card: string; next: string }
> = {
  ro: {
    card: 'Cardul de fidelitate',
    next: 'la următoarea vizită',
    subject: (percent) => `Următoarea vizită are −${percent}%`,
    heading: (percent) => `Următoarea ta vizită are −${percent}%`,
    body: 'Mulțumim pentru vizită! Cardul de fidelitate a ajuns la reducere: se aplică la salon, la prețul următoarei vizite.',
    book: 'Programează-te',
  },
  ru: {
    card: 'Карта лояльности',
    next: 'на следующий визит',
    subject: (percent) => `Следующий визит со скидкой −${percent}%`,
    heading: (percent) => `Ваш следующий визит −${percent}%`,
    body: 'Спасибо за визит! На карте лояльности набралась скидка: она применяется в салоне к стоимости следующего визита.',
    book: 'Записаться',
  },
  en: {
    card: 'Loyalty card',
    next: 'off your next visit',
    subject: (percent) => `Your next visit is ${percent}% off`,
    heading: (percent) => `Your next visit is ${percent}% off`,
    body: 'Thank you for coming in! Your loyalty card has reached a discount: it is applied at the studio, on the price of your next visit.',
    book: 'Book a visit',
  },
};

/** After a visit, when the next one on the card carries a discount. */
export function loyaltyNextEmail(opts: {
  to: string;
  name: string;
  locale: Locale;
  appUrl: string;
  percent: number;
  /** The client's card as it is now: the grid shows the stamps and the discount that is next. */
  card?: { stamps: number; cycle: number; rewards: Array<{ visit: number; percent: number }> };
}): MailMessage {
  const t = LOYALTY_NEXT_COPY[opts.locale];
  const c = COMMON[opts.locale];
  const base = `${opts.appUrl.replace(/\/$/, '')}${localeSegment(opts.locale)}`;
  const card = opts.card && opts.card.cycle > 0 && opts.card.cycle <= 12 ? opts.card : null;
  const next = passText('blush', `−${opts.percent}% ${t.next}`, false, 16);
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    appUrl: opts.appUrl,
    subject: t.subject(opts.percent),
    preheader: t.body,
    heading: t.heading(opts.percent),
    lead: t.body,
    blocks: [
      pass({
        tone: 'blush',
        main: card
          ? { html: passLabel('blush', t.card) + stampGrid('blush', card.cycle, card.rewards, card.stamps).html, text: `${t.card}: ${card.stamps}/${card.cycle}` }
          : { html: passLabel('blush', t.card) + next.html, text: next.text },
        stub: card ? next : undefined,
      }),
      buttons([{ label: t.book, url: `${base}/book`, primary: true }]),
    ],
    footer: [small(c.signature)],
  });
}

// ── After a visit: how was it? ────────────────────────────────────────────────

const FEEDBACK_COPY: Record<
  Locale,
  {
    subject: string;
    heading: string;
    lead: (master: string | null) => string;
    rate: string;
    /** The spoken name of one number in the row ("4 out of 5"). */
    point: (value: number) => string;
    button: string;
    private: string;
  }
> = {
  ro: {
    subject: `Cum a fost vizita ta la ${BRAND}?`,
    heading: 'Cum a fost vizita ta?',
    lead: (master) =>
      master ? `Mulțumim că ai venit! ${master} ar vrea să afle cum ți s-a părut.` : 'Mulțumim că ai venit! Ne-ar plăcea să aflăm cum ți s-a părut.',
    rate: 'Dă o notă de la 1 (slab) la 5 (excelent)',
    point: (value) => `${value} din 5`,
    button: 'Lasă feedback',
    private: 'Părerea ta o citește doar salonul: nu se publică nicăieri.',
  },
  ru: {
    subject: `Как прошёл ваш визит в ${BRAND}?`,
    heading: 'Как прошёл ваш визит?',
    lead: (master) =>
      master ? `Спасибо, что пришли! Мастеру ${master} важно знать, как всё прошло.` : 'Спасибо, что пришли! Нам важно знать, как всё прошло.',
    rate: 'Оцените от 1 (плохо) до 5 (отлично)',
    point: (value) => `${value} из 5`,
    button: 'Оставить отзыв',
    private: 'Отзыв увидит только салон, он нигде не публикуется.',
  },
  en: {
    subject: `How was your visit to ${BRAND}?`,
    heading: 'How was your visit?',
    lead: (master) =>
      master ? `Thank you for coming in. ${master} would love to know how it went.` : 'Thank you for coming in. We would love to know how it went.',
    rate: 'Rate it from 1 (poor) to 5 (excellent)',
    point: (value) => `${value} out of 5`,
    button: 'Leave feedback',
    private: 'Only the studio reads it: nothing is published.',
  },
};

/**
 * The numbers 1 to 5 as pills under the pass, each opening the feedback page with that rating
 * chosen (the client still sends it there, so a mail scanner opening the links rates nothing).
 * Inline blocks, so the row wraps on a narrow phone; digits only, no star glyphs.
 */
function ratingRow(t: (typeof FEEDBACK_COPY)[Locale], feedbackUrl: string): Block {
  const base = safeUrl(feedbackUrl);
  if (!base) return NONE;
  const tone = TONES.blush;
  const links = [1, 2, 3, 4, 5].map((value) => {
    const url = new URL(base);
    url.searchParams.set('rating', String(value));
    return { value, url: url.toString() };
  });
  const pills = links
    .map(
      ({ value, url }) =>
        `<a href="${escapeHtml(url)}" title="${escapeHtml(t.point(value))}" aria-label="${escapeHtml(t.point(value))}" ` +
        `style="display:inline-block;margin:0 8px 8px 0;width:44px;height:44px;line-height:44px;border-radius:999px;background:${tone.field};color:${tone.deep};` +
        `font-family:${FONT};font-size:17px;font-weight:700;font-variant-numeric:tabular-nums;text-align:center;text-decoration:none">${value}</a>`,
    )
    .join('');
  return {
    html:
      `<p class="nba-muted" style="margin:0 0 10px;font-size:14px;line-height:1.45;color:${MUTED}">${escapeHtml(noOrphan(t.rate))}</p>` +
      `<div style="margin:0 0 16px;font-size:0;line-height:0">${pills}</div>`,
    text: [`${t.rate}:`, ...links.map(({ value, url }) => `${value}: ${url}`)].join('\n'),
  };
}

/**
 * After a completed visit: "How was your visit?". The visit on a blush pass, like every visit
 * email (time, day, length, master, code; the services on the stub), then 1–5 to tap and a
 * button to the feedback page.
 */
export function feedbackRequestEmail(opts: {
  to: string;
  name: string;
  locale: Locale;
  timeZone: string;
  now: Date;
  visit: VisitInfo;
  /** The feedback page for this visit (`…/feedback?visit=<id>`); each number adds `&rating=N`. */
  feedbackUrl: string;
  replyTo?: string;
}): MailMessage {
  const t = FEEDBACK_COPY[opts.locale];
  const v = VISIT_COPY[opts.locale];
  const c = COMMON[opts.locale];
  const visit = opts.visit;
  // The same pass as every visit email, so the client knows at a glance which visit it is.
  const when = visitTime(visit.start, opts.locale, opts.timeZone, opts.now);
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    appUrl: opts.feedbackUrl,
    subject: t.subject,
    preheader: t.lead(visit.master),
    heading: t.heading,
    lead: t.lead(visit.master),
    blocks: [
      visitPass(opts.locale, 'blush', visit, when, { prices: false }),
      ratingRow(t, opts.feedbackUrl),
      buttons([{ label: t.button, url: opts.feedbackUrl, primary: true }]),
      small(t.private),
    ],
    footer: visit.settingsUrl
      ? [small(v.updatesWhy), linkLine(v.settings, visit.settingsUrl), small(c.signature)]
      : [small(v.guestWhy), small(c.signature)],
    replyTo: opts.replyTo,
  });
}

// ── Come back: a reminder to book again ─────────────────────────────────────────

const REBOOK_COPY: Record<Locale, { last: string; master: string; book: string; why: string }> = {
  ro: {
    last: 'Ultima ta vizită',
    master: 'Maestru',
    book: 'Programează-te',
    why: 'Primești acest mesaj pentru că amintirile pentru următoarea vizită sunt pornite în Profil → Notificări. Le poți opri oricând.',
  },
  ru: {
    last: 'Ваш прошлый визит',
    master: 'Мастер',
    book: 'Записаться',
    why: 'Вы получили это письмо, потому что напоминания о следующем визите включены в разделе Профиль → Уведомления. Их можно отключить в любой момент.',
  },
  en: {
    last: 'Your last visit',
    master: 'Master',
    book: 'Book a visit',
    why: 'You get this email because reminders to come back are on in Profile → Notifications. You can turn them off any time.',
  },
};

/** "4 weeks ago" / "acum 4 săptămâni" / "4 недели назад": weeks up to two months, then months. */
function sinceVisit(end: Date, now: Date, locale: Locale): string {
  const days = Math.max(0, Math.round((now.getTime() - end.getTime()) / 86_400_000));
  const format = new Intl.RelativeTimeFormat(LOCALE_TAGS[locale], { numeric: 'auto' });
  const value =
    days < 14 ? format.format(-days, 'day') : days < 63 ? format.format(-Math.round(days / 7), 'week') : format.format(-Math.round(days / 30.44), 'month');
  return capitalize(value);
}

/**
 * A reminder to come back: the studio's words (title and text, placeholders already filled), the
 * last visit on a blush pass (how long ago and the day, the master, the loyalty card's next
 * discount when the reminder carries it; the services on the stub), one button to book the same
 * again, and how to switch these reminders off.
 */
export function rebookEmail(opts: {
  to: string;
  name: string;
  locale: Locale;
  timeZone: string;
  now: Date;
  title: string;
  body: string;
  visit: { end: Date; services: string[]; master: string | null };
  /** The loyalty card's next discount ("2 more visits to 15% off"), on the reminders in between. */
  loyalty?: { label: string; text: string } | null;
  /** The booking page with the same services, shape and master. */
  bookUrl: string;
  settingsUrl: string;
  replyTo?: string;
}): MailMessage {
  const t = REBOOK_COPY[opts.locale];
  const c = COMMON[opts.locale];
  const main = onPass('blush');
  const ago = sinceVisit(opts.visit.end, opts.now, opts.locale);
  const day = capitalize(
    new Intl.DateTimeFormat(LOCALE_TAGS[opts.locale], { timeZone: opts.timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(opts.visit.end),
  );
  const head =
    passLabel('blush', t.last) +
    `<p class="${main.cls}" style="margin:0;font-size:32px;line-height:1.1;font-weight:800;letter-spacing:-0.02em;color:${main.color}">${escapeHtml(ago)}</p>` +
    `<p class="${main.cls}" style="margin:8px 0 0;font-size:19px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:${main.color}">${escapeHtml(day)}</p>`;
  return render({
    locale: opts.locale,
    to: opts.to,
    toName: opts.name,
    appUrl: opts.bookUrl,
    subject: opts.title,
    preheader: opts.body,
    heading: opts.title,
    lead: opts.body,
    blocks: [
      pass({
        tone: 'blush',
        main: { html: head, text: `${t.last}: ${ago} · ${day}` },
        fields: fields('blush', [
          { label: t.master, value: opts.visit.master },
          ...(opts.loyalty ? [{ label: opts.loyalty.label, value: capitalize(opts.loyalty.text), wide: true }] : []),
        ]),
        stub: passText('blush', opts.visit.services.join('\n'), false, 15),
      }),
      buttons([{ label: t.book, url: opts.bookUrl, primary: true }]),
    ],
    footer: [small(t.why), linkLine(VISIT_COPY[opts.locale].settings, opts.settingsUrl), small(c.signature)],
    replyTo: opts.replyTo,
  });
}
