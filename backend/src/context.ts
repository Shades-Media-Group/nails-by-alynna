import type { Context } from 'hono';
import type { AppConfig } from './config';
import type { Collections, Database } from './db';
import type { UserDoc } from './db/types';
import type { Mailer } from './lib/mailer';
import type { PasswordHasher } from './lib/password';

/** Everything a request handler needs, injected once per Node process. */
export interface AppDeps {
  config: AppConfig;
  /** PostgreSQL (see db/pg): `db.collection(name)`, `ping()`, `close()`. */
  db: Database;
  col: Collections;
  mailer: Mailer;
  passwords: PasswordHasher;
  now: () => Date;
  /** Resolves the caller's IP (socket, or the proxy's header; see server.ts). */
  clientIp: (c: Context) => string;
  /** Runs work after the response without blocking it. */
  defer: (task: Promise<unknown>) => void;
}

export interface AppVariables {
  requestId: string;
  user: UserDoc;
  sessionId: string;
  ip: string;
}

export interface AppEnv {
  Variables: AppVariables;
}
