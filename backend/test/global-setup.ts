import { execFileSync } from 'node:child_process';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

/**
 * Tests need a PostgreSQL. Set TEST_DATABASE_URL to use an existing server (each test file
 * works in its own throw-away schema); otherwise a disposable postgres:10 container, the
 * version production runs, is started with Docker and removed afterwards.
 */
let container: string | undefined;

const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    try {
      container = docker(
        'run', '-d', '--rm',
        '-e', 'POSTGRES_USER=nba', '-e', 'POSTGRES_PASSWORD=nba', '-e', 'POSTGRES_DB=nba_test',
        '-p', '127.0.0.1::5432',
        '--tmpfs', '/var/lib/postgresql/data',
        'postgres:10',
        // Throw-away data: skip durability for speed; every test file opens its own pool.
        '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off', '-c', 'max_connections=300',
      );
    } catch (error) {
      throw new Error('Tests need PostgreSQL: start Docker, or set TEST_DATABASE_URL', { cause: error });
    }
    const port = docker('port', container, '5432/tcp').split('\n')[0]!.split(':').pop();
    url = `postgres://nba:nba@127.0.0.1:${port}/nba_test`;
    await waitForDatabase(url);
  }
  project.provide('databaseUrl', url);
}

/** The image initialises the database first, then accepts TCP connections. */
async function waitForDatabase(url: string) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      await client.end().catch(() => undefined);
      if (Date.now() > deadline) throw new Error('PostgreSQL did not start within a minute', { cause: error });
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

export async function teardown() {
  if (container) docker('rm', '-f', container);
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
