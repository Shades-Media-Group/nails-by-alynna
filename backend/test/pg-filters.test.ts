import { ObjectId } from 'bson';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnsupportedError, type Collection, type Database, type Document, type Filter } from '../src/db/pg';
import { createTestDatabase } from './helpers';

/**
 * The PostgreSQL adapter reads like MongoDB: filters (paths, arrays, null/missing, typed
 * comparisons, $in, $or, $regex, $size, $type, $expr), sorting, projection and aggregation.
 */

const day = (d: number) => new Date(Date.UTC(2026, 5, d, 9));
const oid = (n: number) => new ObjectId(n.toString(16).padStart(24, '0'));

/** Test documents with readable string ids. */
type Doc = Document & { _id: string };

let db: Database;
let items: Collection<Doc>;

const ids = async (filter: Filter<Doc>, collection: Collection<Doc> = items) =>
  (await collection.find(filter).toArray()).map((doc) => doc._id).sort();

beforeAll(async () => {
  db = createTestDatabase();
  items = db.collection<Doc>('items');
  await items.insertMany([
    {
      _id: 'a',
      n: 1,
      s: 'apple',
      at: day(1),
      ref: oid(1),
      tags: ['x', 'y'],
      meta: { level: 1, color: 'red' },
      lines: [{ sku: 'p1', qty: 2 }, { sku: 'p2', qty: 5 }],
    },
    { _id: 'b', n: 5, s: 'Banana', at: day(5), ref: oid(2), tags: ['y'], meta: { level: 2 }, lines: [{ sku: 'p2', qty: 1 }] },
    { _id: 'c', n: 10, s: 'cherry', at: day(10), ref: oid(3), tags: [], meta: null, lines: [], note: null },
    { _id: 'd', n: '10', s: 'date 10.5', at: '2026-06-01', ref: 'not-an-id', tags: 'x' },
    { _id: 'e', n: 2.5, s: 'Éclair' },
  ]);
});

afterAll(async () => {
  await db.drop();
  await db.close();
});

describe('documents', () => {
  it('come back with real ObjectIds and Dates, nested ones included', async () => {
    const people = db.collection('people_codec');
    const id = new ObjectId();
    await people.insertOne({ _id: id, born: day(3), nested: { refs: [oid(7), { at: day(4) }] }, missing: undefined });
    const doc = await people.findOne({ _id: id });
    expect(doc?._id).toBeInstanceOf(ObjectId);
    expect(doc?._id.equals(id)).toBe(true);
    expect(doc?.born).toEqual(day(3));
    expect(doc?.nested.refs[0]).toBeInstanceOf(ObjectId);
    expect(doc?.nested.refs[1].at).toBeInstanceOf(Date);
    expect(doc?.missing).toBeNull(); // like the MongoDB driver: undefined is stored as null
  });

  it('get an ObjectId _id when inserted without one', async () => {
    const people = db.collection('people_ids');
    const doc: Document = { name: 'Ana' };
    const result = await people.insertOne(doc);
    expect(result.insertedId).toBeInstanceOf(ObjectId);
    expect(doc._id).toBe(result.insertedId);
    expect(await people.countDocuments({ _id: result.insertedId })).toBe(1);
  });

  it('refuses $-prefixed field names', async () => {
    await expect(db.collection<Doc>('people_bad').insertOne({ _id: 'x', $bad: 1 })).rejects.toThrow(/cannot start with "\$"/);
  });
});

