/**
 * A MongoDB-style document API on PostgreSQL JSONB.
 *
 * Why: production runs on a host.md Plesk account whose only database is PostgreSQL 10, and the
 * app was written against the MongoDB driver (about 170 `deps.col.<collection>.<method>()` calls).
 * Instead of rewriting every query, this adapter keeps that API — findOne, find, updateOne,
 * findOneAndUpdate, aggregate, bulkWrite, createIndexes… — and stores each collection as a table
 * `(id text primary key, doc jsonb, seq bigserial)`.
 *
 * How:
 * - codec.ts      documents ⇄ JSON, keeping ObjectId and Date ({"$oid": …}, {"$date": …})
 * - filter.ts     query filters → one SQL condition, with MongoDB's array/null/type semantics
 * - expression.ts aggregation expressions ($expr → SQL; pipelines and $group → JS)
 * - update.ts     update operators and pipelines, applied in JS under a row lock
 * - collection.ts the collection API; atomic updates via SELECT … FOR UPDATE (READ COMMITTED)
 * - indexes.ts    index specs → expression indexes; TTL indexes → a periodic cleanup
 * - errors.ts     unique violations → DuplicateKeyError with `code: 11000`
 *
 * Only what the app uses is implemented; anything else throws UnsupportedError rather than
 * quietly behaving differently. PostgreSQL 10 compatible (no jsonpath, no generated columns).
 */
export { AggregationCursor, Collection, FindCursor, type BulkWriteSummary } from './collection';
export { Database, describeDatabase, type DatabaseOptions } from './database';
export { DuplicateKeyError, UnsupportedError } from './errors';
export { expireDocuments, startTtlMonitor } from './indexes';
export type { Document, Filter, UpdateFilter, WithId } from './types';
export { UpdateError } from './update';
