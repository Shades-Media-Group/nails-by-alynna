import { ObjectId } from 'bson';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expireDocuments, UpdateError, type Database, type Document, type UpdateFilter } from '../src/db/pg';
import { isDuplicateKey } from '../src/lib/errors';
import { createTestDatabase } from './helpers';

/**
 * The PostgreSQL adapter writes like MongoDB: every update operator, upserts, duplicate keys as
 * code 11000, atomic conditional updates under concurrency, indexes and TTL expiry.
 */

/** Test documents with readable string ids. */
type Doc = Document & { _id: string };
/** The driver's types only allow $push / $pull on fields declared as arrays; these are ad hoc. */
const loose = (update: Document): UpdateFilter<Doc> => update;

const day = (d: number) => new Date(Date.UTC(2026, 5, d, 9));

let db: Database;
let seq = 0;
/** A fresh collection per test, so tests never see each other's documents. */
const fresh = () => db.collection<Doc>(`c${++seq}`);

beforeAll(() => {
  db = createTestDatabase(12);
});

afterAll(async () => {
  await db.drop();
  await db.close();
});

describe('update operators', () => {
  it('$set writes dotted paths, creating objects on the way', async () => {
    const c = fresh();
    await c.insertOne({ _id: 'a', meta: { keep: 1 } });
    await c.updateOne({ _id: 'a' }, { $set: { 'meta.deep.x': 1, name: 'Ana', 'list.0': 'first' } });
    expect(await c.findOne({ _id: 'a' })).toEqual({ _id: 'a', meta: { keep: 1, deep: { x: 1 } }, name: 'Ana', list: { 0: 'first' } });
    await c.updateOne({ _id: 'a' }, { $set: { tags: ['x', 'y'] } });
    await c.updateOne({ _id: 'a' }, { $set: { 'tags.1': 'z', at: day(2) } });
    expect(await c.findOne({ _id: 'a' }, { projection: { tags: 1, at: 1 } })).toEqual({ _id: 'a', tags: ['x', 'z'], at: day(2) });
    // A path through a value that is not an object is refused, as in MongoDB.
    await expect(c.updateOne({ _id: 'a' }, { $set: { 'name.first': 'A' } })).rejects.toMatchObject({ code: 28 });
  });

  it('$unset removes fields (and leaves missing ones alone)', async () => {
    const c = fresh();
    await c.insertOne({ _id: 'a', x: 1, meta: { a: 1, b: 2 } });
    const res = await c.updateOne({ _id: 'a' }, { $unset: { x: '', 'meta.a': 1, nothing: '' } });
    expect(res).toMatchObject({ matchedCount: 1, modifiedCount: 1 });
    expect(await c.findOne({ _id: 'a' })).toEqual({ _id: 'a', meta: { b: 2 } });
  });

  it('$inc adds (from 0 when missing) and refuses non-numbers', async () => {
    const c = fresh();
    await c.insertOne({ _id: 'a', n: 1, s: 'x' });
    await c.updateOne({ _id: 'a' }, { $inc: { n: 2, fresh: -3, 'deep.count': 1 } });
    expect(await c.findOne({ _id: 'a' })).toMatchObject({ n: 3, fresh: -3, deep: { count: 1 } });
    await expect(c.updateOne({ _id: 'a' }, { $inc: { s: 1 } })).rejects.toMatchObject({ code: 14 });
  });

  it('$min and $max keep the smaller or larger value (numbers and dates)', async () => {
    const c = fresh();
    await c.insertOne({ _id: 'a', low: 5, high: 5, seen: day(5) });
    await c.updateOne({ _id: 'a' }, { $min: { low: 3, missing: 7 }, $max: { high: 4, seen: day(9) } });
    expect(await c.findOne({ _id: 'a' })).toEqual({ _id: 'a', low: 3, high: 5, seen: day(9), missing: 7 });
  });

  it('$push appends (one or $each), creating the array', async () => {
    const c = fresh();
    await c.insertOne({ _id: 'a' });
    await c.updateOne({ _id: 'a' }, loose({ $push: { list: { by: new ObjectId('65f000000000000000000001'), at: day(1) } } }));
    await c.updateOne({ _id: 'a' }, loose({ $push: { list: { $each: [1, 2] } } }));
    const doc = await c.findOne({ _id: 'a' });
    expect(doc?.list).toEqual([{ by: new ObjectId('65f000000000000000000001'), at: day(1) }, 1, 2]);
    await c.updateOne({ _id: 'a' }, { $set: { scalar: 1 } });
    await expect(c.updateOne({ _id: 'a' }, loose({ $push: { scalar: 2 } }))).rejects.toMatchObject({ code: 2 });
  });

  it('$addToSet adds only what is not there yet (objects compare by content)', async () => {
    const c = fresh();
    await c.insertOne({ _id: 'a', set: ['x', { a: 1, b: 2 }] });
    const res = await c.updateOne({ _id: 'a' }, { $addToSet: { set: { $each: ['x', 'y', { b: 2, a: 1 }, 'y'] }, other: 'z' } });
    expect(res.modifiedCount).toBe(1);
    expect((await c.findOne({ _id: 'a' }))?.set).toEqual(['x', { a: 1, b: 2 }, 'y']);
    expect((await c.findOne({ _id: 'a' }))?.other).toEqual(['z']);
    expect((await c.updateOne({ _id: 'a' }, { $addToSet: { set: 'x' } })).modifiedCount).toBe(0);
  });

  it('$pull removes equal values and elements matching a condition', async () => {
    const c = fresh();
    const ann = new ObjectId();
    await c.insertOne({ _id: 'a', tags: ['x', 'y', 'x'], nums: [1, 5, 8], uses: [{ by: ann, at: day(1) }, { by: new ObjectId(), at: day(2) }] });
    await c.updateOne({ _id: 'a' }, loose({ $pull: { tags: 'x', nums: { $gte: 5 }, uses: { by: ann } } }));
    const doc = await c.findOne({ _id: 'a' });
    expect(doc?.tags).toEqual(['y']);
    expect(doc?.nums).toEqual([1]);
    const uses = doc?.uses as Array<{ by: ObjectId }>;
    expect(uses).toHaveLength(1);
    expect(uses[0]!.by.equals(ann)).toBe(false);
  });

  it('$setOnInsert applies only when an upsert inserts', async () => {
    const c = fresh();
    await c.updateOne({ _id: 'a' }, { $set: { n: 1 }, $setOnInsert: { createdAt: day(1) } }, { upsert: true });
    await c.updateOne({ _id: 'a' }, { $set: { n: 2 }, $setOnInsert: { createdAt: day(9) } }, { upsert: true });
    expect(await c.findOne({ _id: 'a' })).toEqual({ _id: 'a', n: 2, createdAt: day(1) });
  });

  it('counts a no-op as matched but not modified', async () => {
    const c = fresh();
    await c.insertOne({ _id: 'a', n: 1, at: day(1) });
    expect(await c.updateOne({ _id: 'a' }, { $set: { n: 1, at: day(1) } })).toMatchObject({ matchedCount: 1, modifiedCount: 0 });
    expect(await c.updateOne({ _id: 'zz' }, { $set: { n: 1 } })).toMatchObject({ matchedCount: 0, modifiedCount: 0, upsertedId: null });
  });

  it('updateMany updates every match and reports it', async () => {
    const c = fresh();
    await c.insertMany([
      { _id: 'a', n: 1, usedAt: null },
      { _id: 'b', n: 2, usedAt: null },
      { _id: 'c', n: 3, usedAt: day(1) },
    ]);
    const res = await c.updateMany({ usedAt: null }, { $set: { usedAt: day(2) }, $inc: { n: 10 } });
    expect(res).toMatchObject({ matchedCount: 2, modifiedCount: 2 });
    expect((await c.find().toArray()).map((d) => d.n)).toEqual([11, 12, 3]);
  });

  it('refuses what MongoDB refuses: replacements, conflicting paths, a changed _id', async () => {
    const c = fresh();
    await c.insertOne({ _id: 'a', n: 1 });
    await expect(c.updateOne({ _id: 'a' }, { n: 2 })).rejects.toThrow(/atomic operators/);
    await expect(c.updateOne({ _id: 'a' }, { $set: { n: 2 }, $inc: { n: 1 } })).rejects.toMatchObject({ code: 40 });
    await expect(c.updateOne({ _id: 'a' }, { $set: { meta: {}, 'meta.x': 1 } })).rejects.toBeInstanceOf(UpdateError);
    await expect(c.updateOne({ _id: 'a' }, { $set: { _id: 'b' } })).rejects.toMatchObject({ code: 66 });
    expect(await c.findOne({ _id: 'a' })).toEqual({ _id: 'a', n: 1 });
  });

  it('applies update pipelines, each stage seeing the document before it', async () => {
    const c = fresh();
    const now = day(5);
    const hit = () =>
      c.findOneAndUpdate(
        { _id: 'ip' },
        [
          {
            $set: {
              count: { $cond: [{ $gt: ['$expiresAt', now] }, { $add: ['$count', 1] }, 1] },
              expiresAt: { $cond: [{ $gt: ['$expiresAt', now] }, '$expiresAt', day(6)] },
            },
          },
        ],
        { upsert: true, returnDocument: 'after' },
      );
    expect(await hit()).toEqual({ _id: 'ip', count: 1, expiresAt: day(6) });
    expect(await hit()).toEqual({ _id: 'ip', count: 2, expiresAt: day(6) });
    await c.updateOne({ _id: 'ip' }, { $set: { expiresAt: day(4) } }); // the window ended
    expect(await hit()).toEqual({ _id: 'ip', count: 1, expiresAt: day(6) });
  });
});

