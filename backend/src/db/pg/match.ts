import { compareValues, encode, isJsonObject, isPlainObject, queryValues, splitPath, typeRank, valuesEqual, type Json } from './codec';
import { UnsupportedError } from './errors';
import { evaluate, truthy } from './expression';
import { isOperatorObject } from './filter';
import type { Document } from './types';

/**
 * The same query semantics as filter.ts, evaluated in JS on an encoded document. Used where
 * no SQL is involved: `$pull` conditions and `$match` stages after the first one.
 */

export function matchesQuery(doc: Json, query: Document): boolean {
  return Object.entries(query).every(([key, cond]) => {
    if (key === '$and') return (cond as Document[]).every((item) => matchesQuery(doc, item));
    if (key === '$or') return (cond as Document[]).some((item) => matchesQuery(doc, item));
    if (key === '$nor') return !(cond as Document[]).some((item) => matchesQuery(doc, item));
    if (key === '$expr') return isJsonObject(doc) && truthy(evaluate(cond, { root: doc }));
    if (key === '$comment') return true;
    if (key.startsWith('$')) throw new UnsupportedError(`query operator ${key}`);
    return matchesValues(queryValues(doc, splitPath(key)), cond);
  });
}

/** A `$pull` condition against one array element. */
export function matchesElement(element: Json, cond: unknown): boolean {
  if (cond instanceof RegExp || isOperatorObject(cond)) return matchesValues([element], cond);
  // A document condition is a query run against each element (other fields may be present).
  if (isPlainObject(cond)) return isJsonObject(element) && matchesQuery(element, cond);
  return valuesEqual(element, encode(cond));
}

/** The values themselves and, for arrays, their elements. */
const withElements = (values: Array<Json | undefined>) => values.flatMap((value) => (Array.isArray(value) ? [value, ...value] : [value]));

const equalTo = (values: Array<Json | undefined>, target: Json) =>
  target === null
    ? withElements(values).some((value) => value === undefined || value === null)
    : withElements(values).some((value) => value !== undefined && valuesEqual(value, target));

const TYPE_TESTS: Record<string, (value: Json) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  bool: (v) => typeof v === 'boolean',
  null: (v) => v === null,
  array: (v) => Array.isArray(v),
  object: (v) => typeRank(v) === 4,
  objectId: (v) => typeRank(v) === 6,
  date: (v) => typeRank(v) === 8,
};

function matchesValues(values: Array<Json | undefined>, cond: unknown): boolean {
  if (cond instanceof RegExp) return withElements(values).some((value) => typeof value === 'string' && cond.test(value));
  if (!isOperatorObject(cond)) return equalTo(values, encode(cond));
  return Object.entries(cond).every(([op, operand]) => {
    switch (op) {
      case '$eq':
        return equalTo(values, encode(operand));
      case '$ne':
        return !equalTo(values, encode(operand));
      case '$in':
        return (operand as unknown[]).some((item) => matchesValues(values, item instanceof RegExp ? item : { $eq: item }));
      case '$nin':
        return !(operand as unknown[]).some((item) => matchesValues(values, item instanceof RegExp ? item : { $eq: item }));
      case '$gt':
      case '$gte':
      case '$lt':
      case '$lte': {
        const target = encode(operand);
        if (target === null) return op === '$gte' || op === '$lte' ? equalTo(values, null) : false;
        return withElements(values).some((value) => {
          if (value === undefined || typeRank(value) !== typeRank(target)) return false;
          const c = compareValues(value, target);
          return op === '$gt' ? c > 0 : op === '$gte' ? c >= 0 : op === '$lt' ? c < 0 : c <= 0;
        });
      }
      case '$exists':
        return values.some((value) => value !== undefined) === Boolean(operand);
      case '$size':
        return values.some((value) => Array.isArray(value) && value.length === operand);
      case '$type': {
        const test = TYPE_TESTS[String(operand)];
        if (!test) throw new UnsupportedError(`$type ${JSON.stringify(operand)}`);
        return (operand === 'array' ? values : withElements(values)).some((value) => value !== undefined && test(value));
      }
      case '$regex': {
        const flags = `${operand instanceof RegExp ? operand.flags : ''}${typeof cond.$options === 'string' ? cond.$options : ''}`;
        const regex = new RegExp(operand instanceof RegExp ? operand.source : String(operand), flags);
        return withElements(values).some((value) => typeof value === 'string' && regex.test(value));
      }
      case '$options':
        return true;
      case '$not':
        return !matchesValues(values, operand);
      default:
        throw new UnsupportedError(`query operator ${op}`);
    }
  });
}
