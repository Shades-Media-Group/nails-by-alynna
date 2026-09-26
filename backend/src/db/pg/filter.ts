import { encode, fieldPath, isDate, isObjectId, isOid, isPlainObject, type Json } from './codec';
import { UnsupportedError } from './errors';
import { exprToSql } from './expression';
import type { Document } from './types';
import { arrayElements, jsonPath, quoteLiteral, sqlAnd, sqlNot, sqlOr, type Params } from './sql';

/**
 * MongoDB query filters as an SQL condition on the `doc` column, with MongoDB's semantics:
 *
 * - a dotted path walks into objects, and into every object of an array on the way;
 * - a condition matches when any value the path reaches, or any element of an array value,
 *   matches ({tags: 'x'} finds 'x' inside an array);
 * - `null` matches null and missing; $ne / $nin / $exists: false match missing fields;
 * - $gt / $gte / $lt / $lte only compare values of the operand's own type (a date with dates,
 *   a number with numbers), strings byte-wise like MongoDB.
 *
 * Everything is one SQL expression over the row, so a `SELECT … FOR UPDATE` re-checks the whole
 * filter against the latest version of a row it had to wait for (READ COMMITTED).
 */

export function isOperatorObject(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  const operators = keys.filter((key) => key.startsWith('$')).length;
  if (operators > 0 && operators < keys.length) throw new UnsupportedError(`mixing operators and fields in ${JSON.stringify(keys)}`);
  return operators > 0;
}

export function filterToSql(filter: Document | undefined, p: Params): string {
  return filter ? querySql(filter, p, 'doc', true) : 'TRUE';
}

function querySql(query: Document, p: Params, root: string, atRoot: boolean): string {
  const clauses: string[] = [];
  for (const [key, cond] of Object.entries(query)) {
    if (key === '$and' || key === '$or' || key === '$nor') {
      if (!Array.isArray(cond) || cond.length === 0) throw new Error(`${key} needs a non-empty array`);
      const parts = cond.map((item: Document) => querySql(item, p, root, atRoot));
      clauses.push(key === '$and' ? sqlAnd(parts) : key === '$or' ? sqlOr(parts) : sqlNot(sqlOr(parts)));
    } else if (key === '$expr') {
      clauses.push(exprToSql(cond, p, root));
    } else if (key === '$comment') {
      continue;
    } else if (key.startsWith('$')) {
      throw new UnsupportedError(`query operator ${key}`);
    } else {
      clauses.push(fieldSql(key, cond, p, root, atRoot));
    }
  }
  return sqlAnd(clauses);
}

// ── One field ────────────────────────────────────────────────────────────────────

function fieldSql(path: string, cond: unknown, p: Params, root: string, atRoot: boolean): string {
  if (atRoot && path === '_id') {
    const byKey = idSql(cond, p);
    if (byKey) return byKey;
  }
  const parts = fieldPath(path);
  if (cond instanceof RegExp) return onPath(root, parts, (x) => regexSql(x, cond.source, cond.flags, p), true, p);
  if (!isOperatorObject(cond)) return onPath(root, parts, (x) => equalSql(x, encode(cond), p), false, p);

  const clauses: string[] = [];
  for (const [op, operand] of Object.entries(cond)) {
    switch (op) {
      case '$eq':
      case '$ne': {
        const equal = onPath(root, parts, (x) => equalSql(x, encode(operand), p), false, p);
        clauses.push(op === '$eq' ? equal : sqlNot(equal));
        break;
      }
      case '$gt':
      case '$gte':
      case '$lt':
      case '$lte':
        clauses.push(onPath(root, parts, (x) => compareSql(x, op, encode(operand), p), true, p));
        break;
      case '$in':
      case '$nin': {
        if (!Array.isArray(operand)) throw new Error(`${op} needs an array`);
        const found = onPath(root, parts, (x) => inSql(x, operand, p), false, p);
        clauses.push(op === '$in' ? found : sqlNot(found));
        break;
      }
      case '$exists': {
        const exists = onPath(root, parts, (x) => `${x} IS NOT NULL`, false, p);
        clauses.push(operand ? exists : sqlNot(exists));
        break;
      }
      case '$type': {
        const types = Array.isArray(operand) ? operand : [operand];
        clauses.push(sqlOr(types.map((type) => onPath(root, parts, (x) => typeSql(x, type), type !== 'array' && type !== 4, p))));
        break;
      }
      case '$size': {
        if (!Number.isInteger(operand)) throw new Error('$size needs a whole number');
        const size = p.add(operand);
        clauses.push(onPath(root, parts, (x) => `CASE WHEN jsonb_typeof(${x}) = 'array' THEN jsonb_array_length(${x}) = ${size}::int ELSE FALSE END`, false, p));
        break;
      }
      case '$regex': {
        const source = operand instanceof RegExp ? operand.source : String(operand);
        const flags = `${operand instanceof RegExp ? operand.flags : ''}${typeof cond.$options === 'string' ? cond.$options : ''}`;
        clauses.push(onPath(root, parts, (x) => regexSql(x, source, flags, p), true, p));
        break;
      }
      case '$options':
        if (!('$regex' in cond)) throw new Error('$options needs $regex');
        break;
      case '$not':
        clauses.push(sqlNot(fieldSql(path, operand, p, root, false)));
        break;
      default:
        throw new UnsupportedError(`query operator ${op}`);
    }
  }
  return sqlAnd(clauses);
}