describe('upserts and find-and-modify', () => {
  it('builds the new document from the filter equalities, then the update', async () => {
    const c = fresh();
    const res = await c.updateOne({ _id: 'u1', kind: 'x', 'meta.tier': { $eq: 2 }, n: { $gt: 5 } }, { $set: { v: 1 } }, { upsert: true });
    expect(res).toMatchObject({ matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: 'u1' });
    expect(await c.findOne({ _id: 'u1' })).toEqual({ _id: 'u1', kind: 'x', meta: { tier: 2 }, v: 1 });
    const again = await c.updateOne({ _id: 'u1', kind: 'x' }, { $set: { v: 2 } }, { upsert: true });
    expect(again).toMatchObject({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null });
  });

  it('gives an upserted document without _id an ObjectId', async () => {
    const people = db.collection(`c${++seq}`);
    const res = await people.updateMany({ email: 'a@b.md' }, { $set: { name: 'Ana' } }, { upsert: true });
    expect(res.upsertedId).toBeInstanceOf(ObjectId);
    expect(await people.findOne({ _id: res.upsertedId! })).toMatchObject({ email: 'a@b.md', name: 'Ana' });
  });

  it('returns the document before or after, sorted and projected', async () => {
    const c = fresh();
    await c.insertMany([
      { _id: 'a', rank: 2, n: 0 },
      { _id: 'b', rank: 1, n: 0 },
    ]);
    const before = await c.findOneAndUpdate({}, { $inc: { n: 1 } }, { sort: { rank: 1 } });
    expect(before).toEqual({ _id: 'b', rank: 1, n: 0 });
    const after = await c.findOneAndUpdate({ _id: 'b' }, { $inc: { n: 1 } }, { returnDocument: 'after', projection: { n: 1 } });
    expect(after).toEqual({ _id: 'b', n: 2 });
    expect(await c.findOneAndUpdate({ _id: 'none' }, { $inc: { n: 1 } })).toBeNull();
    expect(await c.findOneAndUpdate({ _id: 'new' }, { $inc: { n: 1 } }, { upsert: true })).toBeNull(); // no "before"
    expect(await c.findOneAndUpdate({ _id: 'new2' }, { $inc: { n: 1 } }, { upsert: true, returnDocument: 'after' })).toEqual({ _id: 'new2', n: 1 });
  });

  it('deletes one (conditionally), many, or one and returns it', async () => {
    const c = fresh();
    await c.insertMany([
      { _id: 'a', group: 1, uses: [] },
      { _id: 'b', group: 1, uses: ['x'] },
      { _id: 'c', group: 2, uses: [] },
    ]);
    expect(await c.findOneAndDelete({ _id: 'b', uses: { $size: 0 } })).toBeNull();
    expect(await c.findOneAndDelete({ group: 1 }, { sort: { _id: -1 } })).toMatchObject({ _id: 'b' });
    expect((await c.deleteOne({ group: 1 })).deletedCount).toBe(1);
    expect((await c.deleteMany({ group: { $in: [1, 2] } })).deletedCount).toBe(1);
    expect(await c.countDocuments()).toBe(0);
  });

  it('runs bulk writes in order', async () => {
    const c = fresh();
    await c.insertMany([
      { _id: 'a', order: 2 },
      { _id: 'b', order: 1 },
    ]);
    const summary = await c.bulkWrite([
      { updateOne: { filter: { _id: 'b' }, update: { $set: { order: 2 }, $addToSet: { customized: 'order' } } } },
      { updateOne: { filter: { _id: 'a' }, update: { $set: { order: 1 } } } },
      { insertOne: { document: { _id: 'c', order: 3 } } },
      { deleteOne: { filter: { _id: 'nope' } } },
    ]);
    expect(summary).toMatchObject({ matchedCount: 2, modifiedCount: 2, insertedCount: 1, deletedCount: 0 });
    expect((await c.find().sort({ order: 1 }).toArray()).map((d) => d._id)).toEqual(['a', 'b', 'c']);
  });
});

