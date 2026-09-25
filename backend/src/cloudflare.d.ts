/**
 * Minimal Cloudflare Workers typings for worker.ts. The rest of the codebase targets
 * web-standard APIs shared with Node.js, so the full workers-types (which clash with
 * @types/node) are not needed.
 */

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId, options?: { locationHint?: string }): DurableObjectStub;
}

interface DurableObjectState {
  readonly id: DurableObjectId;
  waitUntil(promise: Promise<unknown>): void;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
    fetch?(request: Request): Response | Promise<Response>;
  }
}
