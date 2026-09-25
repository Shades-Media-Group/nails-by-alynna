import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

/**
 * Tests need a MongoDB. Set TEST_MONGODB_URI to use an existing server (each test file
 * works in its own throw-away database); otherwise an in-memory mongod is started.
 */
let server: MongoMemoryServer | undefined;

export async function setup(project: TestProject) {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    server = await MongoMemoryServer.create();
    uri = server.getUri();
  }
  project.provide('mongoUri', uri);
}

export async function teardown() {
  await server?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
