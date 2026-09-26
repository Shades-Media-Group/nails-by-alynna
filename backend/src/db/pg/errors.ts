/**
 * The adapter's errors. PostgreSQL's are put in MongoDB terms: a unique violation (23505)
 * becomes an error with `code: 11000`, which is what the app checks for (isDuplicateKey in
 * lib/errors.ts).
 */

/** A query, update or option the adapter does not implement: refused rather than half-done. */
export class UnsupportedError extends Error {
  constructor(what: string) {
    super(`Not supported by the PostgreSQL adapter: ${what}`);
    this.name = 'UnsupportedError';
  }
}

export class DuplicateKeyError extends Error {
  readonly code = 11000;

  constructor(
    readonly collection: string,
    /** The MongoDB index name (`_id_` for the primary key). */
    readonly index: string,
  ) {
    super(`E11000 duplicate key error collection: ${collection} index: ${index}`);
    this.name = 'DuplicateKeyError';
  }
}

interface PgError {
  code?: string;
  constraint?: string;
}

export const pgCode = (error: unknown): string | undefined => (error as PgError | null)?.code;

/** Deadlocks and serialization failures: the transaction can simply run again. */
export const isRetryable = (error: unknown): boolean => ['40P01', '40001'].includes(pgCode(error) ?? '');

export function translateError(error: unknown, collection: string): unknown {
  if (pgCode(error) !== '23505') return error;
  const constraint = (error as PgError).constraint ?? '';
  const index =
    constraint === `${collection}_pkey` ? '_id_' : constraint.startsWith(`${collection}_`) ? constraint.slice(collection.length + 1) : constraint;
  return new DuplicateKeyError(collection, index);
}
