import type { AppConfig } from '../config';
import { base64UrlEncode } from './crypto';

/*
 * Credentials the server keeps for masters' connected calendars (a Google refresh token, an
 * Apple app-specific password), sealed with AES-256-GCM before they reach the database. The key
 * is derived with HKDF-SHA-256 from CALENDAR_SYNC_KEY, or from JWT_SECRET when that is not set.
 * Each sealed value names the key it was sealed with, so values sealed under an older secret
 * (JWT_SECRET_PREVIOUS after a rotation) still open. The caller's `context` (the connection's
 * id) is bound in as additional data: a value copied onto another row does not open there.
 *
 * Format: v1.<key id>.<12-byte IV>.<ciphertext and tag>, all base64url.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VERSION = 'v1';

interface SealKey {
  id: string;
  key: Awaited<ReturnType<typeof crypto.subtle.deriveKey>>;
}

const derived = new WeakMap<Uint8Array, Promise<SealKey>>();

function deriveKey(secret: Uint8Array): Promise<SealKey> {
  let key = derived.get(secret);
  if (!key) {
    key = (async () => {
      const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits', 'deriveKey']);
      const salt = encoder.encode('nails-by-alynna');
      const aes = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('calendar-credentials-v1') },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      // A short name for the key, derived apart from it: says which secret sealed a value.
      const id = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('calendar-credentials-id-v1') }, base, 48);
      return { id: base64UrlEncode(new Uint8Array(id)), key: aes };
    })();
    derived.set(secret, key);
  }
  return key;
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Seals `plaintext` with the newest key, bound to `context`. */
export async function sealSecret(config: Pick<AppConfig, 'credentialSecrets'>, plaintext: string, context: string): Promise<string> {
  const secret = config.credentialSecrets[0];
  if (!secret) throw new Error('No key to seal calendar credentials with');
  const { id, key } = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, key, encoder.encode(plaintext));
  return [VERSION, id, base64UrlEncode(iv), base64UrlEncode(new Uint8Array(sealed))].join('.');
}

/** The plaintext, or null when no key opens it (another secret, another context, tampered). */
export async function openSecret(config: Pick<AppConfig, 'credentialSecrets'>, sealed: string, context: string): Promise<string | null> {
  const [version, id, ivText, dataText, ...rest] = sealed.split('.');
  if (version !== VERSION || !id || !ivText || !dataText || rest.length > 0) return null;
  const iv = base64UrlDecode(ivText);
  const data = base64UrlDecode(dataText);
  if (!iv || iv.length !== 12 || !data) return null;
  for (const secret of config.credentialSecrets) {
    const candidate = await deriveKey(secret);
    if (candidate.id !== id) continue;
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, candidate.key, data);
      return decoder.decode(plain);
    } catch {
      return null;
    }
  }
  return null;
}
