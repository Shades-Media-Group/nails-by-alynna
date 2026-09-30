import type { ObjectId } from 'bson';
import type { AppDeps } from '../../context';
import type { AppointmentDoc } from '../../db/types';
import { buildEventObject, type EventContext } from './feed';
import { CalendarError, calendarFetch, passingFailure } from './http';

/*
 * iCloud Calendar over CalDAV (RFC 4791), for a master's Apple ID and an app-specific password
 * (Apple takes no other password here). The account's calendars are found from
 * caldav.icloud.com (current-user-principal, then calendar-home-set), the studio's calendar is
 * made there once (MKCALENDAR), and each booking is one calendar object in it, named after the
 * booking's id: writing a booking again replaces it, and cancelling it deletes it.
 *
 * The credentials go to Apple's servers only: every address, including the ones iCloud answers
 * with or redirects to, must be https on icloud.com.
 */

export const ICLOUD_CALDAV = 'https://caldav.icloud.com/';

export interface AppleAccount {
  appleId: string;
  password: string;
}

const isIcloud = (url: URL) => url.protocol === 'https:' && (url.hostname === 'icloud.com' || url.hostname.endsWith('.icloud.com'));

const REDIRECTS = new Set([301, 302, 307, 308]);

/** One WebDAV request, following iCloud's redirects to its per-account servers itself. */
async function dav(
  deps: AppDeps,
  account: AppleAccount,
  method: string,
  address: string | URL,
  opts: { depth?: '0' | '1'; body?: string; contentType?: string } = {},
): Promise<{ response: Response; url: URL }> {
  let url = new URL(address);
  for (let hop = 0; hop < 4; hop++) {
    if (!isIcloud(url)) throw new CalendarError('rejected', 'iCloud pointed to a server that is not iCloud');
    const response = await calendarFetch(
      deps,
      url,
      {
        method,
        redirect: 'manual',
        headers: {
          Authorization: `Basic ${Buffer.from(`${account.appleId}:${account.password}`, 'utf8').toString('base64')}`,
          ...(opts.depth ? { Depth: opts.depth } : {}),
          ...(opts.body !== undefined ? { 'Content-Type': opts.contentType ?? 'application/xml; charset=utf-8' } : {}),
        },
        body: opts.body,
      },
      'iCloud',
    );
    const location = response.headers.get('location');
    if (REDIRECTS.has(response.status) && location) {
      url = new URL(location, url);
      continue;
    }
    if (response.status === 401) throw new CalendarError('auth', 'iCloud did not accept the Apple ID and app-specific password');
    const passing = passingFailure(response, deps.now(), 'iCloud');
    if (passing) throw passing;
    return { response, url };
  }
  throw new CalendarError('retry', 'iCloud redirected too many times');
}

// ── Just enough XML: iCloud answers in namespaced WebDAV multistatus ────────────────────

const PREFIX = '(?:[\\w.-]+:)?';

/** The contents of every <name> element (any namespace prefix); '' for empty ones. */
function elements(xml: string, name: string): string[] {
  const pattern = new RegExp(`<${PREFIX}${name}(?=[\\s/>])[^>]*?(?:/>|>([\\s\\S]*?)</${PREFIX}${name}\\s*>)`, 'gi');
  return [...xml.matchAll(pattern)].map((match) => match[1] ?? '');
}

const decodeXml = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The href inside the first <name> element, as an address (relative ones against `base`). */
function hrefIn(xml: string, name: string, base: URL): URL | null {
  const inner = elements(xml, name)[0];
  const href = inner === undefined ? undefined : elements(inner, 'href')[0];
  return href ? new URL(decodeXml(href.trim()), base) : null;
}

