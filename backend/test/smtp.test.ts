import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { createMailer, MailError } from '../src/lib/mailer';

const smtp = vi.hoisted(() => ({ options: [] as unknown[], sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options: unknown) => {
      smtp.options.push(options);
      return { sendMail: smtp.sendMail };
    },
  },
}));

const baseEnv = {
  APP_ENV: 'test',
  DATABASE_URL: 'postgres://nba:nba@127.0.0.1:5432/nba',
  JWT_SECRET: 'x'.repeat(48),
};
const gmailEnv = {
  ...baseEnv,
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_USER: 'studio@gmail.com',
  SMTP_PASSWORD: 'abcd efgh ijkl mnop',
  MAIL_FROM: 'Nails by Alynna <studio@gmail.com>',
};

beforeEach(() => {
  smtp.options.length = 0;
  smtp.sendMail.mockReset();
});

describe('email through SMTP (the studio Gmail)', () => {
  it('wins over EmailJS when set, and drops the spaces Google shows in App passwords', () => {
    const config = loadConfig({ ...gmailEnv, EMAILJS_SERVICE_ID: 's', EMAILJS_TEMPLATE_ID: 't', EMAILJS_PUBLIC_KEY: 'p' });
    expect(config.mail).toEqual({
      provider: 'smtp',
      host: 'smtp.gmail.com',
      port: 465,
      user: 'studio@gmail.com',
      password: 'abcdefghijklmnop',
      from: 'Nails by Alynna <studio@gmail.com>',
    });
    expect(() => loadConfig({ ...baseEnv, SMTP_HOST: 'smtp.gmail.com' })).toThrow(/SMTP_HOST, SMTP_USER and SMTP_PASSWORD/);
  });

  it('sends one message with both parts, the recipient name and the reply address', async () => {
    smtp.sendMail.mockResolvedValue({ messageId: '<1@gmail.com>' });
    const mailer = createMailer(loadConfig(gmailEnv));
    await mailer.send({ to: 'ana@gmail.com', toName: 'Ana', subject: 'Codul 123456', html: '<p>Salut</p>', text: 'Salut', replyTo: 'studio@gmail.com' });

    expect(smtp.options).toEqual([
      expect.objectContaining({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'studio@gmail.com', pass: 'abcdefghijklmnop' } }),
    ]);
    expect(smtp.sendMail).toHaveBeenCalledWith({
      from: 'Nails by Alynna <studio@gmail.com>',
      to: { name: 'Ana', address: 'ana@gmail.com' },
      subject: 'Codul 123456',
      text: 'Salut',
      html: '<p>Salut</p>',
      replyTo: 'studio@gmail.com',
    });
  });

  it('treats a refused login as a setup problem and a busy server as temporary', async () => {
    const mailer = createMailer(loadConfig(gmailEnv));
    smtp.sendMail.mockRejectedValueOnce(Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), { responseCode: 535 }));
    const refused = await mailer.send({ to: 'ana@gmail.com', subject: 's', html: 'h', text: 't' }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(MailError);
    expect(refused).toMatchObject({ status: 535, transient: false });
    expect((refused as MailError).message).toContain('Username and Password not accepted');
    // Code requests now say "email is not working" instead of pretending.
    expect(mailer.working?.()).toBe(false);

    smtp.sendMail.mockRejectedValueOnce(Object.assign(new Error('421 Try again later'), { responseCode: 421 }));
    const busy = await mailer.send({ to: 'ana@gmail.com', subject: 's', html: 'h', text: 't' }).catch((e: unknown) => e);
    expect(busy).toMatchObject({ status: 421, transient: true });

    smtp.sendMail.mockRejectedValueOnce(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }));
    const offline = await mailer.send({ to: 'ana@gmail.com', subject: 's', html: 'h', text: 't' }).catch((e: unknown) => e);
    expect(offline).toMatchObject({ status: 0, transient: true });
  });
});