describe('unique indexes', () => {
  it('raise code 11000 for a duplicate, whatever the operation', async () => {
    const c = fresh();
    await c.createIndexes([{ key: { email: 1 }, unique: true, name: 'email_unique' }]);
    await c.insertOne({ _id: 'a', email: 'a@b.md' });
    await c.insertOne({ _id: 'b', email: 'c@d.md' });
    const insert = await c.insertOne({ _id: 'c', email: 'a@b.md' }).catch((error: unknown) => error);
    expect(isDuplicateKey(insert)).toBe(true);
    expect(insert).toMatchObject({ code: 11000, index: 'email_unique' });
    await expect(c.insertOne({ _id: 'a', email: 'new@b.md' })).rejects.toMatchObject({ code: 11000, index: '_id_' });
    await expect(c.updateOne({ _id: 'b' }, { $set: { email: 'a@b.md' } })).rejects.toMatchObject({ code: 11000 });
    await expect(c.insertMany([{ _id: 'd', email: 'x@y.md' }, { _id: 'e', email: 'x@y.md' }])).rejects.toMatchObject({ code: 11000 });
    expect(await c.countDocuments()).toBe(2); // insertMany is all or nothing
  });

  it('only cover the documents a partial index selects', async () => {
    const c = fresh();
    await c.createIndexes([{ key: { googleId: 1 }, unique: true, name: 'google_unique', partialFilterExpression: { googleId: { $type: 'string' } } }]);
    await c.insertMany([
      { _id: 'a', googleId: null },
      { _id: 'b', googleId: null },
      { _id: 'c' },
      { _id: 'd', googleId: 'g-1' },
    ]);
    await expect(c.insertOne({ _id: 'e', googleId: 'g-1' })).rejects.toMatchObject({ code: 11000, index: 'google_unique' });
  });
});

