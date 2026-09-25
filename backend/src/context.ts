import type { Context } from 'hono';
import type { Db } from 'mongodb';
import type { AppConfig } from './config';
import type { Collections } from './db';
import type { UserDoc } from './db/types';
import type { Mailer } from './lib/mailer';
import type { PasswordHasher } from './lib/password';

/** Everything a request handler needs, injected once per runtime (Node process or Durable Object). */
export interface AppDeps {
  config: AppConfig;
  db: Db;
  col: Collections;
  mailer: Mailer;
  passwords: PasswordHasher;
  now: () => Date;
  /** Resolves the caller's IP from the runtime (socket on Node, CF-Connecting-IP on Workers). */
  clientIp: (c: Context) => string;
  /** Runs work after the response without blocking it (ctx.waitUntil on Workers). */
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
