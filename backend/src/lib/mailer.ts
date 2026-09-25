import type { AppConfig } from '../config';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  readonly enabled: boolean;
  send(message: MailMessage): Promise<void>;
}

/** Sends through Resend's HTTP API when configured; otherwise logs (never in production). */
export function createMailer(config: AppConfig): Mailer {
  const mail = config.mail;
  if (!mail) {
    return {
      enabled: false,
      async send(message) {
        if (config.isProd) {
          console.warn('[mail] RESEND_API_KEY/MAIL_FROM not configured; email not sent');
          return;
        }
        if (config.env !== 'test') {
          console.info(`[mail:dev] to=${message.to} subject="${message.subject}"\n${message.text}`);
        }
      },
    };
  }

  return {
    enabled: true,
    async send(message) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${mail.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: mail.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Resend responded ${response.status}: ${body.slice(0, 200)}`);
      }
    },
  };
}
