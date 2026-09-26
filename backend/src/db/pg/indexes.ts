import { fieldPath } from './codec';
import type { Database } from './database';
import { translateError, UnsupportedError } from './errors';
import { indexPredicateSql } from './filter';
import { jsonPath, quoteIdent, quoteLiteral } from './sql';
import type { IndexDescription } from './types';

/**
 * MongoDB index specs as PostgreSQL expression indexes on `doc` (partial filters become WHERE
 * clauses). Each index keeps its spec as a comment, so a changed spec rebuilds it and the TTL
 * monitor can find the TTL indexes (expireAfterSeconds): it deletes expired documents every
 * minute, as MongoDB's TTL task does.
 */

interface IndexMeta {
  key: Record<string, number>;
  unique: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: unknown;
}

const defaultName = (key: Record<string, number>) => Object.entries(key).map(([field, dir]) => `${field}_${dir}`).join('_');

export async function createIndexes(db: Database, collection: string, specs: IndexDescription[]): Promise<string[]> {
  await db.ensureCollection(collection);
  const names: string[] = [];
  for (const spec of specs) {
    const key = (spec.key instanceof Map ? Object.fromEntries(spec.key) : spec.key) as Record<string, number>;
    const name = spec.name ?? defaultName(key);
    const columns = Object.entries(key).map(([path, direction]) => {
      if (direction !== 1 && direction !== -1) throw new UnsupportedError(`index type ${JSON.stringify(direction)}`);
      // NULLS FIRST/LAST as in the sorts, so an index also serves ORDER BY in both directions.
      return `(${jsonPath('doc', fieldPath(path))}) ${direction === 1 ? 'ASC NULLS FIRST' : 'DESC NULLS LAST'}`;
    });
    if (spec.expireAfterSeconds !== undefined && columns.length !== 1) throw new Error('A TTL index has exactly one field');
    const meta: IndexMeta = {
      key,
      unique: spec.unique === true,
      expireAfterSeconds: spec.expireAfterSeconds,
      partialFilterExpression: spec.partialFilterExpression,
    };
    const comment = JSON.stringify(meta);
    const indexName = `${collection}_${name}`;
    const qualified = db.table(indexName);
    const { rows } = await db.query<{ comment: string | null; present: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS present, obj_description(to_regclass($1), 'pg_class') AS comment`,
      [qualified],
    );
    if (rows[0]?.present && rows[0].comment === comment) {
      names.push(name);
      continue;
    }
    if (rows[0]?.present) await db.query(`DROP INDEX IF EXISTS ${qualified}`);
    const where = spec.partialFilterExpression ? ` WHERE ${indexPredicateSql(spec.partialFilterExpression)}` : '';
    try {
      await db.query(
        `CREATE ${meta.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${quoteIdent(indexName)} ON ${db.table(collection)} (${columns.join(', ')})${where}`,
      );
    } catch (error) {
      // Another process created it at the same moment (a duplicate in the data still throws).
      const { code, constraint } = error as { code?: string; constraint?: string };
      if (code !== '42P07' && constraint !== 'pg_class_relname_nsp_index') throw translateError(error, collection);
    }
    await db.query(`COMMENT ON INDEX ${qualified} IS ${quoteLiteral(comment)}`);
    names.push(name);
  }
  return names;
}

/** Deletes documents whose TTL index date is older than its expireAfterSeconds; returns how many. */
export async function expireDocuments(db: Database, now: Date = new Date()): Promise<number> {
  const { rows } = await db.query<{ table_name: string; comment: string }>(
    `SELECT t.relname AS table_name, obj_description(i.oid, 'pg_class') AS comment
       FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = COALESCE($1::text, current_schema())
        AND obj_description(i.oid, 'pg_class') LIKE '%"expireAfterSeconds":%'`,
    [db.schema ?? null],
  );
  let removed = 0;
  for (const row of rows) {
    const meta = JSON.parse(row.comment) as IndexMeta;
    const x = jsonPath('doc', fieldPath(Object.keys(meta.key)[0]!));
    const cutoff = new Date(now.getTime() - (meta.expireAfterSeconds ?? 0) * 1000);
    // Only dates expire (as in MongoDB); the comparison uses the index on the field.
    const result = await db.query(`DELETE FROM ${db.table(row.table_name)} WHERE jsonb_typeof(${x}) = 'object' AND ${x} ? '$date' AND ${x} < $1::jsonb`, [
      JSON.stringify({ $date: cutoff.toISOString() }),
    ]);
    removed += result.rowCount ?? 0;
  }
  return removed;
}

/** Runs expireDocuments now and every `intervalMs`; returns a stop function. */
export function startTtlMonitor(db: Database, intervalMs = 60_000): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    expireDocuments(db)
      .catch((error: unknown) => console.error(`[db] TTL cleanup failed: ${(error as Error).message}`))
      .finally(() => {
        running = false;
      });
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
