import { Hono, type Context } from 'hono';
import type { AppDeps, AppEnv } from '../../context';
import type { UserDoc } from '../../db/types';
import { AppError } from '../../lib/errors';
import { enforceRateLimits } from '../../lib/rate-limit';
import { requireAuth, requireRole } from '../../middleware/auth';
import { applePass } from './apple';
import { googleSaveUrl } from './google';
import { applePassPath, cardSnapshot, markIssued, verifyPassToken, walletStatus } from './service';

const unavailable = () => new AppError(404, 'WALLET_UNAVAILABLE', 'This Wallet is not set up yet');

/**
 * /api/wallet — the signed-in client's loyalty card in Apple Wallet or Google Wallet.
 *   GET /                   which Wallets are set up: { apple, google }
 *   GET /apple              the .pkpass file (session cookie)
 *   GET /apple/link         { url } of the same file behind a short-lived signed link
 *   GET /apple/pass/:file   the file from that link, no cookie needed
 *   GET /google             { url } of the "Add to Google Wallet" link
 */
export function walletRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  const signedIn = requireAuth(deps);
  const client = requireRole('client');

  // Signing a pass takes real work; nobody needs more than a few an hour.
  const limit = (user: UserDoc) =>
    enforceRateLimits(deps, [{ key: `wallet:user:${user._id.toHexString()}`, limit: 60, windowSec: 3600 }]);

  async function sendApplePass(c: Context<AppEnv>, user: UserDoc) {
    const apple = deps.config.wallet.apple;
    if (!apple || !walletStatus(deps).apple) throw unavailable();
    await limit(user);
    const file = applePass(apple, await cardSnapshot(deps, user));
    await markIssued(deps, user._id, 'apple');
    // "attachment" with this type is what makes Safari offer "Add to Apple Wallet".
    return c.body(new Uint8Array(file), 200, {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': 'attachment; filename="nails-by-alynna.pkpass"',
      'Cache-Control': 'private, no-store',
    });
  }

  app.get('/', signedIn, (c) => c.json(walletStatus(deps)));

  app.get('/apple', signedIn, client, (c) => sendApplePass(c, c.get('user')));

  app.get('/apple/link', signedIn, client, async (c) => {
    if (!walletStatus(deps).apple) throw unavailable();
    return c.json({ url: await applePassPath(deps, c.get('user')._id) });
  });

  app.get('/apple/pass/:file', async (c) => {
    const id = await verifyPassToken(deps, c.req.param('file').replace(/\.pkpass$/, ''));
    const user = id ? await deps.col.users.findOne({ _id: id, role: 'client', isActive: true, deletedAt: null }) : null;
    if (!user) throw new AppError(404, 'NOT_FOUND', 'Pass not found');
    return sendApplePass(c, user);
  });

  app.get('/google', signedIn, client, async (c) => {
    const google = deps.config.wallet.google;
    if (!google) throw unavailable();
    const user = c.get('user');
    await limit(user);
    const url = await googleSaveUrl(google, await cardSnapshot(deps, user), new URL(deps.config.appUrl).origin);
    await markIssued(deps, user._id, 'google');
    return c.json({ url });
  });

  return app;
}