/**
 * The value(s) at `parts` below `root`, tested with `test`. Walks into objects, and into each
 * object of an array; with `expand`, a test also applies to each element of an array value.
 */
function onPath(root: string, parts: string[], test: (x: string) => string, expand: boolean, p: Params): string {
  const [head, ...rest] = parts as [string, ...string[]];
  const x = jsonPath(root, [head]);
  if (rest.length === 0) {
    if (!expand) return test(x);
    const e = p.alias();
    return `(${test(x)} OR EXISTS (SELECT 1 FROM ${arrayElements(x, e)} WHERE ${test(`${e}.v`)}))`;
  }
  const e = p.alias();
  const inObject = `(jsonb_typeof(${x}) IS DISTINCT FROM 'array' AND ${onPath(x, rest, test, expand, p)})`;
  const inArray = `EXISTS (SELECT 1 FROM ${arrayElements(x, e)} WHERE jsonb_typeof(${e}.v) = 'object' AND ${onPath(`${e}.v`, rest, test, expand, p)})`;
  return `(${inObject} OR ${inArray})`;
}

/** Scalars and encoded ObjectIds/Dates: JSONB containment `@>` of them is exact equality. */
const containable = (value: Json) => value === null || typeof value !== 'object' || isOid(value) || isDate(value);

/** Equal to `value`, or an array holding it; `null` also matches a missing value. */
function equalSql(x: string, value: Json, p: Params): string {
  if (value === null) return `(${x} IS NULL OR ${x} = 'null'::jsonb OR (jsonb_typeof(${x}) = 'array' AND ${x} @> '[null]'::jsonb))`;
  const param = p.json(value);
  if (containable(value)) return `(${x} = ${param} OR (jsonb_typeof(${x}) = 'array' AND ${x} @> ${p.json([value])}))`;
  const e = p.alias();
  return `(${x} = ${param} OR EXISTS (SELECT 1 FROM ${arrayElements(x, e)} WHERE ${e}.v = ${param}))`;
}

function inSql(x: string, operand: unknown[], p: Params): string {
  const plain: Json[] = [];
  const clauses: string[] = [];
  for (const item of operand) {
    if (item instanceof RegExp) {
      const e = p.alias();
      const test = (y: string) => regexSql(y, item.source, item.flags, p);
      clauses.push(`(${test(x)} OR EXISTS (SELECT 1 FROM ${arrayElements(x, e)} WHERE ${test(`${e}.v`)}))`);
      continue;
    }
    const value = encode(item);
    if (value !== null && containable(value)) plain.push(value);
    else clauses.push(equalSql(x, value, p));
  }
  if (plain.length > 0) {
    clauses.unshift(`(${x} = ANY(${p.jsonArray(plain)}) OR (jsonb_typeof(${x}) = 'array' AND ${x} @> ANY(${p.jsonArray(plain.map((v) => [v]))})))`);
  }
  return sqlOr(clauses);
}