describe('filters', () => {
  it('match equality, also through nested objects and arrays of objects', async () => {
    expect(await ids({ n: 5 })).toEqual(['b']);
    expect(await ids({ n: 10 })).toEqual(['c']); // not the string '10'
    expect(await ids({ 'meta.level': 2 })).toEqual(['b']);
    expect(await ids({ 'lines.sku': 'p2' })).toEqual(['a', 'b']);
    expect(await ids({ 'lines.qty': { $gt: 4 } })).toEqual(['a']);
    expect(await ids({ ref: oid(2) })).toEqual(['b']);
  });

  it('match an element of an array value, or the whole array', async () => {
    expect(await ids({ tags: 'x' })).toEqual(['a', 'd']);
    expect(await ids({ tags: ['y'] })).toEqual(['b']);
    expect(await ids({ tags: [] })).toEqual(['c']);
    expect(await ids({ tags: /^x/ })).toEqual(['a', 'd']);
  });

  it('treat null as null or missing', async () => {
    expect(await ids({ meta: null })).toEqual(['c', 'd', 'e']);
    expect(await ids({ note: null })).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(await ids({ meta: { $ne: null } })).toEqual(['a', 'b']);
    expect(await ids({ meta: { $exists: true } })).toEqual(['a', 'b', 'c']);
    expect(await ids({ meta: { $exists: false } })).toEqual(['d', 'e']);
    expect(await ids({ 'meta.level': { $exists: true } })).toEqual(['a', 'b']);
  });

  it('let $ne and $nin match missing fields and exclude arrays holding the value', async () => {
    expect(await ids({ 'meta.color': { $ne: 'red' } })).toEqual(['b', 'c', 'd', 'e']);
    expect(await ids({ 'lines.sku': { $ne: 'p1' } })).toEqual(['b', 'c', 'd', 'e']);
    expect(await ids({ tags: { $nin: ['x'] } })).toEqual(['b', 'c', 'e']);
  });

  it('compare only values of the same type: numbers, strings (byte-wise), dates, ObjectIds', async () => {
    expect(await ids({ n: { $gt: 1, $lte: 10 } })).toEqual(['b', 'c', 'e']);
    expect(await ids({ s: { $lt: 'a' } })).toEqual(['b']); // 'B' < 'a', as MongoDB compares bytes
    expect(await ids({ at: { $gte: day(5) } })).toEqual(['b', 'c']);
    expect(await ids({ at: { $lt: day(5) } })).toEqual(['a']);
    expect(await ids({ ref: { $gt: oid(1) } })).toEqual(['b', 'c']);
    expect(await ids({ _id: { $lt: 'c' } })).toEqual(['a', 'b']);
    expect(await ids({ n: { $gt: null } })).toEqual([]);
  });

  it('support $in with values, null, ObjectIds and array fields', async () => {
    expect(await ids({ n: { $in: [1, 10, '10'] } })).toEqual(['a', 'c', 'd']);
    expect(await ids({ meta: { $in: [null] } })).toEqual(['c', 'd', 'e']);
    expect(await ids({ tags: { $in: ['y'] } })).toEqual(['a', 'b']);
    expect(await ids({ ref: { $in: [oid(2), oid(3)] } })).toEqual(['b', 'c']);
    expect(await ids({ _id: { $in: ['a', 'e', 'zz'] } })).toEqual(['a', 'e']);
    expect(await ids({ _id: { $in: [] } })).toEqual([]);
  });

  it('combine with $or, $and and $nor', async () => {
    expect(await ids({ $or: [{ n: 1 }, { 'meta.level': 2 }] })).toEqual(['a', 'b']);
    expect(await ids({ $and: [{ n: { $gt: 1 } }, { n: { $lt: 10 } }] })).toEqual(['b', 'e']);
    expect(await ids({ $nor: [{ n: 1 }, { n: 5 }] })).toEqual(['c', 'd', 'e']);
    expect(await ids({ tags: 'y', $or: [{ n: 1 }, { n: 10 }] })).toEqual(['a']);
  });

  it('match $regex (strings and RegExp, the i flag, escapes and word boundaries)', async () => {
    expect(await ids({ s: { $regex: '^b' } })).toEqual([]);
    expect(await ids({ s: { $regex: '^b', $options: 'i' } })).toEqual(['b']);
    expect(await ids({ s: /an/ })).toEqual(['b']);
    expect(await ids({ s: { $regex: /\d+\.\d/ } })).toEqual(['d']);
    expect(await ids({ s: /\b10\b/ })).toEqual(['d']);
    expect(await ids({ s: { $regex: 'e 10\\.5$' } })).toEqual(['d']);
  });

  it('match $size, $type and $not', async () => {
    expect(await ids({ tags: { $size: 2 } })).toEqual(['a']);
    expect(await ids({ tags: { $size: 0 } })).toEqual(['c']);
    expect(await ids({ lines: { $size: 1 } })).toEqual(['b']);
    expect(await ids({ n: { $type: 'string' } })).toEqual(['d']);
    expect(await ids({ n: { $type: 'int' } })).toEqual(['a', 'b', 'c']);
    expect(await ids({ n: { $type: 'double' } })).toEqual(['e']);
    expect(await ids({ at: { $type: 'date' } })).toEqual(['a', 'b', 'c']);
    expect(await ids({ ref: { $type: 'objectId' } })).toEqual(['a', 'b', 'c']);
    expect(await ids({ meta: { $type: 'object' } })).toEqual(['a', 'b']);
    expect(await ids({ at: { $type: 'object' } })).toEqual([]); // a date is not an embedded document
    expect(await ids({ tags: { $type: 'array' } })).toEqual(['a', 'b', 'c']);
    expect(await ids({ s: { $not: /^[a-z]/ } })).toEqual(['b', 'e']);
  });

  it('keep a string _id from matching an ObjectId with the same text', async () => {
    const people = db.collection<{ _id: ObjectId | string; name: string }>('people_typed');
    const id = oid(42);
    await people.insertOne({ _id: id, name: 'Ana' });
    expect(await people.countDocuments({ _id: id })).toBe(1);
    expect(await people.countDocuments({ _id: id.toHexString() })).toBe(0);
    expect(await people.countDocuments({ _id: { $ne: id } })).toBe(0);
  });

  it('evaluate the $expr forms the app uses', async () => {
    const codes = db.collection<Doc>('codes');
    await codes.insertMany([
      { _id: 'same', createdAt: day(1), updatedAt: day(1), max: null, perPerson: 1, uses: [{ by: 'ann' }] },
      { _id: 'edited', createdAt: day(1), updatedAt: day(2), max: 2, perPerson: 2, uses: [{ by: 'ann' }, { by: 'bob' }] },
      { _id: 'open', createdAt: day(1), perPerson: 3, uses: [{ by: 'ann' }, { by: 'ann' }] },
    ]);
    expect(await ids({ $expr: { $eq: ['$updatedAt', '$createdAt'] } }, codes)).toEqual(['same']);
    expect(await ids({ $expr: { $eq: [{ $ifNull: ['$max', null] }, null] } }, codes)).toEqual(['open', 'same']);
    expect(await ids({ $expr: { $lt: [{ $size: '$uses' }, '$max'] } }, codes)).toEqual([]); // 2 < 2; a number is never below null
    const annLeft = {
      $expr: { $lt: [{ $size: { $filter: { input: '$uses', cond: { $eq: ['$$this.by', 'ann'] } } } }, '$perPerson'] },
    };
    expect(await ids(annLeft, codes)).toEqual(['edited', 'open']);
    expect(await ids({ $expr: { $and: [{ $gt: ['$perPerson', 1] }, { $in: [{ by: 'bob' }, '$uses'] }] } }, codes)).toEqual(['edited']);
  });

  it('refuse operators it does not implement instead of guessing', async () => {
    await expect(items.find({ n: { $mod: [2, 0] } }).toArray()).rejects.toThrow(UnsupportedError);
    await expect(items.find({ $where: 'true' }).toArray()).rejects.toThrow(UnsupportedError);
  });
});

