import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../src/db';
import { createTestContext, type TestContext } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

describe('/api/health', () => {
  it("says the database is migrated to this build's schema", async () => {
    const res = await ctx.client().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database).toMatchObject({ status: 'ok', schema: { version: SCHEMA_VERSION, current: true } });
  });

  it('says so while the migration has not run, without calling it an outage', async () => {
    await ctx.deps.col.meta.updateOne({ _id: 'schemaVersion' }, { $set: { value: SCHEMA_VERSION - 1, updatedAt: new Date() } });
    const res = await ctx.client().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database.schema).toMatchObject({ version: SCHEMA_VERSION - 1, current: false });
  });
});
