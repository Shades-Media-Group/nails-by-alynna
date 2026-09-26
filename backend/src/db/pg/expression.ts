import { compareValues, encode, isDate, isJsonObject, isPlainObject, splitPath, valuesEqual, type Json, type JsonObject } from './codec';
import { UnsupportedError } from './errors';
import { jsonPath, type Params } from './sql';

/**
 * Aggregation expressions ('$field', '$$this', {$cond: …}) as used by update pipelines, $group
 * and $expr. Evaluated in JS on encoded documents; for $expr compiled to SQL instead, so a
 * conditional update re-checks them under the row lock like the rest of its filter.
 */

/** Whether a plain object is a single `{$operator: argument}` expression. */
function operatorOf(expr: Record<string, unknown>): string | null {
  const keys = Object.keys(expr);
  if (keys.length === 1 && keys[0]!.startsWith('$')) return keys[0]!;
  if (keys.some((key) => key.startsWith('$'))) throw new UnsupportedError(`expression object ${JSON.stringify(keys)}`);
  return null;
}

function pairOf(arg: unknown, name: string): [unknown, unknown] {
  if (!Array.isArray(arg) || arg.length !== 2) throw new Error(`${name} takes exactly two arguments`);
  return [arg[0], arg[1]];
}

function condParts(arg: unknown): [unknown, unknown, unknown] {
  if (Array.isArray(arg)) return [arg[0], arg[1], arg[2]];
  const { if: test, then, else: otherwise } = arg as { if: unknown; then: unknown; else: unknown };
  return [test, then, otherwise];
}

// ── JS evaluation ────────────────────────────────────────────────────────────────

export interface Scope {
  root: JsonObject;
  vars?: Record<string, Json | undefined>;
}

/** false, 0, null and missing are false; everything else (even "" and []) is true. */
export const truthy = (value: Json | undefined): boolean =>
  !(value === undefined || value === null || value === false || value === 0);

/** Aggregation field paths go into objects and across arrays (giving the array of values). */
function fieldValue(value: Json | undefined, parts: string[]): Json | undefined {
  if (parts.length === 0) return value;
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const found = fieldValue(item, parts);
      return found === undefined ? [] : [found];
    });
  }
  if (isJsonObject(value)) return fieldValue(value[parts[0]!], parts.slice(1));
  return undefined;
}

function reference(expr: string, scope: Scope): Json | undefined {
  if (!expr.startsWith('$$')) return fieldValue(scope.root, splitPath(expr.slice(1)));
  const [name, ...path] = splitPath(expr.slice(2)) as [string, ...string[]];
  if (name === 'ROOT' || name === 'CURRENT') return fieldValue(scope.root, path);
  if (!scope.vars || !(name in scope.vars)) throw new Error(`Undefined variable $$${name}`);
  return fieldValue(scope.vars[name], path);
}

