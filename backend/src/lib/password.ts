import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt from `node:crypto` (memory-hard, OWASP-recommended parameters).
 *
 * Stored format: scrypt$N$r$p$<salt b64>$<hash b64> — self-describing, so parameters
 * can be raised later and old hashes transparently upgraded on the next login.
 */

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

// OWASP Password Storage Cheat Sheet: N=2^15, r=8, p=3 (≈32 MiB, equivalent to N=2^17,p=1).
const STANDARD: ScryptParams = { N: 2 ** 15, r: 8, p: 3 };
// Test-only parameters (rejected by config in production).
const FAST: ScryptParams = { N: 2 ** 10, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function derive(password: string, salt: Buffer, { N, r, p }: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { N, r, p, maxmem: 256 * N * r },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<{ ok: boolean; needsRehash: boolean }>;
  /** Spend the same time as a real verification (prevents user enumeration by timing). */
  burn(): Promise<void>;
}

export function createPasswordHasher(cost: 'standard' | 'fast'): PasswordHasher {
  const params = cost === 'fast' ? FAST : STANDARD;
  const burnSalt = randomBytes(SALT_LENGTH);

  return {
    async hash(password) {
      const salt = randomBytes(SALT_LENGTH);
      const key = await derive(password, salt, params);
      return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$');
    },

    async verify(password, stored) {
      const parts = stored.split('$');
      if (parts.length !== 6 || parts[0] !== 'scrypt') return { ok: false, needsRehash: false };
      const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
      const validParams =
        Number.isInteger(N) && Number.isInteger(r) && Number.isInteger(p) &&
        N >= 2 ** 10 && N <= 2 ** 17 && (N & (N - 1)) === 0 && r >= 1 && r <= 16 && p >= 1 && p <= 16;
      if (!validParams) return { ok: false, needsRehash: false };

      const salt = Buffer.from(parts[4] ?? '', 'base64');
      const expected = Buffer.from(parts[5] ?? '', 'base64');
      if (salt.length === 0 || expected.length !== KEY_LENGTH) return { ok: false, needsRehash: false };

      const key = await derive(password, salt, { N, r, p });
      const ok = timingSafeEqual(key, expected);
      const needsRehash = ok && (N !== params.N || r !== params.r || p !== params.p);
      return { ok, needsRehash };
    },

    async burn() {
      await derive('timing-equaliser', burnSalt, params);
    },
  };
}