describe('concurrency', () => {
  it('lets exactly one of many simultaneous conditional updates claim a document', async () => {
    const c = fresh();
    await c.insertOne({ _id: 'job', owner: null });
    const claims = await Promise.all(
      Array.from({ length: 25 }, (_, i) => c.findOneAndUpdate({ _id: 'job', owner: null }, { $set: { owner: i } }, { returnDocument: 'after' })),
    );
    const winners = claims.filter((doc) => doc !== null);
    expect(winners).toHaveLength(1);
    expect(await c.findOne({ _id: 'job' })).toEqual({ _id: 'job', owner: winners[0]!.owner });
  });

  it('never counts past a limit (attempt counters)', async () => {
    const c = fresh();
    await c.insertOne({ _id: 'otp', attempts: 0, usedAt: null });
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        c.findOneAndUpdate({ _id: 'otp', usedAt: null, attempts: { $lt: 5 } }, { $inc: { attempts: 1 } }, { returnDocument: 'after' }),
      ),
    );
    expect(results.filter(Boolean).map((doc) => doc!.attempts).sort()).toEqual([1, 2, 3, 4, 5]);
    expect((await c.findOne({ _id: 'otp' }))?.attempts).toBe(5);
  });

  it('re-checks $expr under the lock: a limited list never overfills', async () => {
    const c = fresh();
    await c.insertOne({ _id: 'promo', maxUses: 3, uses: [] });
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        c.updateOne(
          { _id: 'promo', 'uses.id': { $ne: i }, $expr: { $lt: [{ $size: '$uses' }, '$maxUses'] } },
          loose({ $push: { uses: { id: i, at: day(1) } } }),
        ),
      ),
    );
    expect(results.reduce((sum, r) => sum + r.modifiedCount, 0)).toBe(3);
    expect((await c.findOne({ _id: 'promo' }))?.uses).toHaveLength(3);
  });

  it('serialises simultaneous upserts of one document', async () => {
    const c = fresh();
    const counts = await Promise.all(
      Array.from({ length: 20 }, () =>
        c.findOneAndUpdate({ _id: 'hits' }, [{ $set: { n: { $add: [{ $ifNull: ['$n', 0] }, 1] } } }], { upsert: true, returnDocument: 'after' }),
      ),
    );
    expect(counts.map((doc) => doc!.n).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await c.countDocuments()).toBe(1);
  });
});