const propfind = (props: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>${props}</d:prop></d:propfind>`;

async function multistatus(deps: AppDeps, account: AppleAccount, address: string | URL, depth: '0' | '1', props: string) {
  const { response, url } = await dav(deps, account, 'PROPFIND', address, { depth, body: propfind(props) });
  if (response.status === 404) throw new CalendarError('gone', 'iCloud has no such calendar');
  if (response.status !== 207) throw new CalendarError('retry', `iCloud answered ${response.status}`);
  return { xml: await response.text(), url };
}

const withSlash = (url: URL) => (url.pathname.endsWith('/') ? url : new URL(`${url.pathname}/`, url));
const samePath = (a: string, b: string) => withSlash(new URL(a)).pathname === withSlash(new URL(b)).pathname;

/**
 * Where the account keeps its calendars. Also the check that the Apple ID and password work:
 * wrong ones end in CalendarError 'auth'.
 */
export async function findCalendarHome(deps: AppDeps, account: AppleAccount): Promise<string> {
  const root = await multistatus(deps, account, ICLOUD_CALDAV, '0', '<d:current-user-principal/>');
  const principal = hrefIn(root.xml, 'current-user-principal', root.url);
  if (!principal) throw new CalendarError('retry', 'iCloud did not say where the account is');
  const found = await multistatus(deps, account, principal, '0', '<c:calendar-home-set/>');
  const home = hrefIn(found.xml, 'calendar-home-set', found.url);
  if (!home || !isIcloud(home)) throw new CalendarError('retry', 'iCloud did not say where the calendars are');
  return withSlash(home).toString();
}

/**
 * The studio's calendar in the account: the one made before (`known`), else one with the
 * studio's name, else a new one. Its address.
 */
export async function ensureAppleCalendar(deps: AppDeps, account: AppleAccount, home: string, name: string, known: string | null): Promise<string> {
  const listing = await multistatus(deps, account, home, '1', '<d:displayname/><d:resourcetype/>');
  const calendars = elements(listing.xml, 'response').flatMap((response) => {
    const href = elements(response, 'href')[0];
    const type = elements(response, 'resourcetype')[0] ?? '';
    if (!href || !new RegExp(`<${PREFIX}calendar(?=[\\s/>])`, 'i').test(type)) return [];
    return [{ url: withSlash(new URL(decodeXml(href.trim()), listing.url)).toString(), name: decodeXml(elements(response, 'displayname')[0]?.trim() ?? '') }];
  });
  const kept = (known && calendars.find((c) => samePath(c.url, known))) || calendars.find((c) => c.name === name);
  if (kept) return kept.url;

  const address = new URL(`${crypto.randomUUID().toUpperCase()}/`, withSlash(new URL(home)));
  const body = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">',
    '<d:set><d:prop>',
    `<d:displayname>${escapeXml(name)}</d:displayname>`,
    '<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>',
    '<a:calendar-color>#FF69B4FF</a:calendar-color>',
    '</d:prop></d:set>',
    '</c:mkcalendar>',
  ].join('\n');
  const { response, url } = await dav(deps, account, 'MKCALENDAR', address, { body });
  if (response.status !== 201 && response.status !== 200) throw new CalendarError('rejected', `iCloud refused to make the calendar (${response.status})`);
  return withSlash(url).toString();
}

const eventAddress = (calendarUrl: string, appointmentId: ObjectId) => new URL(`${appointmentId.toHexString()}.ics`, withSlash(new URL(calendarUrl)));

/** Writes a booking's event (made or replaced). A calendar that is not there any more is 'gone'. */
export async function putAppleEvent(deps: AppDeps, account: AppleAccount, calendarUrl: string, a: AppointmentDoc, ctx: EventContext): Promise<void> {
  const { response } = await dav(deps, account, 'PUT', eventAddress(calendarUrl, a._id), {
    body: buildEventObject(a, ctx),
    contentType: 'text/calendar; charset=utf-8',
  });
  if (response.ok) return;
  // No such collection: 404, or 409 (RFC 4918: the parent is missing).
  if (response.status === 404 || response.status === 409) throw new CalendarError('gone', 'The iCloud calendar is not there any more');
  throw new CalendarError('rejected', `iCloud refused the event (${response.status})`);
}

/** Removes a booking's event (already removed is fine). */
export async function deleteAppleEvent(deps: AppDeps, account: AppleAccount, calendarUrl: string, appointmentId: ObjectId): Promise<void> {
  const { response } = await dav(deps, account, 'DELETE', eventAddress(calendarUrl, appointmentId));
  if (!response.ok && response.status !== 404) throw new CalendarError('rejected', `iCloud refused to remove the event (${response.status})`);
}

/** Deletes the studio's calendar with everything in it (already gone is fine). */
export async function deleteAppleCalendar(deps: AppDeps, account: AppleAccount, calendarUrl: string): Promise<void> {
  const { response } = await dav(deps, account, 'DELETE', withSlash(new URL(calendarUrl)));
  if (!response.ok && response.status !== 404) throw new CalendarError('rejected', `iCloud refused to delete the calendar (${response.status})`);
}