describe('reading', () => {
  let people: Collection<Doc>;

  beforeAll(async () => {
    people = db.collection<Doc>('people');
    await people.insertMany([
      { _id: 'p1', name: 'Ana', age: 30, meta: { level: 1, city: 'Chișinău' } },
      { _id: 'p2', name: 'Bob', age: null },
      { _id: 'p3', name: 'Cid', age: 25 },
      { _id: 'p4', name: 'Dan' },
      { _id: 'p5', name: 'Eva', age: 30 },
    ]);
  });

  it('sorts with null and missing first when ascending and last when descending, ties by insertion', async () => {
    const byAge = async (dir: 1 | -1) => (await people.find().sort({ age: dir }).toArray()).map((p) => p.name);
    expect((await byAge(1)).slice(2)).toEqual(['Cid', 'Ana', 'Eva']);
    expect((await byAge(1)).slice(0, 2).sort()).toEqual(['Bob', 'Dan']);
    expect((await byAge(-1)).slice(0, 3)).toEqual(['Eva', 'Ana', 'Cid']);
    expect((await people.find().sort({ age: -1, name: 1 }).toArray()).map((p) => p.name).slice(0, 3)).toEqual(['Ana', 'Eva', 'Cid']);
    expect((await people.find().toArray()).map((p) => p._id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('skips, limits and walks a cursor', async () => {
    const page = await people.find({}, { sort: { name: 1 }, skip: 1, limit: 2 }).toArray();
    expect(page.map((p) => p.name)).toEqual(['Bob', 'Cid']);
    const cursor = people.find().sort({ name: -1 }).limit(2);
    expect((await cursor.next())?.name).toBe('Eva');
    expect((await cursor.next())?.name).toBe('Dan');
    expect(await cursor.next()).toBeNull();
    expect(await people.findOne({}, { sort: { age: 1, name: -1 } })).toMatchObject({ name: 'Dan' });
  });

  it('projects fields in or out, _id kept unless excluded', async () => {
    expect(await people.findOne({ _id: 'p1' }, { projection: { name: 1 } })).toEqual({ _id: 'p1', name: 'Ana' });
    expect(await people.findOne({ _id: 'p1' }, { projection: { name: 1, _id: 0 } })).toEqual({ name: 'Ana' });
    expect(await people.findOne({ _id: 'p1' }, { projection: { meta: 0, age: 0 } })).toEqual({ _id: 'p1', name: 'Ana' });
    expect(await people.findOne({ _id: 'p1' }, { projection: { 'meta.city': 1 } })).toEqual({ _id: 'p1', meta: { city: 'Chișinău' } });
    expect((await people.find({ _id: 'p2' }).project({ _id: 0, name: 1 }).toArray())[0]).toEqual({ name: 'Bob' });
  });

  it('counts (with a limit) and lists distinct values', async () => {
    expect(await people.countDocuments()).toBe(5);
    expect(await people.countDocuments({ age: 30 })).toBe(2);
    expect(await people.countDocuments({ age: 30 }, { limit: 1 })).toBe(1);
    expect((await items.distinct('tags')).sort()).toEqual(['x', 'y']);
    expect((await items.distinct('meta.level')).sort()).toEqual([1, 2]);
    expect(await items.distinct('lines.sku', { n: 5 })).toEqual(['p2']);
  });

  it('aggregates: $match in SQL, then $group, $unwind, $sort and $limit', async () => {
    const byLevel = await items
      .aggregate([
        { $match: { n: { $type: 'number' } } },
        {
          $group: {
            _id: { $cond: [{ $gt: ['$n', 2] }, 'big', 'small'] },
            count: { $sum: 1 },
            total: { $sum: '$n' },
            latest: { $max: '$at' },
            first: { $first: '$s' },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();
    expect(byLevel).toEqual([
      { _id: 'big', count: 3, total: 17.5, latest: day(10), first: 'Banana' },
      { _id: 'small', count: 1, total: 1, latest: day(1), first: 'apple' },
    ]);
    const skus = await items
      .aggregate([
        { $match: { 'lines.0': { $exists: true } } },
        { $unwind: '$lines' },
        { $group: { _id: '$lines.sku', qty: { $sum: '$lines.qty' }, orders: { $sum: 1 } } },
        { $sort: { qty: -1 } },
        { $limit: 1 },
      ])
      .toArray()
      .catch((error: unknown) => error);
    // Numeric path steps are not implemented: said clearly instead of matching nothing.
    expect(skus).toBeInstanceOf(Error);
    const top = await items
      .aggregate([
        { $match: { lines: { $type: 'object' } } },
        { $unwind: '$lines' },
        { $group: { _id: '$lines.sku', qty: { $sum: '$lines.qty' }, orders: { $sum: 1 } } },
        { $sort: { qty: -1 } },
        { $limit: 1 },
      ])
      .toArray();
    expect(top).toEqual([{ _id: 'p2', qty: 6, orders: 2 }]);
  });
});
