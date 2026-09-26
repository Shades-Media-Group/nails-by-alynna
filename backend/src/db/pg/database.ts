import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { Collection } from './collection';
import { isRetryable, pgCode } from './errors';
import { quoteIdent } from './sql';
import type { Document } from './types';

export interface DatabaseOptions {
  /** postgres://user:password@host:5432/database */
  url: string;
  poolSize?: number;
  /** Keep the tables in this schema (created on first use) instead of the default one; tests use one each. */
  schema?: string;
}

/** Collection and schema names become SQL identifiers (index names add up to 63 characters). */
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,47}$/;

/** SQLSTATEs of "it already exists" when two processes create the same table or schema at once. */
const ALREADY_EXISTS = ['23505', '42P06', '42P07'];

/**
 * The PostgreSQL side of the adapter: a `pg` connection pool, one table per collection (created
 * on first use, like a MongoDB collection) and transactions for updates.
 */
export class Database {
  readonly pool: Pool;
  readonly schema: string | undefined;
  private readonly tables = new Map<string, Promise<void>>();
  private schemaReady: Promise<void> | null = null;

  constructor(options: DatabaseOptions) {
    if (options.schema !== undefined && !NAME.test(options.schema)) throw new Error(`Invalid schema name "${options.schema}"`);
    this.schema = options.schema;
    this.pool = new Pool({
      connectionString: options.url,
      max: options.poolSize ?? 10,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 60_000,
      application_name: 'nails-by-alynna',
    });
    // A connection the server dropped while idle must not crash the process; the pool replaces it.
    this.pool.on('error', (error) => console.error(`[db] idle connection lost: ${error.message}`));
  }

  collection<T extends Document = Document>(name: string): Collection<T> {
    if (!NAME.test(name)) throw new Error(`Invalid collection name "${name}"`);
    return new Collection<T>(this, name);
  }

  /** The quoted, schema-qualified name of a collection's table (or of an index). */
  table(name: string): string {
    return this.schema ? `${quoteIdent(this.schema)}.${quoteIdent(name)}` : quoteIdent(name);
  }

  query<R extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> {
    return this.pool.query<R>(sql, params);
  }

  /** Creates the collection's table on first use in this process. */
  ensureCollection(name: string): Promise<void> {
    let ready = this.tables.get(name);
    if (!ready) {
      ready = this.createTable(name).catch((error: unknown) => {
        this.tables.delete(name);
        throw error;
      });
      this.tables.set(name, ready);
    }
    return ready;
  }

  private async createTable(name: string): Promise<void> {
    if (this.schema) {
      this.schemaReady ??= this.createIfMissing(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(this.schema)}`).catch((error: unknown) => {
        this.schemaReady = null;
        throw error;
      });
      await this.schemaReady;
    }
    // id: the _id as text; doc: the document, _id included; seq: insertion ("natural") order.
    await this.createIfMissing(`CREATE TABLE IF NOT EXISTS ${this.table(name)} (id text PRIMARY KEY, doc jsonb NOT NULL, seq bigserial NOT NULL)`);
  }

  private async createIfMissing(sql: string): Promise<void> {
    try {
      await this.pool.query(sql);
    } catch (error) {
      if (!ALREADY_EXISTS.includes(pgCode(error) ?? '')) throw error;
    }
  }

  /**
   * Runs `work` in a READ COMMITTED transaction on one connection. Rows it locks with
   * SELECT … FOR UPDATE stay locked until it returns. Runs again (up to 5 times) after a
   * deadlock or when `retry` says so.
   */
  async transaction<T>(work: (client: PoolClient) => Promise<T>, retry: (error: unknown) => boolean = isRetryable): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const client = await this.pool.connect();
      let broken = false;
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {
          broken = true;
        });
        if (attempt >= 5 || !retry(error)) throw error;
      } finally {
        client.release(broken);
      }
    }
  }

  /** Health check. */
  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  /** Removes the dedicated schema and everything in it (tests); refuses without one. */
  async drop(): Promise<void> {
    if (!this.schema) throw new Error('drop() removes a dedicated schema, and this database has none');
    await this.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(this.schema)} CASCADE`);
    this.tables.clear();
    this.schemaReady = null;
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

/** "host:port/name" of a connection string, never its user or password (for logs). */
export function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.searchParams.get('host') || parsed.hostname || 'localhost';
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || '(default database)';
    return `${host}${parsed.port ? `:${parsed.port}` : ''}/${name}`;
  } catch {
    return '(unparsable DATABASE_URL)';
  }
}