export function evaluate(expr: unknown, scope: Scope): Json | undefined {
  if (typeof expr === 'string' && expr.startsWith('$')) return reference(expr, scope);
  if (Array.isArray(expr)) return expr.map((item) => evaluate(item, scope) ?? null);
  if (isPlainObject(expr)) {
    const op = operatorOf(expr);
    if (op) return evaluateOperator(op, expr[op], scope);
    const out: JsonObject = {};
    for (const [key, item] of Object.entries(expr)) {
      const value = evaluate(item, scope);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  return encode(expr);
}

const COMPARE: Record<string, (c: number) => boolean> = {
  $eq: (c) => c === 0,
  $ne: (c) => c !== 0,
  $gt: (c) => c > 0,
  $gte: (c) => c >= 0,
  $lt: (c) => c < 0,
  $lte: (c) => c <= 0,
};

function evaluateOperator(op: string, arg: unknown, scope: Scope): Json | undefined {
  const run = (expr: unknown) => evaluate(expr, scope);
  const compare = COMPARE[op];
  if (compare) {
    const [a, b] = pairOf(arg, op);
    return compare(compareValues(run(a), run(b)));
  }
  switch (op) {
    case '$literal':
      return encode(arg);
    case '$cond': {
      const [test, then, otherwise] = condParts(arg);
      return truthy(run(test)) ? run(then) : run(otherwise);
    }
    case '$ifNull': {
      const list = arg as unknown[];
      for (const item of list.slice(0, -1)) {
        const value = run(item);
        if (value !== undefined && value !== null) return value;
      }
      return run(list.at(-1));
    }
    case '$and':
      return (arg as unknown[]).every((item) => truthy(run(item)));
    case '$or':
      return (arg as unknown[]).some((item) => truthy(run(item)));
    case '$not':
      return !truthy(run(Array.isArray(arg) ? arg[0] : arg));
    case '$in': {
      const [item, list] = pairOf(arg, op);
      const values = run(list);
      if (!Array.isArray(values)) throw new Error('$in needs an array');
      const value = run(item);
      return values.some((candidate) => valuesEqual(candidate, value));
    }
    case '$size': {
      const value = run(Array.isArray(arg) ? arg[0] : arg);
      if (!Array.isArray(value)) throw new Error('The argument to $size must be an array');
      return value.length;
    }
    case '$add': {
      let total = 0;
      let date: number | null = null;
      for (const value of (arg as unknown[]).map(run)) {
        if (value === undefined || value === null) return null;
        if (typeof value === 'number') total += value;
        else if (isDate(value) && date === null) date = Date.parse(value.$date);
        else throw new Error('$add only adds numbers (and one date)');
      }
      return date === null ? total : { $date: new Date(date + total).toISOString() };
    }
    case '$filter': {
      const { input, cond, as = 'this' } = arg as { input: unknown; cond: unknown; as?: string };
      const list = run(input);
      if (list === undefined || list === null) return null;
      if (!Array.isArray(list)) throw new Error('$filter needs an array');
      return list.filter((item) => truthy(evaluate(cond, { root: scope.root, vars: { ...scope.vars, [as]: item } })));
    }
    default:
      throw new UnsupportedError(`expression operator ${op}`);
  }
}

// ── SQL ($expr) ──────────────────────────────────────────────────────────────────

interface SqlScope {
  root: string;
  vars: Record<string, string>;
}

/** Compiled expression: a jsonb value (SQL NULL = missing) or an SQL boolean. */
interface SqlExpr {
  sql: string;
  bool: boolean;
}

const json = (sql: string): SqlExpr => ({ sql, bool: false });
const bool = (sql: string): SqlExpr => ({ sql, bool: true });
const asJson = (e: SqlExpr) => (e.bool ? `to_jsonb(${e.sql})` : e.sql);
const asBool = (e: SqlExpr) =>
  e.bool ? e.sql : `(${e.sql} IS NOT NULL AND ${e.sql} <> 'null'::jsonb AND ${e.sql} <> 'false'::jsonb AND ${e.sql} <> '0'::jsonb)`;

/** The BSON type rank of a jsonb value, as in typeRank(). */
export const rankSql = (x: string): string =>
  `CASE WHEN ${x} IS NULL THEN 0 WHEN jsonb_typeof(${x}) = 'null' THEN 1 WHEN jsonb_typeof(${x}) = 'number' THEN 2 ` +
  `WHEN jsonb_typeof(${x}) = 'string' THEN 3 WHEN jsonb_typeof(${x}) = 'array' THEN 5 WHEN jsonb_typeof(${x}) = 'boolean' THEN 7 ` +
  `WHEN ${x} ? '$oid' THEN 6 WHEN ${x} ? '$date' THEN 8 ELSE 4 END`;

const SQL_COMPARE: Record<string, string> = { $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' };

/** Aggregation comparison: any two values compare, by type rank first (like compareValues). */
function compareSql(op: string, a: string, b: string, p: Params): string {
  const sym = SQL_COMPARE[op]!;
  const c = p.alias();
  const v = p.alias();
  const text = (field: string) => `(${c}.a ${field}) COLLATE "C" ${sym} (${c}.b ${field}) COLLATE "C"`;
  return (
    `(SELECT CASE WHEN ${c}.ra <> ${c}.rb THEN ${c}.ra ${sym} ${c}.rb ` +
    `WHEN ${c}.ra IN (2, 7) THEN ${c}.a ${sym} ${c}.b ` +
    `WHEN ${c}.ra = 3 THEN ${text("#>> '{}'")} WHEN ${c}.ra = 6 THEN ${text("->> '$oid'")} WHEN ${c}.ra = 8 THEN ${text("->> '$date'")} ` +
    `WHEN ${c}.ra < 2 THEN ${op === '$gte' || op === '$lte' ? 'TRUE' : 'FALSE'} ELSE ${c}.a ${sym} ${c}.b END ` +
    `FROM (SELECT ${v}.a, ${v}.b, ${rankSql(`${v}.a`)} AS ra, ${rankSql(`${v}.b`)} AS rb FROM (SELECT ${a} AS a, ${b} AS b) AS ${v}) AS ${c})`
  );
}

function referenceSql(expr: string, scope: SqlScope): string {
  if (!expr.startsWith('$$')) return jsonPath(scope.root, splitPath(expr.slice(1)));
  const [name, ...path] = splitPath(expr.slice(2)) as [string, ...string[]];
  const base = name === 'ROOT' || name === 'CURRENT' ? scope.root : scope.vars[name];
  if (!base) throw new Error(`Undefined variable $$${name}`);
  return jsonPath(base, path);
}

function compile(expr: unknown, p: Params, scope: SqlScope): SqlExpr {
  if (typeof expr === 'string' && expr.startsWith('$')) return json(referenceSql(expr, scope));
  if (Array.isArray(expr)) return json(`jsonb_build_array(${expr.map((item) => asJson(compile(item, p, scope))).join(', ')})`);
  if (isPlainObject(expr)) {
    const op = operatorOf(expr);
    if (op) return compileOperator(op, expr[op], p, scope);
    const pairs = Object.entries(expr).map(([key, item]) => `${p.text(key)}, ${asJson(compile(item, p, scope))}`);
    return json(`jsonb_build_object(${pairs.join(', ')})`);
  }
  return json(p.json(encode(expr)));
}

function compileOperator(op: string, arg: unknown, p: Params, scope: SqlScope): SqlExpr {
  const run = (expr: unknown) => compile(expr, p, scope);
  const both = () => pairOf(arg, op).map((item) => asJson(run(item))) as [string, string];
  switch (op) {
    case '$literal':
      return json(p.json(encode(arg)));
    case '$eq':
    case '$ne': {
      const [a, b] = both();
      return bool(`(${a} IS ${op === '$eq' ? 'NOT ' : ''}DISTINCT FROM ${b})`);
    }
    case '$gt':
    case '$gte':
    case '$lt':
    case '$lte': {
      const [a, b] = both();
      return bool(compareSql(op, a, b, p));
    }
    case '$and':
    case '$or': {
      const items = (arg as unknown[]).map((item) => asBool(run(item)));
      if (items.length === 0) return bool(op === '$and' ? 'TRUE' : 'FALSE');
      return bool(`(${items.join(op === '$and' ? ' AND ' : ' OR ')})`);
    }
    case '$not':
      return bool(`NOT ${asBool(run(Array.isArray(arg) ? arg[0] : arg))}`);
    case '$ifNull': {
      const list = (arg as unknown[]).map((item) => asJson(run(item)));
      const last = list.pop()!;
      return json(`COALESCE(${[...list.map((item) => `NULLIF(${item}, 'null'::jsonb)`), last].join(', ')})`);
    }
    case '$size':
      return json(`to_jsonb(jsonb_array_length(${asJson(run(Array.isArray(arg) ? arg[0] : arg))}))`);
    case '$cond': {
      const [test, then, otherwise] = condParts(arg);
      return json(`CASE WHEN ${asBool(run(test))} THEN ${asJson(run(then))} ELSE ${asJson(run(otherwise))} END`);
    }
    case '$in': {
      const [item, list] = both();
      const e = p.alias();
      return bool(`EXISTS (SELECT 1 FROM jsonb_array_elements(${list}) AS ${e}(v) WHERE ${e}.v = ${item})`);
    }
    case '$filter': {
      const { input, cond, as = 'this' } = arg as { input: unknown; cond: unknown; as?: string };
      const list = asJson(run(input));
      const e = p.alias();
      const test = asBool(compile(cond, p, { root: scope.root, vars: { ...scope.vars, [as]: `${e}.v` } }));
      return json(
        `CASE WHEN jsonb_typeof(${list}) = 'array' THEN (SELECT COALESCE(jsonb_agg(${e}.v ORDER BY ${e}.n), '[]'::jsonb) ` +
          `FROM jsonb_array_elements(${list}) WITH ORDINALITY AS ${e}(v, n) WHERE ${test}) END`,
      );
    }
    default:
      throw new UnsupportedError(`$expr operator ${op}`);
  }
}

/** `$expr` as an SQL boolean over the document `root` (e.g. `doc`). */
export function exprToSql(expr: unknown, p: Params, root: string): string {
  return asBool(compile(expr, p, { root, vars: {} }));
}
