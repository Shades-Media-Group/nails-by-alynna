import type { ObjectId } from 'bson';
import type { AppDeps } from '../../context';
import type { AppointmentDoc, NotificationLogDoc, RebookSettings, RebookText, RebookTone, UserDoc } from '../../db/types';
import { rebookEmail } from '../../lib/emails';
import { pushAvailable, sendPushToUser, type PushPayload } from '../../lib/push';
import { DAY, toZonedParts } from '../../lib/time';
import { LOCALES, type Locale } from '../../lib/validation';
import { completedVisits, nextReward, rulesFrom } from '../loyalty/service';
import { REBOOK_LIMITS, getSettings } from '../settings';
import { appLink } from './content';
import { MAX_ATTEMPTS, canEmail, canNotify, deliver } from './deliver';
import type { TickSummary } from './scheduler';

/*
 * "Come back" reminders (Admin → Settings): a client whose last completed visit was
 * `firstAfterDays` ago, and who has booked nothing since, gets a friendly reminder, then one
 * every `repeatEveryDays`, `maxReminders` in all, each in its own tone. The next visit starts
 * the count again from that visit.
 */

/** Sent in the studio's daytime only (studio time zone): never at night, also after downtime. */
const SEND_FROM_HOUR = 10;
const SEND_UNTIL_HOUR = 20;
/** Every step a count can have: steps logged under other settings still count. */
const MAX_STEPS = REBOOK_LIMITS.maxReminders.max;

export const rebookKey = (userId: ObjectId, lastVisitId: ObjectId, step: number) =>
  `rebook:${userId.toHexString()}:${lastVisitId.toHexString()}:${step}`;

type Schedule = Pick<RebookSettings, 'firstAfterDays' | 'repeatEveryDays' | 'maxReminders'>;

/**
 * The reminder due now (1 = the first) for a last visit that ended at `lastEnd`, or null. Step k
 * falls due `firstAfterDays + (k - 1) · repeatEveryDays` after the visit and stays due until the
 * next one does (the last one for as long), so after downtime only the latest goes out.
 */
export function dueStep(lastEnd: Date, now: Date, schedule: Schedule): number | null {
  const since = now.getTime() - lastEnd.getTime() - schedule.firstAfterDays * DAY;
  if (since < 0) return null;
  const step = Math.floor(since / (schedule.repeatEveryDays * DAY)) + 1;
  return step <= schedule.maxReminders ? step : null;
}

/** The first reminder, the last one, or one in between (they carry the loyalty card's progress). */
export function toneOf(step: number, maxReminders: number): RebookTone {
  if (step <= 1) return 'first';
  return step >= maxReminders ? 'last' : 'nudge';
}

// ── What they say ────────────────────────────────────────────────────────────

/** What a text may mention; the studio's own texts too (anything else in braces is refused). */
export const REBOOK_PLACEHOLDERS = ['name', 'services', 'master'] as const;
type Placeholder = (typeof REBOOK_PLACEHOLDERS)[number];
export type RebookValues = Record<Placeholder, string>;

/**
 * The built-in wording, used wherever the studio left a text empty. A service reminder, not an
 * offer: no guilt, no countdown, no discount the studio did not set.
 */
export const REBOOK_DEFAULTS: Record<RebookTone, RebookText> = {
  first: {
    title: { ro: 'E timpul pentru o manichiură nouă?', ru: 'Пора обновить маникюр?', en: 'Time for a refill?' },
    body: {
      ro: 'Bună, {name}! Ultima ta vizită: {services}, cu {master}. Când ești gata pentru următoarea, te programezi într-un minut.',
      ru: 'Здравствуйте, {name}! Ваш прошлый визит: {services}, мастер {master}. Когда будете готовы к следующему, запись займёт минуту.',
      en: 'Hi {name}! Your last visit: {services} with {master}. Whenever you are ready for the next one, booking takes a minute.',
    },
  },
  nudge: {
    title: { ro: 'Te gândești la următoarea vizită?', ru: 'Думаете о следующем визите?', en: 'Thinking about your next visit?' },
    body: {
      ro: 'Bună, {name}! A trecut ceva timp de la ultima ta vizită. Când ai chef de unghii noi, alege în aplicație ora care ți se potrivește.',
      ru: 'Здравствуйте, {name}! С прошлого визита прошло немного времени. Когда захочется обновить маникюр, выберите удобное время в приложении.',
      en: "Hi {name}! It's been a while since your last visit. When you feel like fresh nails, pick a time that suits you in the app.",
    },
  },
  last: {
    title: { ro: 'Ne-ar plăcea să te revedem', ru: 'Будем рады видеть вас снова', en: "We'd love to see you again" },
    body: {
      ro: 'Bună, {name}! Fără nicio grabă: când ai chef de unghii noi, te programezi în aplicație într-un minut.',
      ru: 'Здравствуйте, {name}! Без спешки: когда захочется обновить маникюр, запись в приложении займёт минуту.',
      en: 'Hi {name}! No rush at all: whenever you feel like fresh nails, booking in the app takes a minute.',
    },
  },
};

