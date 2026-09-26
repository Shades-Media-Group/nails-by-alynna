import { isJsonObject, splitPath, type Json, type JsonObject } from './codec';
import { UnsupportedError } from './errors';
import type { Document } from './types';

/**
 * Find projections ({a: 1, b: 1} or {a: 0}), applied to an encoded document. `_id` is kept
 * unless excluded, as in MongoDB.
 */

function included(value: unknown): boolean {
  if (value === 1 || value === true) return true;
  if (value === 0 || value === false) return false;
  throw new UnsupportedError(`projection value ${JSON.stringify(value)}`);
}

function copyPath(from: Json | undefined, to: JsonObject, parts: string[]): void {
  const [head, ...rest] = parts as [string, ...string[]];
  if (!isJsonObject(from) || !(head in from)) return;
  const value = from[head]!;
  if (rest.length === 0) {
    to[head] = value;
  } else if (isJsonObject(value)) {
    const child = isJsonObject(to[head]) ? to[head] : {};
    copyPath(value, child, rest);
    if (Object.keys(child).length > 0) to[head] = child;
  } else if (Array.isArray(value)) {
    to[head] = value.flatMap((item) => {
      if (!isJsonObject(item)) return [];
      const child: JsonObject = {};
      copyPath(item, child, rest);
      return [child];
    });
  }
}

function removePath(doc: Json | undefined, parts: string[]): void {
  const [head, ...rest] = parts as [string, ...string[]];
  if (Array.isArray(doc)) {
    for (const item of doc) removePath(item, parts);
  } else if (isJsonObject(doc)) {
    if (rest.length === 0) delete doc[head];
    else removePath(doc[head], rest);
  }
}

export function project(doc: JsonObject, projection: Document | undefined): JsonObject {
  if (!projection) return doc;
  const fields = Object.entries(projection).filter(([key]) => key !== '_id');
  const keepId = projection._id === undefined || included(projection._id);
  const inclusive = fields.length > 0 ? included(fields[0]![1]) : projection._id !== undefined && keepId;
  if (fields.some(([, value]) => included(value) !== inclusive)) throw new Error('A projection cannot both include and exclude fields');

  if (inclusive) {
    const out: JsonObject = {};
    if (keepId && '_id' in doc) out._id = doc._id!;
    for (const [path] of fields) copyPath(doc, out, splitPath(path));
    return out;
  }
  const out = structuredClone(doc);
  for (const [path] of fields) removePath(out, splitPath(path));
  if (!keepId) delete out._id;
  return out;
}
