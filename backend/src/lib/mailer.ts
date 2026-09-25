import type { AppConfig, MailConfig } from '../config';
import { isPlaceholderEmail } from './placeholder-email';

export interface MailMessage {
  to: string;
  /** Recipient's name, for the greeting line of providers that show it ({{to_name}} in EmailJS). */
  toName?: string;
  subject: string;
  html: string;
  text: string;
  /** Where replies go (the studio's contact email), when there is one. */
  replyTo?: string;
}

export interface Mailer {
  readonly enabled: boolean;
  send(message: MailMessage): Promise<void>;
}

/** A provider refused or failed to take the message. Carries the provider's answer, never the email. */
export class MailError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(provider: string, status: number, body: string) {
    super(`${provider} responded ${status}: ${body}`);
    this.name = 'MailError';
    this.status = status;
    this.body = body;
  }

  /** Worth trying again later (rate limit, provider hiccup, network). */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';
const TIMEOUT_MS = 10_000;
/** EmailJS accepts one request per second; sends queue up behind each other. */
const EMAILJS_GAP_MS = 1_100;

/**
 * Addresses that can never receive mail: walk-in placeholders, anonymised accounts and the
 * reserved test domains (RFC 2606 / 6761). Real providers skip them so demo data and tests
 * never spend the monthly quota.
 */
export function isUndeliverableAddress(email: string): boolean {
  const domain = email.toLowerCase().split('@')[1] ?? '';
  if (!domain || isPlaceholderEmail(email)) return true;
  if (/\.(invalid|test|example|localhost|local)$/.test(domain) || ['invalid', 'test', 'example', 'localhost', 'local'].includes(domain)) {
    return true;
  }
  return /^(.+\.)?example\.(com|net|org)$/.test(domain);
}

/**
 * EmailJS (preferred) or Resend when configured; otherwise development logs the message and
 * production drops it with a warning. Errors throw a MailError with the provider's status.
 */
export function createMailer(config: AppConfig): Mailer {
  const mail = config.mail;
  if (!mail) {
    return {
      enabled: false,
      async send(message) {
        if (config.isProd) {
          console.warn('[mail] no email provider configured (EMAILJS_* or RESEND_API_KEY/MAIL_FROM); email not sent');
          return;
        }
        if (config.env !== 'test') {
          console.info(`[mail:dev] to=${message.to} subject="${message.subject}"\n${message.text}`);
        }
      },
    };
  }

  const transport = mail.provider === 'emailjs' ? emailJsTransport(mail) : resendTransport(mail);
  const development = config.env === 'development';
  return {
    enabled: true,
    async send(message) {
      if (isUndeliverableAddress(message.to)) {
        if (development) console.info(`[mail] skipped undeliverable address ${message.to}`);
        return;
      }
      try {
        await transport(message);
      } catch (error) {
        // Development only: show what would have gone out, so a provider still being set up
        // (e.g. EmailJS answering 403) never blocks signing up locally.
        if (development) {
          console.info(`[mail:dev] NOT delivered (${(error as Error).message}) to=${message.to} subject="${message.subject}"\n${message.text}`);
        }
        throw error;
      }
    },
  };
}

type Transport = (message: MailMessage) => Promise<void>;

async function post(provider: string, url: string, init: RequestInit): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const reason = (error as Error).name === 'TimeoutError' ? 'timed out after 10 s' : (error as Error).message;
    throw new MailError(provider, 0, reason);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new MailError(provider, response.status, body.slice(0, 300));
  }
}

/**
 * EmailJS REST API. The template in the EmailJS dashboard must use {{subject}}, {{to_email}},
 * {{reply_to}} and {{{html}}} (triple braces: raw HTML). Server calls need "Allow EmailJS API
 * for non-browser applications" (Account → Security), otherwise EmailJS answers 403.
 */
function emailJsTransport(mail: Extract<MailConfig, { provider: 'emailjs' }>): Transport {
  let queue: Promise<unknown> = Promise.resolve();
  let nextSlot = 0;

  const sendOnce = (message: MailMessage) =>
    post('EmailJS', EMAILJS_ENDPOINT, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: mail.serviceId,
        template_id: mail.templateId,
        user_id: mail.publicKey,
        ...(mail.privateKey ? { accessToken: mail.privateKey } : {}),
        template_params: {
          to_email: message.to,
          to_name: message.toName ?? '',
          subject: message.subject,
          html: message.html,
          text: message.text,
          reply_to: message.replyTo ?? '',
        },
      }),
    });

  return (message) => {
    const run = queue.then(async () => {
      const wait = nextSlot - Date.now();
      if (wait > 0) await sleep(wait);
      nextSlot = Date.now() + EMAILJS_GAP_MS;
      try {
        await sendOnce(message);
      } catch (error) {
        // One more try after a pause when EmailJS asks us to slow down.
        if (!(error instanceof MailError) || error.status !== 429) throw error;
        await sleep(1_500);
        nextSlot = Date.now() + EMAILJS_GAP_MS;
        await sendOnce(message);
      }
    });
    queue = run.catch(() => undefined);
    return run;
  };
}

function resendTransport(mail: Extract<MailConfig, { provider: 'resend' }>): Transport {
  return (message) =>
    post('Resend', 'https://api.resend.com/emails', {
      headers: { Authorization: `Bearer ${mail.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: mail.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
