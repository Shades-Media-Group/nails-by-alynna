import { EncryptJWT, SignJWT, jwtDecrypt, jwtVerify } from 'jose';
import type { AppConfig, Role } from '../config';

/**
 * Short-lived access tokens (HS256 JWT in an httpOnly cookie). Verification pins the
 * algorithm, issuer and audience, and accepts the previous secret during key rotation.
 */

export interface AccessClaims {
  sub: string;
  sid: string;
  role: Role;
  tv: number;
}

const ROLES: readonly Role[] = ['client', 'admin', 'administrator'];

export async function signAccessToken(
  config: AppConfig,
  claims: AccessClaims,
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ sid: claims.sid, role: claims.role, tv: claims.tv })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(config.jwt.issuer)
    .setAudience(config.jwt.audience)
    .setIssuedAt(iat)
    .setExpirationTime(iat + config.jwt.accessTtlSec)
    .sign(config.jwt.secret);
}

export async function verifyAccessToken(
  config: AppConfig,
  token: string,
  now: Date = new Date(),
): Promise<AccessClaims | null> {
  const keys = [config.jwt.secret, config.jwt.previousSecret].filter(
    (k): k is Uint8Array => k instanceof Uint8Array,
  );
  for (const key of keys) {
    try {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ['HS256'],
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
        clockTolerance: 5,
        currentDate: now,
      });
      const { sub, sid, role, tv } = payload as Record<string, unknown>;
      if (
        typeof sub !== 'string' ||
        typeof sid !== 'string' ||
        typeof tv !== 'number' ||
        !ROLES.includes(role as Role)
      ) {
        return null;
      }
      return { sub, sid, role: role as Role, tv };
    } catch (error) {
      const code = (error as { code?: string }).code;
      // Only a signature mismatch may be retried with the previous key.
      if (code !== 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') return null;
    }
  }
  return null;
}

/** 256-bit key for short-lived encrypted state (OAuth), derived from the JWT secret. */
async function stateKey(config: AppConfig): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', config.jwt.secret, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('nails-by-alynna'),
      info: new TextEncoder().encode('oauth-state-v1'),
    },
    base,
    256,
  );
  return new Uint8Array(bits);
}

/** Encrypts (A256GCM) a small payload for an httpOnly cookie, e.g. OAuth state + PKCE verifier. */
export async function sealState(
  config: AppConfig,
  payload: Record<string, unknown>,
  ttlSec: number,
): Promise<string> {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuer(config.jwt.issuer)
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .encrypt(await stateKey(config));
}

export async function openState(
  config: AppConfig,
  token: string,
): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtDecrypt(token, await stateKey(config), {
      issuer: config.jwt.issuer,
      keyManagementAlgorithms: ['dir'],
      contentEncryptionAlgorithms: ['A256GCM'],
    });
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}