describe('indexes and TTL', () => {
  const indexes = async (table: string) =>
    (
      await db.query<{ indexname: string; indexdef: string }>('SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname', [
        db.schema,
        table,
      ])
    ).rows;

  it('become PostgreSQL expression indexes (unique, compound, partial), rebuilt when the spec changes', async () => {
    const c = fresh();
    await c.createIndexes([
      { key: { role: 1, createdAt: -1 }, name: 'role_created' },
      { key: { 'promo.promoId': 1 }, name: 'promo', partialFilterExpression: { 'promo.promoId': { $exists: true } } },
    ]);
    const defs = await indexes(c.collectionName);
    expect(defs.map((i) => i.indexname)).toEqual([`${c.collectionName}_pkey`, `${c.collectionName}_promo`, `${c.collectionName}_role_created`]);
    expect(defs.find((i) => i.indexname.endsWith('_promo'))?.indexdef).toMatch(/WHERE \(\(\(doc -> 'promo'::text\) -> 'promoId'::text\) IS NOT NULL\)/);
    expect(defs.find((i) => i.indexname.endsWith('_role_created'))?.indexdef).toMatch(/\(\(doc -> 'role'::text\)\) NULLS FIRST, \(\(doc -> 'createdAt'::text\)\) DESC NULLS LAST/);
    // Same name, new spec: the index is rebuilt (here: made unique).
    await c.createIndexes([{ key: { role: 1, createdAt: -1 }, name: 'role_created', unique: true }]);
    expect((await indexes(c.collectionName)).find((i) => i.indexname.endsWith('_role_created'))?.indexdef).toMatch(/^CREATE UNIQUE INDEX/);
  });

  it('expire dated documents the way MongoDB TTL indexes do', async () => {
    const sessions = fresh();
    const logs = fresh();
    await sessions.createIndexes([{ key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'ttl' }]);
    await logs.createIndexes([{ key: { at: 1 }, expireAfterSeconds: 3600, name: 'ttl' }]);
    const now = new Date('2026-06-05T12:00:00Z');
    const minutes = (m: number) => new Date(now.getTime() + m * 60_000);
    await sessions.insertMany([
      { _id: 'expired', expiresAt: minutes(-1) },
      { _id: 'valid', expiresAt: minutes(1) },
      { _id: 'no-date', expiresAt: 'soon' },
      { _id: 'missing' },
    ]);
    await logs.insertMany([
      { _id: 'old', at: minutes(-61) },
      { _id: 'recent', at: minutes(-59) },
    ]);
    expect(await expireDocuments(db, now)).toBe(2);
    expect((await sessions.find().toArray()).map((d) => d._id)).toEqual(['valid', 'no-date', 'missing']);
    expect((await logs.find().toArray()).map((d) => d._id)).toEqual(['recent']);
  });
});
