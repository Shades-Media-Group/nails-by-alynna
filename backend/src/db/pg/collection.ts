import { ObjectId } from 'bson';
import { runPipeline } from './aggregate';
import { canonicalKey, decode, encode, fieldPath, idKey, queryValues, valuesEqual, type Json, type JsonObject } from './codec';
import type { Database } from './database';
import { isRetryable, pgCode, translateError, UnsupportedError } from './errors';
import { filterToSql } from './filter';
import { createIndexes } from './indexes';
import { project } from './projection';
import { jsonPath, Params } from './sql';
import type {
  AnyBulkWriteOperation,
  CountDocumentsOptions,
  DeleteResult,
  Document,
  Filter,
  FindOneAndDeleteOptions,
  FindOneAndUpdateOptions,
  FindOptions,
  Flatten,
  IndexDescription,
  InferIdType,
  InsertManyResult,
  InsertOneResult,
  OptionalUnlessRequiredId,
  Sort,
  UpdateFilter,
  UpdateOptions,
  UpdateResult,
  WithId,
} from './types';
import { applyUpdate, assertUpdate, upsertSeed } from './update';

/**
 * One MongoDB-style collection in one table: `id` (the `_id` as text, primary key), `doc` (the
 * whole document as JSONB, `_id` included) and `seq` (insertion order: MongoDB's "natural order",
 * and the tie-break of every sort, so results never depend on how PostgreSQL stored the rows).
 *
 * Reads are single statements. Updates lock the matching rows (SELECT … FOR UPDATE), apply the
 * operators in JS and write the documents back in the same transaction; under READ COMMITTED
 * PostgreSQL re-checks the filter against a row another transaction changed meanwhile, so a
 * conditional update ("only while attempts < 5") can be claimed only once.
 */

interface ReadOptions {
  sort?: Sort;
  skip?: number;
  limit?: number;
  projection?: Document;
}

// ── Sorting ──────────────────────────────────────────────────────────────────────

function direction(value: unknown): 1 | -1 {
  if (value === 1 || value === 'asc' || value === 'ascending') return 1;
  if (value === -1 || value === 'desc' || value === 'descending') return -1;
  throw new UnsupportedError(`sort direction ${JSON.stringify(value)}`);
}

function sortKeys(sort: Sort | undefined): Array<[string, 1 | -1]> {
  if (sort === undefined || sort === null) return [];
  if (typeof sort === 'string') return [[sort, 1]];
  if (sort instanceof Map) return [...sort].map(([path, dir]) => [path, direction(dir)]);
  if (Array.isArray(sort)) {
    if (sort.length === 2 && typeof sort[0] === 'string' && !Array.isArray(sort[1]) && typeof sort[1] !== 'string') {
      return [[sort[0], direction(sort[1])]];
    }
    return sort.map((item) => (Array.isArray(item) ? [String(item[0]), direction(item[1])] : [String(item), 1]));
  }
  if (typeof sort === 'object') return Object.entries(sort).map(([path, dir]) => [path, direction(dir)]);
  throw new UnsupportedError(`sort ${JSON.stringify(sort)}`);
}

/**
 * Missing and null first when ascending, last when descending, as in MongoDB. Ties follow
 * insertion order in the direction of the first key (newest first for `{at: -1}`), which is
 * what MongoDB gives when it walks an index on that field.
 */
function orderBy(sort: Sort | undefined): string {
  const keys = sortKeys(sort);
  const columns = keys.map(([path, dir]) => `${jsonPath('doc', fieldPath(path))} ${dir === 1 ? 'ASC NULLS FIRST' : 'DESC NULLS LAST'}`);
  return [...columns, keys[0]?.[1] === -1 ? 'seq DESC' : 'seq'].join(', ');
}

function assertOptions(options: object | undefined): void {
  for (const option of ['collation', 'arrayFilters', 'hint'] as const) {
    if (options && option in options && (options as Record<string, unknown>)[option] !== undefined) throw new UnsupportedError(`the ${option} option`);
  }
}

// ── Cursors ──────────────────────────────────────────────────────────────────────

export class FindCursor<T> {
  private readonly options: ReadOptions;
  private buffer: T[] | null = null;

  constructor(
    private readonly read: (options: ReadOptions) => Promise<unknown[]>,
    options: ReadOptions,
  ) {
    this.options = { ...options };
  }

  sort(sort: Sort): this {
    this.options.sort = sort;
    return this;
  }

  limit(limit: number): this {
    this.options.limit = limit;
    return this;
  }

  skip(skip: number): this {
    this.options.skip = skip;
    return this;
  }

  project<P extends Document = Document>(projection: Document): FindCursor<P> {
    this.options.projection = projection;
    return this as unknown as FindCursor<P>;
  }

