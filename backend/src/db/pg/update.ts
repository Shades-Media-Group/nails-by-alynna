import { cloneJson, compareValues, encode, isJsonObject, isPlainObject, splitPath, valuesEqual, type Json, type JsonObject } from './codec';
import { UnsupportedError } from './errors';
import { evaluate } from './expression';
import { isOperatorObject } from './filter';
import { matchesElement } from './match';
import type { Document } from './types';

/**
 * Update operators ($set, $inc, $push, …) and update pipelines, applied in JS to an encoded
 * document. The caller holds the row lock (SELECT … FOR UPDATE) from reading the document to
 * writing it back, so an update is atomic like in MongoDB.
 */

/** An update MongoDB itself would refuse; `code` is MongoDB's error code. */
export class UpdateError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = 'UpdateError';
  }
}

export function assertUpdate(update: Document | Document[]): void {
  if (Array.isArray(update)) return;
  const keys = Object.keys(update);
  if (keys.length === 0 || keys.some((key) => !key.startsWith('$'))) throw new UpdateError('Update document requires atomic operators', 9);
}

// ── Paths inside a document ──────────────────────────────────────────────────────

type Container = JsonObject | Json[];

const isIndex = (key: string) => /^\d+$/.test(key);

function childOf(container: Container, key: string): Json | undefined {
  if (Array.isArray(container)) return isIndex(key) ? container[Number(key)] : undefined;
  return container[key];
}

function setChild(container: Container, key: string, value: Json): void {
  if (!Array.isArray(container)) {
    container[key] = value;
    return;
  }
  if (!isIndex(key)) throw new UpdateError(`Cannot create field '${key}' in an array`, 28);
  const index = Number(key);
  while (container.length < index) container.push(null);
  container[index] = value;
}

/** The object or array holding the last step of `parts`; with `create`, missing objects are made. */
function containerOf(doc: JsonObject, parts: string[], create: boolean): Container | null {
  let current: Container = doc;
  for (const part of parts.slice(0, -1)) {
    let child = childOf(current, part);
    if (child === undefined) {
      if (!create) return null;
      child = {};
      setChild(current, part, child);
    }
    if (!Array.isArray(child) && !isJsonObject(child)) {
      if (!create) return null;
      throw new UpdateError(`Cannot create field '${parts.join('.')}': '${part}' holds ${JSON.stringify(child)}`, 28);
    }
    current = child;
  }
  return current;
}

export function setPath(doc: JsonObject, parts: string[], value: Json): void {
  setChild(containerOf(doc, parts, true)!, parts.at(-1)!, value);
}

function getPath(doc: JsonObject, parts: string[]): Json | undefined {
  const container = containerOf(doc, parts, false);
  return container ? childOf(container, parts.at(-1)!) : undefined;
}

function unsetPath(doc: JsonObject, parts: string[]): void {
  const container = containerOf(doc, parts, false);
  const key = parts.at(-1)!;
  if (!container) return;
  if (!Array.isArray(container)) delete container[key];
  else if (isIndex(key) && Number(key) < container.length) container[Number(key)] = null; // like MongoDB: arrays keep their length
}

// ── Operators ────────────────────────────────────────────────────────────────────

/** `value` or `{$each: [...]}` as the list of encoded items to add. */
function itemsOf(op: string, value: unknown): Json[] {
  if (!isPlainObject(value) || !('$each' in value)) return [encode(value)];
  const extra = Object.keys(value).filter((key) => key !== '$each');
  if (extra.length > 0) throw new UnsupportedError(`${op} modifiers ${extra.join(', ')}`);
  if (!Array.isArray(value.$each)) throw new UpdateError(`${op}: $each needs an array`, 2);
  return value.$each.map(encode);
}

function arrayAt(doc: JsonObject, parts: string[], op: string): Json[] | undefined {
  const current = getPath(doc, parts);
  if (current !== undefined && !Array.isArray(current)) throw new UpdateError(`${op} needs '${parts.join('.')}' to be an array`, 2);
  return current;
}