const PLACEHOLDER = /\{([^{}]*)\}/g;

/** Whether every `{…}` in a text is one of the placeholders. */
export function knownPlaceholders(text: string): boolean {
  return [...text.matchAll(PLACEHOLDER)].every(([, key]) => (REBOOK_PLACEHOLDERS as readonly string[]).includes(key ?? ''));
}

/** A text with its placeholders filled; an empty value takes its comma along ("Hi {name}!" → "Hi!"). */
export function fillText(template: string, values: RebookValues): string {
  const filled = template.replace(PLACEHOLDER, (match, key: string) =>
    (REBOOK_PLACEHOLDERS as readonly string[]).includes(key) ? values[key as Placeholder] : match,
  );
  return filled
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/,(?=[!?.;:])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Title and text of one reminder in `locale`: the studio's own wording, or the built-in one. */
export function rebookTexts(rebook: Pick<RebookSettings, 'texts'>, tone: RebookTone, locale: Locale, values: RebookValues) {
  const own = rebook.texts[tone];
  const pick = (field: keyof RebookText) => own[field][locale].trim() || REBOOK_DEFAULTS[tone][field][locale];
  return { title: fillText(pick('title'), values), body: fillText(pick('body'), values) };
}

const LOYALTY: Record<Locale, { card: string; next: (percent: number) => string; soon: (visits: number, percent: number) => string }> = {
  ro: {
    card: 'Cardul de fidelitate',
    next: (percent) => `următoarea vizită are −${percent}%`,
    soon: (visits, percent) => `încă ${visits} ${plural('ro', visits, { one: 'vizită', few: 'vizite', other: 'de vizite' })} până la −${percent}%`,
  },
  ru: {
    card: 'Карта лояльности',
    next: (percent) => `следующий визит со скидкой −${percent}%`,
    soon: (visits, percent) => `ещё ${visits} ${plural('ru', visits, { one: 'визит', few: 'визита', other: 'визитов' })} до скидки −${percent}%`,
  },
  en: {
    card: 'Loyalty card',
    next: (percent) => `your next visit is ${percent}% off`,
    soon: (visits, percent) => `${visits} more ${plural('en', visits, { one: 'visit', other: 'visits' })} to ${percent}% off`,
  },
};

function plural(locale: Locale, count: number, forms: { one: string; few?: string; other: string }): string {
  const rule = new Intl.PluralRules(locale).select(count);
  return rule === 'one' ? forms.one : rule === 'few' && forms.few ? forms.few : forms.other;
}

/** The loyalty card's next discount, e.g. "2 more visits to 15% off" (`inVisits` 1 = the next visit). */
export function loyaltyProgress(locale: Locale, reward: { percent: number; inVisits: number }): { label: string; text: string } {
  const t = LOYALTY[locale];
  return { label: t.card, text: reward.inVisits <= 1 ? t.next(reward.percent) : t.soon(reward.inVisits, reward.percent) };
}

/**
 * "Book again" for the last visit: its services, nail shape and master, straight to the times.
 * The same link as the app's own "Book again" (frontend/src/lib/appointment.ts, rebookQuery).
 */
export function rebookPath(visit: Pick<AppointmentDoc, 'services' | 'nailShape' | 'staffId'>): string {
  const params = new URLSearchParams({ services: visit.services.map((s) => s.serviceId.toHexString()).join(','), step: 'time' });
  if (visit.nailShape) params.set('shape', visit.nailShape);
  params.set('staff', visit.staffId.toHexString());
  return `/book?${params.toString()}`;
}

interface Message {
  title: string;
  body: string;
  loyalty: { label: string; text: string } | null;
  bookUrl: string;
}

function rebookPush(message: Message, locale: Locale, now: Date): PushPayload {
  const link = new URL(message.bookUrl);
  const loyalty = message.loyalty ? ` ${message.loyalty.label}: ${message.loyalty.text}.` : '';
  return {
    title: message.title,
    body: `${message.body}${loyalty}`,
    url: `${link.pathname}${link.search}`,
    // One on the device at a time: a later reminder replaces the one before.
    tag: 'rebook',
    lang: locale,
    timestamp: now.getTime(),
  };
}

const PUSH_OPTIONS = { ttlSec: 3 * 86_400, urgency: 'normal', topic: 'rebook' } as const;

function serviceNames(visit: Pick<AppointmentDoc, 'services'>, locale: Locale): string[] {
  return visit.services.map((s) => s.name[locale] || s.name.en || s.name.ro);
}

// ── When they go out ─────────────────────────────────────────────────────────

interface Plan {
  user: UserDoc;
  last: AppointmentDoc;
  step: number;
}

/**
 * Sends the reminders that are due. A client gets them only while all of this holds: a client
 * account they signed up for (not a walk-in record, a demo or a blocked account), a last completed
 * visit at least `firstAfterDays` ago, and no booking standing since that visit (a request or a
 * confirmed visit, upcoming or not yet marked done). One they cancelled or missed doesn't count:
 * they still have nothing booked. Each step goes out once per last visit, never earlier in the
 * count than one already sent, and never within `repeatEveryDays` of the one before.
 */
export async function sendRebookReminders(deps: AppDeps, now: Date, summary: TickSummary): Promise<void> {
  const settings = await getSettings(deps);
  const rebook = settings.rebook;
  if (!rebook.enabled || (!rebook.channels.email && !rebook.channels.push)) return;
  const hour = Math.floor(toZonedParts(now, settings.timezone).minutes / 60);
  if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return;

  // Visits whose reminders can still be due; the last reminder's time runs out a period after it.
  const oldest = new Date(now.getTime() - (rebook.firstAfterDays + rebook.maxReminders * rebook.repeatEveryDays) * DAY);
  const newest = new Date(now.getTime() - rebook.firstAfterDays * DAY);
  const ended = await deps.col.appointments
    .find({ status: 'completed', end: { $gt: oldest, $lte: newest } }, { projection: { clientId: 1 } })
    .toArray();
  summary.checked += ended.length;
  if (ended.length === 0) return;

  const clientIds = uniqueIds(ended.map((a) => a.clientId));
  const [users, since] = await Promise.all([
    deps.col.users
      .find({ _id: { $in: clientIds }, role: 'client', isActive: true, deletedAt: null, bookingBlocked: { $ne: true }, isDemo: { $ne: true } })
      .toArray(),
    // Everything these clients have from that window on: the last visit and whatever came after it.
    deps.col.appointments.find({ clientId: { $in: clientIds }, end: { $gt: oldest } }).toArray(),
  ]);
  const byClient = new Map<string, AppointmentDoc[]>();
  for (const appointment of since) {
    const key = appointment.clientId.toHexString();
    byClient.set(key, [...(byClient.get(key) ?? []), appointment]);
  }

  const plans: Plan[] = [];
  for (const user of users) {
    // Walk-in records (no sign-in of their own) are left to the studio.
    if (!canNotify(user) || !(user.passwordHash || user.googleId)) continue;
    const own = byClient.get(user._id.toHexString()) ?? [];
    const last = own
      .filter((a) => a.status === 'completed')
      .reduce<AppointmentDoc | null>((latest, a) => (!latest || a.end > latest.end ? a : latest), null);
    if (!last || last.end > newest) continue;
    const standing = (a: AppointmentDoc) => a.status === 'pending' || a.status === 'confirmed';
    if (own.some((a) => !a._id.equals(last._id) && a.start > last.start && standing(a))) continue;
    const step = dueStep(last.end, now, rebook);
    if (step) plans.push({ user, last, step });
  }
  if (plans.length === 0) return;

  const keys = plans.flatMap((p) => Array.from({ length: MAX_STEPS }, (_, i) => rebookKey(p.user._id, p.last._id, i + 1)));
  const logged = await deps.col.notificationLog
    .find({ _id: { $in: keys } }, { projection: { status: 1, retryAt: 1, attempts: 1, createdAt: 1 } })
    .toArray();
  const existing = new Map<string, Pick<NotificationLogDoc, 'status' | 'retryAt' | 'attempts' | 'createdAt'>>(logged.map((d) => [d._id, d]));

  const due: Plan[] = [];
  for (const plan of plans) {
    const key = rebookKey(plan.user._id, plan.last._id, plan.step);
    const previous = existing.get(key);
    const retryable =
      previous?.status === 'failed' && previous.retryAt !== null && previous.retryAt <= now && previous.attempts < MAX_ATTEMPTS;
    if (previous && !retryable) {
      summary.duplicates++;
      continue;
    }
    // The other steps of this count (a change of settings can move them): never back to an
    // earlier one, and never two within one period.
    let later = false;
    let lastSent = 0;
    for (let step = 1; step <= MAX_STEPS; step++) {
      const log = step === plan.step ? undefined : existing.get(rebookKey(plan.user._id, plan.last._id, step));
      if (!log) continue;
      if (step > plan.step) later = true;
      else if (log.status === 'sent') lastSent = Math.max(lastSent, log.createdAt.getTime());
    }
    if (later || now.getTime() - lastSent < rebook.repeatEveryDays * DAY) continue;
    due.push(plan);
  }
  if (due.length === 0) return;

  const nudged = due.filter((p) => toneOf(p.step, rebook.maxReminders) === 'nudge').map((p) => p.user._id);
  const rules = rulesFrom(settings);
  const [staff, visits] = await Promise.all([
    deps.col.staff.find({ _id: { $in: uniqueIds(due.map((p) => p.last.staffId)) } }, { projection: { name: 1 } }).toArray(),
    rules.enabled && nudged.length > 0 ? completedVisits(deps, nudged) : Promise.resolve(new Map<string, number>()),
  ]);
  const masters = new Map(staff.map((s) => [s._id.toHexString(), s.name]));

  for (const { user, last, step } of due) {
    const locale = user.locale;
    const tone = toneOf(step, rebook.maxReminders);
    const reward =
      tone === 'nudge' && rules.enabled
        ? nextReward(rules, Math.max(0, (visits.get(user._id.toHexString()) ?? 0) + (user.loyaltyBonus ?? 0)))
        : null;
    const master = masters.get(last.staffId.toHexString()) ?? null;
    const text = rebookTexts(rebook, tone, locale, {
      name: user.name.trim(),
      services: serviceNames(last, locale).join(', '),
      master: master ?? settings.name,
    });
    const message: Message = {
      ...text,
      loyalty: reward ? loyaltyProgress(locale, reward) : null,
      bookUrl: appLink(deps.config.appUrl, locale, rebookPath(last)),
    };
    const outcome = await deliver(deps, {
      key: rebookKey(user._id, last._id, step),
      kind: 'rebook',
      category: 'rebook',
      user,
      appointmentId: last._id,
      email: rebook.channels.email
        ? () =>
            rebookEmail({
              to: user.email,
              name: user.name,
              locale,
              timeZone: settings.timezone,
              now,
              title: message.title,
              body: message.body,
              visit: { end: last.end, services: serviceNames(last, locale), master },
              loyalty: message.loyalty,
              bookUrl: message.bookUrl,
              settingsUrl: appLink(deps.config.appUrl, locale, '/profile/notifications'),
              replyTo: settings.email || undefined,
            })
        : undefined,
      push: rebook.channels.push ? { payload: rebookPush(message, locale, now), options: PUSH_OPTIONS } : undefined,
    });
    if (outcome === 'duplicate') summary.duplicates++;
    else summary[outcome]++;
  }
}

function uniqueIds(ids: ObjectId[]): ObjectId[] {
  const seen = new Map(ids.map((id) => [id.toHexString(), id]));
  return [...seen.values()];
}

// ── Admin → Settings: preview and "Send me a test" ───────────────────────────

const SAMPLE_NAMES: Record<Locale, string> = { ro: 'Ana', ru: 'Анна', en: 'Ana' };

/** A visit to show: the price list's first popular service with the first master clients can book. */
async function sampleVisit(deps: AppDeps) {
  const [service, master] = await Promise.all([
    deps.col.services.findOne({ isActive: true }, { sort: { isPopular: -1, order: 1 } }),
    deps.col.staff.findOne({ isActive: true, isBookable: true }, { sort: { order: 1 } }),
  ]);
  return { service, master };
}

/**
 * The built-in texts and, per language, example values to preview them with (a real service and
 * master; the loyalty line as a client two visits from the card's first discount would see it).
 */
export async function rebookPreview(deps: AppDeps) {
  const settings = await getSettings(deps);
  const { service, master } = await sampleVisit(deps);
  const rules = rulesFrom(settings);
  const reward = rules.enabled ? rules.rewards[0] : undefined;
  return {
    defaults: REBOOK_DEFAULTS,
    placeholders: REBOOK_PLACEHOLDERS,
    /** Whether the server can send each channel at all (email provider, Web Push keys). */
    available: { email: deps.mailer.enabled, push: pushAvailable(deps) },
    sample: Object.fromEntries(
      LOCALES.map((locale) => {
        const loyalty = reward ? loyaltyProgress(locale, { percent: reward.percent, inVisits: 2 }) : null;
        return [
          locale,
          {
            name: SAMPLE_NAMES[locale],
            services: service ? service.name[locale] || service.name.ro : '',
            master: master?.name ?? settings.name,
            loyalty: loyalty ? `${loyalty.label}: ${loyalty.text}.` : null,
          },
        ];
      }),
    ) as Record<Locale, RebookValues & { loyalty: string | null }>,
  };
}

export interface RebookTestResult {
  /** The address it went to, and whether the provider took it; null when email is off or impossible. */
  email: { to: string; sent: boolean } | null;
  /** null when the studio does not send reminders in the app, or push is not set up. */
  push: { sent: number; devices: number } | null;
}

/**
 * "Send me a test": the first reminder, to the owner's own inbox and devices, as the studio sends
 * it now (saved texts and channels), whatever the owner's own notification preferences. About the
 * owner's own last visit if they ever were a client, otherwise about an example visit.
 */
export async function sendRebookTest(deps: AppDeps, owner: UserDoc): Promise<RebookTestResult> {
  const settings = await getSettings(deps);
  const rebook = settings.rebook;
  const locale = owner.locale;
  const own = await deps.col.appointments.findOne({ clientId: owner._id, status: 'completed' }, { sort: { end: -1 } });
  const now = deps.now();
  let visit: Pick<AppointmentDoc, 'services' | 'nailShape' | 'staffId' | 'end'>;
  let master: string | null;
  if (own) {
    visit = own;
    master = (await deps.col.staff.findOne({ _id: own.staffId }, { projection: { name: 1 } }))?.name ?? null;
  } else {
    const sample = await sampleVisit(deps);
    if (!sample.service || !sample.master) return { email: null, push: null };
    visit = {
      services: [
        {
          serviceId: sample.service._id,
          name: sample.service.name,
          durationMin: sample.service.durationMin,
          price: sample.service.price,
          priceFrom: sample.service.priceFrom,
        },
      ],
      nailShape: null,
      staffId: sample.master._id,
      end: new Date(now.getTime() - rebook.firstAfterDays * DAY),
    };
    master = sample.master.name;
  }
  const text = rebookTexts(rebook, 'first', locale, {
    name: owner.name.trim(),
    services: serviceNames(visit, locale).join(', '),
    master: master ?? settings.name,
  });
  const message: Message = { ...text, loyalty: null, bookUrl: appLink(deps.config.appUrl, locale, rebookPath(visit)) };

  let email: RebookTestResult['email'] = null;
  if (rebook.channels.email && deps.mailer.enabled && canEmail(owner)) {
    const mail = rebookEmail({
      to: owner.email,
      name: owner.name,
      locale,
      timeZone: settings.timezone,
      now,
      title: message.title,
      body: message.body,
      visit: { end: visit.end, services: serviceNames(visit, locale), master },
      loyalty: null,
      bookUrl: message.bookUrl,
      settingsUrl: appLink(deps.config.appUrl, locale, '/profile/notifications'),
      replyTo: settings.email || undefined,
    });
    try {
      await deps.mailer.send(mail);
      email = { to: owner.email, sent: true };
    } catch (error) {
      console.error('[notify] rebook test email failed', error);
      email = { to: owner.email, sent: false };
    }
  }
  const push =
    rebook.channels.push && pushAvailable(deps) ? await sendPushToUser(deps, owner._id, rebookPush(message, locale, now), PUSH_OPTIONS) : null;
  return { email, push: push ? { sent: push.sent, devices: push.devices } : null };
}