  async toArray(): Promise<T[]> {
    return (await this.read(this.options)) as T[];
  }

  async next(): Promise<T | null> {
    this.buffer ??= await this.toArray();
    return this.buffer.shift() ?? null;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    yield* await this.toArray();
  }
}

export class AggregationCursor<T> {
  constructor(private readonly run: () => Promise<unknown[]>) {}

  async toArray(): Promise<T[]> {
    return (await this.run()) as T[];
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    yield* await this.toArray();
  }
}

export interface BulkWriteSummary {
  insertedCount: number;
  matchedCount: number;
  modifiedCount: number;
  deletedCount: number;
  upsertedCount: number;
  insertedIds: Record<number, unknown>;
  upsertedIds: Record<number, unknown>;
}

interface Modified {
  matched: number;
  modified: number;
  before: JsonObject | null;
  after: JsonObject | null;
  upsertedId: Json | null;
}

/** An upsert lost the race to insert its document: run the whole update again (it now matches). */
class UpsertRace extends Error {
  constructor(readonly original: unknown) {
    super('upsert conflict');
  }
}

// ── The collection ───────────────────────────────────────────────────────────────

export class Collection<TSchema extends Document = Document> {
  constructor(
    private readonly db: Database,
    readonly collectionName: string,
  ) {}

  private get table(): string {
    return this.db.table(this.collectionName);
  }

  /** Runs `work` once the table exists; unique violations come out as DuplicateKeyError (11000). */
  private async run<R>(work: () => Promise<R>): Promise<R> {
    await this.db.ensureCollection(this.collectionName);
    try {
      return await work();
    } catch (error) {
      throw translateError(error instanceof UpsertRace ? error.original : error, this.collectionName);
    }
  }

  private read(filter: Document | undefined, options: ReadOptions): Promise<unknown[]> {
    return this.run(async () => {
      const p = new Params();
      let sql = `SELECT doc FROM ${this.table} WHERE ${filterToSql(filter, p)} ORDER BY ${orderBy(options.sort)}`;
      if (options.limit) sql += ` LIMIT ${p.add(Math.abs(options.limit))}`;
      if (options.skip) sql += ` OFFSET ${p.add(options.skip)}`;
      const { rows } = await this.db.query<{ doc: JsonObject }>(sql, p.values);
      return rows.map((row) => decode(project(row.doc, options.projection)));
    });
  }

  async findOne(filter?: Filter<TSchema>, options?: FindOptions): Promise<WithId<TSchema> | null> {
    assertOptions(options);
    const [doc] = await this.read(filter, { ...options, limit: 1 });
    return (doc as WithId<TSchema> | undefined) ?? null;
  }

  find(filter?: Filter<TSchema>, options?: FindOptions): FindCursor<WithId<TSchema>> {
    assertOptions(options);
    return new FindCursor((cursorOptions) => this.read(filter, cursorOptions), options ?? {});
  }