function applyOperator(doc: JsonObject, op: string, parts: string[], value: unknown, insert: boolean): void {
  switch (op) {
    case '$set':
      return setPath(doc, parts, encode(value));
    case '$setOnInsert':
      if (insert) setPath(doc, parts, encode(value));
      return;
    case '$unset':
      return unsetPath(doc, parts);
    case '$inc': {
      if (typeof value !== 'number') throw new UpdateError('Cannot increment with a non-numeric argument', 14);
      const current = getPath(doc, parts);
      if (current !== undefined && typeof current !== 'number') throw new UpdateError(`Cannot apply $inc to '${parts.join('.')}', a non-numeric value`, 14);
      return setPath(doc, parts, (current ?? 0) + value);
    }
    case '$min':
    case '$max': {
      const target = encode(value);
      const current = getPath(doc, parts);
      const c = current === undefined ? 0 : compareValues(target, current);
      if (current === undefined || (op === '$max' ? c > 0 : c < 0)) setPath(doc, parts, target);
      return;
    }
    case '$push': {
      const items = itemsOf(op, value);
      const current = arrayAt(doc, parts, op);
      if (current) current.push(...items);
      else setPath(doc, parts, items);
      return;
    }
    case '$addToSet': {
      const current = arrayAt(doc, parts, op) ?? [];
      for (const item of itemsOf(op, value)) if (!current.some((existing) => valuesEqual(existing, item))) current.push(item);
      return setPath(doc, parts, current);
    }
    case '$pull': {
      const current = arrayAt(doc, parts, op);
      if (current) setPath(doc, parts, current.filter((element) => !matchesElement(element, value)));
      return;
    }
    default:
      throw new UnsupportedError(`update operator ${op}`);
  }
}

/** MongoDB refuses two operators on the same path, or on a path and one inside it. */
function assertNoConflicts(update: Document): void {
  const paths = Object.values(update).flatMap((fields) => Object.keys(fields as object));
  for (const [i, a] of paths.entries()) {
    for (const b of paths.slice(i + 1)) {
      if (a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`)) {
        throw new UpdateError(`Updating the path '${a}' would create a conflict at '${b}'`, 40);
      }
    }
  }
}

/** Update pipelines: $set / $addFields (each stage sees the document as it was before it) and $unset. */
function applyPipeline(doc: JsonObject, stages: Document[]): void {
  for (const stage of stages) {
    const [name, spec] = Object.entries(stage)[0] ?? [];
    if (name === '$set' || name === '$addFields') {
      const before = cloneJson(doc);
      const values = Object.entries(spec as Document).map(([path, expr]) => [splitPath(path), evaluate(expr, { root: before })] as const);
      for (const [parts, value] of values) {
        if (value === undefined) unsetPath(doc, parts);
        else setPath(doc, parts, value);
      }
    } else if (name === '$unset') {
      for (const path of [spec as string | string[]].flat()) unsetPath(doc, splitPath(path));
    } else {
      throw new UnsupportedError(`update pipeline stage ${name}`);
    }
  }
}

/** The document after `update`; `insert` when it is being created by an upsert ($setOnInsert applies). */
export function applyUpdate(doc: JsonObject, update: Document | Document[], insert: boolean): JsonObject {
  const next = cloneJson(doc);
  if (Array.isArray(update)) {
    applyPipeline(next, update);
  } else {
    assertNoConflicts(update);
    for (const [op, fields] of Object.entries(update)) {
      if (!isPlainObject(fields)) throw new UpdateError(`${op} needs an object`, 9);
      for (const [path, value] of Object.entries(fields)) applyOperator(next, op, splitPath(path), value, insert);
    }
  }
  if (!insert && !valuesEqual(doc._id, next._id)) {
    throw new UpdateError("Performing an update on the path '_id' would modify the immutable field '_id'", 66);
  }
  return next;
}

/** The start of an upserted document: the filter's equality conditions (`{a: 1}`, `{a: {$eq: 1}}`). */
export function upsertSeed(filter: Document): JsonObject {
  const doc: JsonObject = {};
  const visit = (query: Document) => {
    for (const [key, cond] of Object.entries(query)) {
      if (key === '$and') (cond as Document[]).forEach(visit);
      else if (key.startsWith('$') || cond instanceof RegExp) continue;
      else if (!isOperatorObject(cond)) setPath(doc, splitPath(key), encode(cond));
      else if ('$eq' in cond) setPath(doc, splitPath(key), encode(cond.$eq));
    }
  };
  visit(filter);
  return doc;
}
