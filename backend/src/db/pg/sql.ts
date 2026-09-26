import type { Json } from './codec';

/** SQL text helpers: quoting, query parameters and JSON paths into the `doc` column. */

export const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

export function quoteLiteral(value: string): string {
  if (value.includes('\0')) throw new TypeError('NUL characters are not allowed in SQL text');
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "''");
  return value.includes('\\') ? `E'${escaped}'` : `'${escaped}'`;
}

/** `root->'a'->'b'` for the path a.b (NULL wherever a step is missing or not an object). */
export const jsonPath = (root: string, parts: string[]): string =>
  parts.reduce((expr, part) => `${expr}->${quoteLiteral(part)}`, root);

/** Collects `$n` parameters (and aliases for sub-queries) while a statement is built. */
export class Params {
  readonly values: unknown[] = [];
  private aliases = 0;

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  json(value: Json): string {
    return `${this.add(JSON.stringify(value))}::jsonb`;
  }

  jsonArray(values: Json[]): string {
    return `${this.add(values.map((value) => JSON.stringify(value)))}::jsonb[]`;
  }

  text(value: string): string {
    return `${this.add(value)}::text`;
  }

  alias(): string {
    return `_e${++this.aliases}`;
  }
}

/** The elements of `x` when it is an array (no rows otherwise), as `alias.v`. */
export const arrayElements = (x: string, alias: string): string =>
  `jsonb_array_elements(CASE WHEN jsonb_typeof(${x}) = 'array' THEN ${x} END) AS ${alias}(v)`;

export const sqlAnd = (clauses: string[]): string => (clauses.length === 0 ? 'TRUE' : clauses.length === 1 ? clauses[0]! : `(${clauses.join(' AND ')})`);
export const sqlOr = (clauses: string[]): string => (clauses.length === 0 ? 'FALSE' : clauses.length === 1 ? clauses[0]! : `(${clauses.join(' OR ')})`);
/** NOT that treats "unknown" (SQL NULL) as false first, so negations stay two-valued. */
export const sqlNot = (clause: string): string => `NOT COALESCE(${clause}, FALSE)`;
