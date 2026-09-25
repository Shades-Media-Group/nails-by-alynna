import type { AppDeps } from '../../context';
import type { UserDoc } from '../../db/types';
import { loyaltyNextEmail, welcomeEmail } from '../../lib/emails';
import { getSettings } from '../settings';
import { deliver, type DeliveryOutcome } from './deliver';

const PUSH_COPY = {
  loyalty: {
    ro: (percent: number) => ({ title: `Următoarea vizită: −${percent}%`, body: 'Cardul de fidelitate a ajuns la reducere. Te așteptăm!' }),
    ru: (percent: number) => ({ title: `Следующий визит: −${percent}%`, body: 'На карте лояльности набралась скидка. Ждём вас!' }),
    en: (percent: number) => ({ title: `Your next visit: ${percent}% off`, body: 'Your loyalty card has reached a discount. See you soon!' }),
  },
} as const;

const localeSegment = (locale: UserDoc['locale']) => (locale === 'ro' ? '' : `/${locale}`);

/**
 * The welcome email, once per account, when it is ready to use (email confirmed, first Google
 * sign-in, or a walk-in claiming their account). Never throws.
 */
export async function notifyWelcome(deps: AppDeps, user: UserDoc): Promise<DeliveryOutcome> {
  try {
    const settings = await getSettings(deps);
    const rewards = settings.loyaltyEnabled ? settings.loyaltyRewards : [];
    return await deliver(deps, {
      key: `welcome:${user._id.toHexString()}`,
      kind: 'custom',
      // Transactional: sent with the account, under the always-on booking messages.
      category: 'bookingUpdates',
      user,
      email: () =>
        welcomeEmail({
          to: user.email,
          name: user.name,
          locale: user.locale,
          appUrl: deps.config.appUrl,
          rewards,
          replyTo: settings.email || undefined,
        }),
    });
  } catch (error) {
    console.error('[notify] welcome failed', error);
    return 'failed';
  }
}

/** After a completed visit, when the client's next visit carries a loyalty discount. */
export async function notifyLoyaltyNext(deps: AppDeps, user: UserDoc, opts: { percent: number; visits: number }): Promise<DeliveryOutcome> {
  try {
    const copy = PUSH_COPY.loyalty[user.locale](opts.percent);
    return await deliver(deps, {
      key: `loyalty-next:${user._id.toHexString()}:${opts.visits}`,
      kind: 'custom',
      category: 'loyalty',
      user,
      email: () => loyaltyNextEmail({ to: user.email, name: user.name, locale: user.locale, appUrl: deps.config.appUrl, percent: opts.percent }),
      push: {
        payload: { ...copy, url: `${localeSegment(user.locale)}/loyalty`, tag: 'loyalty' },
        options: { ttlSec: 3 * 86_400, urgency: 'normal' },
      },
    });
  } catch (error) {
    console.error('[notify] loyalty failed', error);
    return 'failed';
  }
}
