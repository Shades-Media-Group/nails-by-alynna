import { PKPass } from 'passkit-generator';
import type { AppleWalletConfig } from '../../config';
import { WALLET_COPY } from './copy';
import { PASS_IMAGES } from './images';
import { groupedCode, type CardSnapshot } from './service';

/** The app's colours: blush field, ink text, rose labels (frontend/src/styles/index.css). */
const COLORS = {
  backgroundColor: 'rgb(253, 231, 252)',
  foregroundColor: 'rgb(37, 39, 38)',
  labelColor: 'rgb(184, 12, 77)',
};

const IMAGES = Object.fromEntries(Object.entries(PASS_IMAGES).map(([name, data]) => [name, Buffer.from(data, 'base64')]));

/**
 * The client's loyalty card as a signed .pkpass, a store card: the stamps up top (they show
 * while the pass sits in the stack), the name, the next discount, the member QR code, and the
 * studio's details and the card's rules on the back.
 */
export function applePass(config: AppleWalletConfig, card: CardSnapshot): Buffer {
  const t = WALLET_COPY[card.locale];
  const { loyalty } = card;
  const next = loyalty.enabled ? loyalty.nextReward : null;
  const back = [
    loyalty.enabled ? { key: 'how', label: t.how, value: t.howText(loyalty) } : null,
    card.studio.address ? { key: 'address', label: t.address, value: card.studio.address } : null,
    card.studio.phone ? { key: 'phone', label: t.phone, value: card.studio.phone } : null,
    { key: 'app', label: t.app, value: card.appUrl },
    {
      key: 'updated',
      label: t.updated,
      value: card.at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      dateStyle: 'PKDateStyleMedium',
      timeStyle: 'PKDateStyleNone',
    },
  ];
  const passJson = {
    formatVersion: 1,
    passTypeIdentifier: config.passTypeId,
    teamIdentifier: config.teamId,
    serialNumber: card.serialNumber,
    organizationName: card.studio.name,
    description: t.description(card.studio.name),
    logoText: card.studio.name,
    ...COLORS,
    sharingProhibited: true,
    // Live updates (a later step) go here: webServiceURL (the PassKit web service, e.g.
    // <APP_URL>/api/wallet/apple/v1) and authenticationToken (from walletPasses). Wallet then
    // registers each device there, and an APNs push tells it to fetch the new pass.
    storeCard: {
      headerFields: loyalty.enabled ? [{ key: 'stamps', label: t.stamps, value: `${loyalty.stamps}/${loyalty.cycle}` }] : [],
      primaryFields: [{ key: 'member', label: t.member, value: card.name }],
      secondaryFields: next ? [{ key: 'next', label: t.next, value: t.nextValue(next) }] : [],
      backFields: back.filter(Boolean),
    },
    barcodes: [
      { format: 'PKBarcodeFormatQR', message: card.cardUrl, messageEncoding: 'iso-8859-1', altText: groupedCode(card.memberCode) },
    ],
  };
  const pass = new PKPass(
    { ...IMAGES, 'pass.json': Buffer.from(JSON.stringify(passJson)) },
    { wwdr: config.wwdr, signerCert: config.signerCert, signerKey: config.signerKey },
  );
  return pass.getAsBuffer();
}
