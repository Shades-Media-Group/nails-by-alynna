import { canonicalKey, compareValues, isJsonObject, splitPath, valuesEqual, type Json, type JsonObject } from './codec';
import { UnsupportedError } from './errors';
import { evaluate } from './expression';
import { matchesQuery } from './match';
import { project } from './projection';
import type { Document } from './types';

/**
 * Aggregation pipelines after the leading `$match` (which runs as SQL): $group, $unwind, $sort,
 * $limit, $skip, $project, $count and further $match stages, in JS on encoded documents.
 */

type Accumulate = (value: Json | undefined, state: { value?: Json; count: number; items: Json[] }) => void;

const ACCUMULATORS: Record<string, Accumulate> = {
  $sum: (value, s) => {
    if (typeof value === 'number') s.value = ((s.value as number | undefined) ?? 0) + value;
  },
  $avg: (value, s) => {
    if (typeof value === 'number') s.items.push(value);
  },
  $min: (value, s) => {
    if (value !== undefined && value !== null && (s.value === undefined || compareValues(value, s.value) < 0)) s.value = value;
  },
  $max: (value, s) => {
    if (value !== undefined && value !== null && (s.value === undefined || compareValues(value, s.value) > 0)) s.value = value;
  },
  $first: (value, s) => {
    if (s.count === 0) s.value = value ?? null;
  },
  $last: (value, s) => {
    s.value = value ?? null;
  },
  $push: (value, s) => {
    if (value !== undefined) s.items.push(value);
  },
  $addToSet: (value, s) => {
    if (value !== undefined && !s.items.some((item) => valuesEqual(item, value))) s.items.push(value);
  },
};

function accumulated(op: string, s: { value?: Json; items: Json[] }): Json {
  if (op === '$sum') return s.value ?? 0;
  if (op === '$avg') return s.items.length > 0 ? (s.items as number[]).reduce((a, b) => a + b, 0) / s.items.length : null;
  if (op === '$push' || op === '$addToSet') return s.items;
  return s.value ?? null;
}

function group(docs: JsonObject[], spec: Document): JsonObject[] {
  const fields = Object.entries(spec)
    .filter(([name]) => name !== '_id')
    .map(([name, acc]) => {
      const [op, expr] = Object.entries(acc as Document)[0] ?? [];
      if (!op || !ACCUMULATORS[op]) throw new UnsupportedError(`$group accumulator ${op}`);
      return { name, op, expr };
    });
  const groups = new Map<string, { id: Json; states: Array<{ value?: Json; count: number; items: Json[] }> }>();
  for (const doc of docs) {
    const id = evaluate(spec._id, { root: doc }) ?? null;
    const key = canonicalKey(id);
    let entry = groups.get(key);
    if (!entry) {
      entry = { id, states: fields.map(() => ({ count: 0, items: [] })) };
      groups.set(key, entry);
    }
    for (const [i, field] of fields.entries()) {
      const state = entry.states[i]!;
      ACCUMULATORS[field.op]!(evaluate(field.expr, { root: doc }), state);
      state.count++;
    }
  }
  return [...groups.values()].map(({ id, states }) => {
    const out: JsonObject = { _id: id };
    for (const [i, field] of fields.entries()) out[field.name] = accumulated(field.op, states[i]!);
    return out;
  });
}

function unwind(docs: JsonObject[], spec: unknown): JsonObject[] {
  const options = typeof spec === 'string' ? { path: spec } : (spec as { path: string; preserveNullAndEmptyArrays?: boolean });
  if (!options.path.startsWith('$')) throw new Error('$unwind needs a field path starting with $');
  const parts = splitPath(options.path.slice(1));
  return docs.flatMap((doc) => {
    let parent: Json | undefined = doc;
    for (const part of parts.slice(0, -1)) parent = isJsonObject(parent) ? parent[part] : undefined;
    const last = parts.at(-1)!;
    const value = isJsonObject(parent) ? parent[last] : undefined;
    if (!Array.isArray(value)) return value === undefined || value === null ? (options.preserveNullAndEmptyArrays ? [doc] : []) : [doc];
    if (value.length === 0) return options.preserveNullAndEmptyArrays ? [doc] : [];
    return value.map((item) => {
      const copy = structuredClone(doc);
      let target: JsonObject = copy;
      for (const part of parts.slice(0, -1)) target = target[part] as JsonObject;
      target[last] = item;
      return copy;
    });
  });
}

function sortBy(docs: JsonObject[], spec: Document): JsonObject[] {
  const keys = Object.entries(spec).map(([path, direction]) => ({ parts: splitPath(path), dir: direction === -1 || direction === 'desc' ? -1 : 1 }));
  const at = (doc: JsonObject, parts: string[]) =>
    parts.reduce<Json | undefined>((value, part) => (isJsonObject(value) ? value[part] : undefined), doc) ?? null;
  return [...docs].sort((a, b) => {
    for (const { parts, dir } of keys) {
      const c = compareValues(at(a, parts), at(b, parts));
      if (c !== 0) return c * dir;
    }
    return 0;
  });
}

export function runPipeline(input: JsonObject[], stages: Document[]): JsonObject[] {
  let docs = input;
  for (const stage of stages) {
    const entries = Object.entries(stage);
    if (entries.length !== 1) throw new Error('A pipeline stage has exactly one field');
    const [name, spec] = entries[0]!;
    switch (name) {
      case '$match':
        docs = docs.filter((doc) => matchesQuery(doc, spec as Document));
        break;
      case '$group':
        docs = group(docs, spec as Document);
        break;
      case '$unwind':
        docs = unwind(docs, spec);
        break;
      case '$sort':
        docs = sortBy(docs, spec as Document);
        break;
      case '$limit':
        docs = docs.slice(0, spec as number);
        break;
      case '$skip':
        docs = docs.slice(spec as number);
        break;
      case '$project':
        docs = docs.map((doc) => project(doc, spec as Document));
        break;
      case '$count':
        docs = docs.length > 0 ? [{ [spec as string]: docs.length }] : [];
        break;
      default:
        throw new UnsupportedError(`aggregation stage ${name}`);
    }
  }
  return docs;
}
