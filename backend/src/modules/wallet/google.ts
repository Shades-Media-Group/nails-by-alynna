import { SignJWT } from 'jose';
import type { GoogleWalletConfig } from '../../config';
import { WALLET_COPY } from './copy';
import { groupedCode, type CardSnapshot } from './service';

/** The studio's one loyalty program: the class every client's card belongs to. */
export const LOYALTY_CLASS_SUFFIX = 'loyalty';

/**
 * An "Add to Google Wallet" link: a JWT signed with the service account's key (RS256) that
 * carries the program (a LoyaltyClass, created by Google on the first save) and this client's
 * card (a LoyaltyObject). Google advises keeping the link under 1,800 characters, so the pass
 * holds only what it shows. A saved card is not updated by later links: that takes the REST API.
 */
export async function googleSaveUrl(config: GoogleWalletConfig, card: CardSnapshot, origin: string): Promise<string> {
  const t = WALLET_COPY[card.locale];
  const classId = `${config.issuerId}.${LOYALTY_CLASS_SUFFIX}`;
  const loyaltyClass = {
    id: classId,
    issuerName: card.studio.name,
    programName: WALLET_COPY.ro.card,
    localizedProgramName: {
      defaultValue: { language: 'ro', value: WALLET_COPY.ro.card },
      translatedValues: [
        { language: 'ru', value: WALLET_COPY.ru.card },
        { language: 'en', value: WALLET_COPY.en.card },
      ],
    },
    // Served by the web app (frontend/scripts/brand-assets.mjs); Google fetches it once.
    programLogo: { sourceUri: { uri: `${card.appUrl}/wallet/logo.png` } },
    hexBackgroundColor: '#fde7fc',
    reviewStatus: 'UNDER_REVIEW',
  };
  const loyaltyObject = {
    id: `${config.issuerId}.${card.serialNumber}`,
    classId,
    state: 'ACTIVE',
    accountName: card.name,
    ...(card.loyalty.enabled
      ? { loyaltyPoints: { label: t.stamps, balance: { string: `${card.loyalty.stamps}/${card.loyalty.cycle}` } } }
      : {}),
    barcode: { type: 'QR_CODE', value: card.cardUrl, alternateText: groupedCode(card.memberCode) },
  };
  const jwt = await new SignJWT({
    typ: 'savetowallet',
    origins: [origin],
    payload: { loyaltyClasses: [loyaltyClass], loyaltyObjects: [loyaltyObject] },
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(config.serviceAccountEmail)
    .setAudience('google')
    .setIssuedAt(Math.floor(card.at.getTime() / 1000))
    .sign(config.privateKey);
  return `https://pay.google.com/gp/v/save/${jwt}`;
}