  async countDocuments(filter?: Filter<TSchema>, options?: CountDocumentsOptions): Promise<number> {
    return this.run(async () => {
      const p = new Params();
      let matched = `SELECT 1 FROM ${this.table} WHERE ${filterToSql(filter, p)}`;
      if (options?.limit) matched += ` LIMIT ${p.add(options.limit)}`;
      if (options?.skip) matched += ` OFFSET ${p.add(options.skip)}`;
      const { rows } = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${matched}) AS matched`, p.values);
      return rows[0]!.n;
    });
  }

  /** Distinct values of a field; array values count element by element, missing ones not at all. */
  distinct<Key extends keyof WithId<TSchema>>(key: Key, filter?: Filter<TSchema>): Promise<Array<Flatten<WithId<TSchema>[Key]>>>;
  distinct(key: string, filter?: Filter<TSchema>): Promise<unknown[]>;
  async distinct(key: string | number | symbol, filter?: Filter<TSchema>): Promise<unknown[]> {
    const parts = fieldPath(String(key));
    const rows = await this.run(async () => {
      const p = new Params();
      const sql = `SELECT doc FROM ${this.table} WHERE ${filterToSql(filter, p)} ORDER BY seq`;
      return (await this.db.query<{ doc: JsonObject }>(sql, p.values)).rows;
    });
    const values = new Map<string, Json>();
    for (const { doc } of rows) {
      for (const value of queryValues(doc, parts)) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) if (!values.has(canonicalKey(item))) values.set(canonicalKey(item), item);
      }
    }
    return [...values.values()].map(decode);
  }

  /** Like the driver, gives the document an ObjectId `_id` when it has none. */
  async insertOne(doc: OptionalUnlessRequiredId<TSchema>): Promise<InsertOneResult<TSchema>> {
    const target = doc as Document;
    target._id ??= new ObjectId();
    const json = encode(target) as JsonObject;
    await this.run(() => this.db.query(`INSERT INTO ${this.table} (id, doc) VALUES ($1, $2::jsonb)`, [idKey(json._id), JSON.stringify(json)]));
    return { acknowledged: true, insertedId: target._id as InferIdType<TSchema> };
  }

  /** One statement: all documents are inserted, or none. */
  async insertMany(docs: ReadonlyArray<OptionalUnlessRequiredId<TSchema>>): Promise<InsertManyResult<TSchema>> {
    const targets = docs as ReadonlyArray<Document>;
    const encoded = targets.map((target) => {
      target._id ??= new ObjectId();
      return encode(target) as JsonObject;
    });
    if (encoded.length > 0) {
      await this.run(() =>
        this.db.query(`INSERT INTO ${this.table} (id, doc) SELECT * FROM unnest($1::text[], $2::jsonb[])`, [
          encoded.map((json) => idKey(json._id)),
          encoded.map((json) => JSON.stringify(json)),
        ]),
      );
    }
    const insertedIds = Object.fromEntries(targets.map((target, index) => [index, target._id])) as InsertManyResult<TSchema>['insertedIds'];
    return { acknowledged: true, insertedCount: targets.length, insertedIds };
  }

  private modify(filter: Document, update: Document | Document[], options: { multi: boolean; upsert?: boolean; sort?: Sort }): Promise<Modified> {
    assertUpdate(update);
    const locate = (p: Params) =>
      `SELECT id, doc FROM ${this.table} WHERE ${filterToSql(filter, p)} ` +
      // Many rows are locked in id order, so two updates of overlapping sets cannot deadlock.
      `ORDER BY ${options.multi ? 'id' : orderBy(options.sort)}${options.multi ? '' : ' LIMIT 1'} FOR UPDATE`;
    return this.run(() =>
      this.db.transaction(
        async (client): Promise<Modified> => {
          const p = new Params();
          const { rows } = await client.query<{ id: string; doc: JsonObject }>(locate(p), p.values);
          if (rows.length === 0) {
            if (!options.upsert) return { matched: 0, modified: 0, before: null, after: null, upsertedId: null };
            const doc = applyUpdate(upsertSeed(filter), update, true);
            doc._id ??= encode(new ObjectId());
            try {
              await client.query(`INSERT INTO ${this.table} (id, doc) VALUES ($1, $2::jsonb)`, [idKey(doc._id), JSON.stringify(doc)]);
            } catch (error) {
              throw pgCode(error) === '23505' ? new UpsertRace(error) : error;
            }
            return { matched: 0, modified: 0, before: null, after: doc, upsertedId: doc._id };
          }
          const updated = rows.map((row) => ({ id: row.id, before: row.doc, after: applyUpdate(row.doc, update, false) }));
          const changed = updated.filter((row) => !valuesEqual(row.before, row.after));
          if (changed.length > 0) {
            await client.query(`UPDATE ${this.table} AS t SET doc = u.doc FROM unnest($1::text[], $2::jsonb[]) AS u(id, doc) WHERE t.id = u.id`, [
              changed.map((row) => row.id),
              changed.map((row) => JSON.stringify(row.after)),
            ]);
          }
          const first = updated[0]!;
          return { matched: rows.length, modified: changed.length, before: first.before, after: first.after, upsertedId: null };
        },
        (error) => isRetryable(error) || error instanceof UpsertRace,
      ),
    );
  }

  private static updateResult<T extends Document>(result: Modified): UpdateResult<T> {
    return {
      acknowledged: true,
      matchedCount: result.matched,
      modifiedCount: result.modified,
      upsertedCount: result.upsertedId === null ? 0 : 1,
      upsertedId: (result.upsertedId === null ? null : decode(result.upsertedId)) as UpdateResult<T>['upsertedId'],
    };
  }

  async updateOne(filter: Filter<TSchema>, update: UpdateFilter<TSchema> | Document[], options?: UpdateOptions): Promise<UpdateResult<TSchema>> {
    assertOptions(options);
    return Collection.updateResult(await this.modify(filter, update, { multi: false, upsert: options?.upsert }));
  }

  async updateMany(filter: Filter<TSchema>, update: UpdateFilter<TSchema> | Document[], options?: UpdateOptions): Promise<UpdateResult<TSchema>> {
    assertOptions(options);
    return Collection.updateResult(await this.modify(filter, update, { multi: true, upsert: options?.upsert }));
  }

  /** The document before the update (default) or after it (`returnDocument: 'after'`), or null. */
  async findOneAndUpdate(
    filter: Filter<TSchema>,
    update: UpdateFilter<TSchema> | Document[],
    options?: FindOneAndUpdateOptions,
  ): Promise<WithId<TSchema> | null> {
    assertOptions(options);
    if (options?.includeResultMetadata) throw new UnsupportedError('includeResultMetadata');
    const result = await this.modify(filter, update, { multi: false, upsert: options?.upsert, sort: options?.sort });
    const doc = options?.returnDocument === 'after' ? result.after : result.before;
    return doc ? (decode(project(doc, options?.projection)) as WithId<TSchema>) : null;
  }

  private deleteSql(filter: Document | undefined, p: Params, sort?: Sort): string {
    return (
      `WITH target AS (SELECT id FROM ${this.table} WHERE ${filterToSql(filter, p)} ORDER BY ${orderBy(sort)} LIMIT 1 FOR UPDATE) ` +
      `DELETE FROM ${this.table} AS t USING target WHERE t.id = target.id RETURNING t.doc`
    );
  }

  async findOneAndDelete(filter: Filter<TSchema>, options?: FindOneAndDeleteOptions): Promise<WithId<TSchema> | null> {
    assertOptions(options);
    if (options?.includeResultMetadata) throw new UnsupportedError('includeResultMetadata');
    const p = new Params();
    const sql = this.deleteSql(filter, p, options?.sort);
    const { rows } = await this.run(() => this.db.query<{ doc: JsonObject }>(sql, p.values));
    return rows[0] ? (decode(project(rows[0].doc, options?.projection)) as WithId<TSchema>) : null;
  }

  async deleteOne(filter?: Filter<TSchema>): Promise<DeleteResult> {
    const p = new Params();
    const sql = this.deleteSql(filter, p);
    const { rowCount } = await this.run(() => this.db.query(sql, p.values));
    return { acknowledged: true, deletedCount: rowCount ?? 0 };
  }

  async deleteMany(filter?: Filter<TSchema>): Promise<DeleteResult> {
    const p = new Params();
    const sql = `DELETE FROM ${this.table} WHERE ${filterToSql(filter, p)}`;
    const { rowCount } = await this.run(() => this.db.query(sql, p.values));
    return { acknowledged: true, deletedCount: rowCount ?? 0 };
  }

  /** A leading $match runs as SQL; the other stages run in JS (see aggregate.ts). */
  aggregate<T extends Document = Document>(pipeline: Document[] = []): AggregationCursor<T> {
    return new AggregationCursor<T>(async () => {
      const [first, ...rest] = pipeline;
      const leading = first !== undefined && Object.keys(first).length === 1 && '$match' in first;
      const docs = await this.run(async () => {
        const p = new Params();
        const sql = `SELECT doc FROM ${this.table} WHERE ${filterToSql(leading ? first.$match : undefined, p)} ORDER BY seq`;
        return (await this.db.query<{ doc: JsonObject }>(sql, p.values)).rows.map((row) => row.doc);
      });
      return runPipeline(docs, leading ? rest : pipeline).map(decode);
    });
  }

  /** Ordered: each operation runs (atomically) in turn, and the first error stops the rest. */
  async bulkWrite(operations: ReadonlyArray<AnyBulkWriteOperation<TSchema>>): Promise<BulkWriteSummary> {
    const summary: BulkWriteSummary = { insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0, insertedIds: {}, upsertedIds: {} };
    const count = (index: number, result: UpdateResult<TSchema>) => {
      summary.matchedCount += result.matchedCount;
      summary.modifiedCount += result.modifiedCount;
      summary.upsertedCount += result.upsertedCount;
      if (result.upsertedId !== null) summary.upsertedIds[index] = result.upsertedId;
    };
    for (const [index, operation] of operations.entries()) {
      if ('insertOne' in operation) {
        summary.insertedIds[index] = (await this.insertOne(operation.insertOne.document as OptionalUnlessRequiredId<TSchema>)).insertedId;
        summary.insertedCount++;
      } else if ('updateOne' in operation) {
        const { filter, update, upsert } = operation.updateOne;
        count(index, await this.updateOne(filter, update, { upsert }));
      } else if ('updateMany' in operation) {
        const { filter, update, upsert } = operation.updateMany;
        count(index, await this.updateMany(filter, update, { upsert }));
      } else if ('deleteOne' in operation) {
        summary.deletedCount += (await this.deleteOne(operation.deleteOne.filter)).deletedCount;
      } else if ('deleteMany' in operation) {
        summary.deletedCount += (await this.deleteMany(operation.deleteMany.filter)).deletedCount;
      } else {
        throw new UnsupportedError(`bulkWrite ${Object.keys(operation)[0]}`);
      }
    }
    return summary;
  }

  createIndexes(specs: IndexDescription[]): Promise<string[]> {
    return createIndexes(this.db, this.collectionName, specs);
  }
}