const COMPARE: Record<string, string> = { $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' };

/** Type-bracketed comparison: only values of the operand's type can match. */
function compareSql(x: string, op: string, value: Json, p: Params): string {
  const sym = COMPARE[op]!;
  if (value === null) return op === '$gte' || op === '$lte' ? `(${x} IS NULL OR ${x} = 'null'::jsonb)` : 'FALSE';
  if (typeof value === 'number') return `(jsonb_typeof(${x}) = 'number' AND ${x} ${sym} ${p.json(value)})`;
  if (typeof value === 'boolean') return `(jsonb_typeof(${x}) = 'boolean' AND ${x} ${sym} ${p.json(value)})`;
  if (typeof value === 'string') return `(jsonb_typeof(${x}) = 'string' AND (${x} #>> '{}') COLLATE "C" ${sym} ${p.text(value)})`;
  if (isDate(value)) return `(jsonb_typeof(${x}) = 'object' AND ${x} ? '$date' AND (${x} ->> '$date') COLLATE "C" ${sym} ${p.text(value.$date)})`;
  if (isOid(value)) return `(jsonb_typeof(${x}) = 'object' AND ${x} ? '$oid' AND (${x} ->> '$oid') COLLATE "C" ${sym} ${p.text(value.$oid)})`;
  throw new UnsupportedError(`${op} with an object or an array`);
}

const TYPE_ALIASES: Record<number, string> = { 1: 'double', 2: 'string', 3: 'object', 4: 'array', 7: 'objectId', 8: 'bool', 9: 'date', 10: 'null', 16: 'int', 18: 'long' };

/** A JS number is stored by MongoDB as an int (whole, 32-bit) or a double. */
const isInt32 = (x: string) =>
  `CASE WHEN jsonb_typeof(${x}) = 'number' THEN ((${x} #>> '{}')::numeric % 1 = 0 AND (${x} #>> '{}')::numeric BETWEEN -2147483648 AND 2147483647) ELSE FALSE END`;

/** `$type` tests; also used for index predicates, so plain immutable SQL only. */
export function typeSql(x: string, type: unknown): string {
  const name = typeof type === 'number' ? TYPE_ALIASES[type] : type;
  switch (name) {
    case 'string':
    case 'array':
    case 'null':
    case 'number':
      return `jsonb_typeof(${x}) = '${name}'`;
    case 'bool':
      return `jsonb_typeof(${x}) = 'boolean'`;
    case 'object':
      return `(jsonb_typeof(${x}) = 'object' AND NOT (${x} ? '$oid') AND NOT (${x} ? '$date'))`;
    case 'objectId':
      return `(jsonb_typeof(${x}) = 'object' AND ${x} ? '$oid')`;
    case 'date':
      return `(jsonb_typeof(${x}) = 'object' AND ${x} ? '$date')`;
    case 'int':
      return isInt32(x);
    case 'double':
      return `(jsonb_typeof(${x}) = 'number' AND NOT ${isInt32(x)})`;
    case 'long':
      return 'FALSE';
    default:
      throw new UnsupportedError(`$type ${JSON.stringify(type)}`);
  }
}

/** JS regex syntax → PostgreSQL ARE: the same, except word boundaries (\b → \y, \B → \Y). */
function postgresPattern(source: string): string {
  return source.replace(/\\(.)/gs, (escape, char: string) => (char === 'b' ? '\\y' : char === 'B' ? '\\Y' : escape));
}

function regexSql(x: string, source: string, flags: string, p: Params): string {
  const unsupported = flags.replace(/[igu]/g, '');
  if (unsupported) throw new UnsupportedError(`regex flags "${unsupported}"`);
  if (/\(\?<[^=!]/.test(source)) throw new UnsupportedError('named groups in a regex');
  return `(jsonb_typeof(${x}) = 'string' AND (${x} #>> '{}') ${flags.includes('i') ? '~*' : '~'} ${p.text(postgresPattern(source))})`;
}

/**
 * `_id` equality and lists use the `id` primary key (ObjectIds by hex); the type check keeps a
 * string id from matching an ObjectId with the same text.
 */
function idSql(cond: unknown, p: Params): string | null {
  const keyed = (values: unknown[]): string | null => {
    const oids: string[] = [];
    const strings: string[] = [];
    for (const value of values) {
      if (isObjectId(value)) oids.push(value.toHexString());
      else if (typeof value === 'string') strings.push(value);
      else return null;
    }
    const clauses: string[] = [];
    if (oids.length > 0) clauses.push(`(id = ANY(${p.add(oids)}::text[]) AND jsonb_typeof(doc->'_id') = 'object')`);
    if (strings.length > 0) clauses.push(`(id = ANY(${p.add(strings)}::text[]) AND jsonb_typeof(doc->'_id') = 'string')`);
    return sqlOr(clauses);
  };
  if (!isOperatorObject(cond)) return keyed([cond]);
  const clauses: string[] = [];
  for (const [op, operand] of Object.entries(cond)) {
    const list = op === '$eq' || op === '$ne' ? [operand] : op === '$in' || op === '$nin' ? operand : null;
    if (!Array.isArray(list)) return null;
    const match = keyed(list);
    if (match === null) return null;
    clauses.push(op === '$eq' || op === '$in' ? match : sqlNot(match));
  }
  return sqlAnd(clauses);
}

/** A condition for a partial index: literal SQL (no parameters, no sub-queries). */
export function indexPredicateSql(filter: Document): string {
  const clauses: string[] = [];
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$and') {
      clauses.push(...(cond as Document[]).map(indexPredicateSql));
      continue;
    }
    if (key.startsWith('$')) throw new UnsupportedError(`partial index operator ${key}`);
    const x = jsonPath('doc', fieldPath(key));
    const literal = (value: unknown) => `${quoteLiteral(JSON.stringify(encode(value)))}::jsonb`;
    if (!isOperatorObject(cond)) {
      clauses.push(`${x} = ${literal(cond)}`);
      continue;
    }
    for (const [op, operand] of Object.entries(cond)) {
      if (op === '$exists') clauses.push(operand ? `${x} IS NOT NULL` : `${x} IS NULL`);
      else if (op === '$type') clauses.push(typeSql(x, operand));
      else if (op === '$eq') clauses.push(`${x} = ${literal(operand)}`);
      else throw new UnsupportedError(`partial index operator ${op}`);
    }
  }
  return sqlAnd(clauses);
}
