import { ObjectId } from 'bson';
import { UnsupportedError } from './errors';

/**
 * Documents as JSON, type-preserving (Extended JSON style): an ObjectId is stored as
 * {"$oid": "<hex>"} and a Date as {"$date": "<ISO, ms, Z>"}, so both come back as real
 * instances. Everything inside the adapter (filters, updates, grouping) works on this encoded
 * form; only what the adapter returns is decoded.
 */

export type Json = null | boolean | number | string | Json[] | JsonObject;
export interface JsonObject {
  [key: string]: Json;
}

export const isObjectId = (value: unknown): value is ObjectId =>
  value instanceof ObjectId ||
  (typeof value === 'object' && value !== null && (value as { _bsontype?: unknown })._bsontype === 'ObjectId');

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** An object that is neither an encoded ObjectId nor an encoded Date (an embedded document). */
export const isJsonObject = (value: Json | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !isOid(value) && !isDate(value);

export const isOid = (value: Json | undefined): value is { $oid: string } =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && typeof value.$oid === 'string' && Object.keys(value).length === 1;

export const isDate = (value: Json | undefined): value is { $date: string } =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && typeof value.$date === 'string' && Object.keys(value).length === 1;

/** Like the MongoDB driver: `undefined` is stored as null. `$`-prefixed field names are refused. */
export function encode(value: unknown): Json {
  if (value === undefined || value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`Cannot store the number ${value}`);
      return Object.is(value, -0) ? 0 : value;
    case 'object':
      break;
    default:
      throw new TypeError(`Cannot store a value of type ${typeof value}`);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError('Cannot store an invalid Date');
    return { $date: value.toISOString() };
  }
  if (isObjectId(value)) return { $oid: value.toHexString() };
  if (Array.isArray(value)) return value.map(encode);
  if (!isPlainObject(value)) {
    throw new TypeError(`Cannot store an instance of ${(value as object).constructor?.name ?? 'an unknown class'}`);
  }
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith('$')) throw new TypeError(`Field names cannot start with "$" (${key})`);
    out[key] = encode(item);
  }
  return out;
}

export function decode(value: Json): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value === null || typeof value !== 'object') return value;
  if (isOid(value)) return new ObjectId(value.$oid);
  if (isDate(value)) return new Date(value.$date);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = decode(item);
  return out;
}

/** The text key of an `_id` in the `id` column: the hex of an ObjectId, or the string itself. */
export function idKey(id: Json | undefined): string {
  if (isOid(id)) return id.$oid;
  if (typeof id === 'string') return id;
  throw new TypeError('_id must be an ObjectId or a string');
}

// ── Comparison (MongoDB's BSON order) ────────────────────────────────────────────

/** missing < null < numbers < strings < objects < arrays < ObjectId < booleans < dates. */
export function typeRank(value: Json | undefined): number {
  if (value === undefined) return 0;
  if (value === null) return 1;
  if (typeof value === 'number') return 2;
  if (typeof value === 'string') return 3;
  if (typeof value === 'boolean') return 7;
  if (Array.isArray(value)) return 5;
  if (isOid(value)) return 6;
  if (isDate(value)) return 8;
  return 4;
}

const order = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

/** Total order over encoded values; embedded documents compare with their keys sorted. */
export function compareValues(a: Json | undefined, b: Json | undefined): number {
  const rank = typeRank(a) - typeRank(b);
  if (rank !== 0) return Math.sign(rank);
  if (a === undefined || a === null || b === undefined || b === null) return 0;
  if (typeof a === 'number' || typeof a === 'string') return order(a, b as number | string);
  if (typeof a === 'boolean') return order(Number(a), Number(b));
  if (isOid(a)) return order(a.$oid, (b as { $oid: string }).$oid);
  if (isDate(a)) return order(Date.parse(a.$date), Date.parse((b as { $date: string }).$date));
  if (Array.isArray(a)) {
    const other = b as Json[];
    for (let i = 0; i < Math.min(a.length, other.length); i++) {
      const c = compareValues(a[i], other[i]);
      if (c !== 0) return c;
    }
    return order(a.length, other.length);
  }
  const left = Object.keys(a as JsonObject).sort();
  const right = Object.keys(b as JsonObject).sort();
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const c = order(left[i]!, right[i]!) || compareValues((a as JsonObject)[left[i]!], (b as JsonObject)[right[i]!]);
    if (c !== 0) return c;
  }
  return order(left.length, right.length);
}

/** Deep equality; field order does not matter (JSONB does not keep it). */
export const valuesEqual = (a: Json | undefined, b: Json | undefined): boolean => compareValues(a, b) === 0;

/** A stable string for grouping and de-duplicating values. */
export function canonicalKey(value: Json | undefined): string {
  if (value === undefined) return 'undefined';
  return JSON.stringify(value, (_key, item: Json) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([x], [y]) => order(x, y)))
      : item,
  );
}

export const cloneJson = <T extends Json>(value: T): T => structuredClone(value);

// ── Paths ────────────────────────────────────────────────────────────────────────

export function splitPath(path: string): string[] {
  const parts = path.split('.');
  if (parts.some((part) => part === '')) throw new Error(`Invalid field path "${path}"`);
  return parts;
}

/**
 * A path for queries, sorts and indexes. Array positions (`lines.0`) are refused: MongoDB reads
 * them as "element 0 or field '0'", which the SQL translation does not implement.
 */
export function fieldPath(path: string): string[] {
  const parts = splitPath(path);
  if (parts.some((part) => /^\d+$/.test(part))) throw new UnsupportedError(`array positions in query paths (${path})`);
  return parts;
}

/**
 * Values a query path reaches, walking into objects and into every object of an array
 * (`undefined` = the path is missing there). Arrays of scalars end the walk.
 */
export function queryValues(value: Json | undefined, parts: string[]): Array<Json | undefined> {
  if (parts.length === 0) return [value];
  const [head, ...rest] = parts as [string, ...string[]];
  if (Array.isArray(value)) {
    return value.flatMap((item) => (isJsonObject(item) ? queryValues(item[head], rest) : []));
  }
  if (isJsonObject(value)) return queryValues(value[head], rest);
  return [undefined];
}
