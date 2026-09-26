import { ObjectId } from 'bson';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATALOG_DEFAULTS_VERSION, DEFAULT_CATALOG, type DefaultCategory } from '../src/seed/data';
import { syncCatalogDefaults, syncSettingsDefaults } from '../src/seed/defaults';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

let ctx: TestContext;
let staff: TestClient;

/** A deep copy of the price list to play "the next version" with. */
const nextVersion = (edit: (catalog: DefaultCategory[]) => void) => {
  const catalog = structuredClone(DEFAULT_CATALOG);
  edit(catalog);
  return catalog;
};

const service = (key: string) => ctx.deps.col.services.findOne({ defaultKey: key });

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' } });
  // A regular staff member (role "admin"), not the owner.
  const { user } = await registerClient(ctx, { email: 'desk@example.com' });
  await ctx.deps.col.users.updateOne({ _id: new ObjectId(user.id) }, { $set: { role: 'admin' } });
  staff = await loginAs(ctx, 'desk@example.com', strongPassword);
});
afterAll(async () => {
  await ctx.close();
});

describe('default price list', () => {
  it('seeds the published price list and the studio contact details', async () => {
    const catalog = await ctx.client().get('/api/catalog');
    expect(catalog.body.categories.map((c: { slug: string }) => c.slug)).toEqual(['extension', 'correction', 'other']);
    expect(catalog.body.services).toHaveLength(20);
    const price = (slug: string) => catalog.body.services.find((s: { slug: string }) => s.slug === slug);
    expect(price('extension-size-1')).toMatchObject({ price: 400 });
    expect(price('extension-size-6')).toMatchObject({ price: 650 });
    expect(price('correction-size-1')).toMatchObject({ price: 370 });
    expect(price('correction-size-6')).toMatchObject({ price: 620 });
    expect(price('gel-polish')).toMatchObject({ price: 300, priceFrom: false });
    expect(price('design-3d-gel')).toMatchObject({ price: 5, priceFrom: true });
    expect(price('removal-foreign')).toMatchObject({ price: 50, priceFrom: true });
    const sizes = catalog.body.categories.find((c: { slug: string }) => c.slug === 'extension');
    expect(sizes).toMatchObject({ singleChoice: true });
    expect(sizes.description.en).toMatch(/Size means length/);

    const config = await ctx.client().get('/api/config');
    expect(config.body.studio).toMatchObject({ phone: '+37368230429', instagram: '_nailsbyalynna_' });
  });

  it('runs once per version', async () => {
    expect((await syncCatalogDefaults(ctx.deps)).applied).toBe(false);
  });
});

describe('staff editing the price list', () => {
  it('keeps staff edits when a newer default version ships, and updates the rest', async () => {
    const size2 = await service('extension-size-2');
    const edit = await staff.patch(`/api/admin/catalog/services/${size2!._id}`, { price: 480 });
    expect(edit.status).toBe(200);
    expect(edit.body.service).toMatchObject({ price: 480, isDefault: true, customized: ['price'] });
    // Editing only the price leaves every other field alone.
    expect(edit.body.service).toMatchObject({ isActive: true, art: 'length-2', durationMin: 130 });

    const result = await syncCatalogDefaults(ctx.deps, {
      version: CATALOG_DEFAULTS_VERSION + 1,
      catalog: nextVersion((catalog) => {
        const next = catalog[0]!.services[1]!;
        next.price = 460;
        next.durationMin = 140;
      }),
    });
    expect(result.applied).toBe(true);
    expect(await service('extension-size-2')).toMatchObject({ price: 480, durationMin: 140 });

    const audit = await ctx.deps.col.auditLogs.findOne({ action: 'service.update', targetId: String(size2!._id) });
    expect(audit?.meta).toMatchObject({ price: { from: 450, to: 480 } });
  });

  it('can put an edited entry back to the default', async () => {
    const size2 = await service('extension-size-2');
    const reset = await staff.post(`/api/admin/catalog/services/${size2!._id}/reset`);
    expect(reset.status).toBe(200);
    expect(reset.body.service).toMatchObject({ price: 450, customized: [] });

    const own = await staff.post('/api/admin/catalog/services', {
      categoryId: String(size2!.categoryId),
      name: { ro: 'Test', ru: 'Тест', en: 'Test' },
      description: { ro: '', ru: '', en: '' },
      durationMin: 30,
      price: 10,
    });
    expect(own.status).toBe(201);
    expect(own.body.service).toMatchObject({ isDefault: false });
    expect((await staff.post(`/api/admin/catalog/services/${own.body.service.id}/reset`)).status).toBe(409);
  });

  it('never brings back a default the studio deleted, and hides defaults that left the list', async () => {
    const extra = await service('design-extra');
    expect((await staff.delete(`/api/admin/catalog/services/${extra!._id}`)).body).toMatchObject({ ok: true, archived: false });

    // A service whose visibility staff chose themselves is theirs to keep.
    const french = await service('french');
    await staff.patch(`/api/admin/catalog/services/${french!._id}`, { isActive: true });

    await syncCatalogDefaults(ctx.deps, {
      version: CATALOG_DEFAULTS_VERSION + 2,
      catalog: nextVersion((catalog) => {
        const other = catalog[2]!;
        other.services = other.services.filter((s) => s.key !== 'hygiene' && s.key !== 'french');
      }),
    });
    expect(await service('design-extra')).toBeNull();
    expect(await service('hygiene')).toMatchObject({ isActive: false });
    expect(await service('french')).toMatchObject({ isActive: true });
  });
});

describe('one size per visit', () => {
  it('refuses two options from a single-choice category, allows extras next to one', async () => {
    const { client } = await registerClient(ctx);
    const [size1, size3, gel] = await Promise.all([service('extension-size-1'), service('extension-size-3'), service('gel-polish')]);
    const both = await client.get(`/api/availability/slots?serviceIds=${size1!._id},${size3!._id}&date=2026-06-02`);
    expect(both.status).toBe(422);
    expect(both.body.error.code).toBe('ONE_PER_CATEGORY');
    const withExtra = await client.get(`/api/availability/slots?serviceIds=${size1!._id},${gel!._id}&date=2026-06-02`);
    expect(withExtra.status).toBe(200);
  });
});

describe('upgrading a database from the first starter catalog', () => {
  it('retires untouched placeholders, keeps edited ones, and fills contact details left empty', async () => {
    const legacy = await createTestContext();
    try {
      const now = legacy.now();
      const edited = new Date(now.getTime() + 60_000);
      const categoryId = new ObjectId();
      await legacy.deps.col.categories.insertOne({
        _id: categoryId, slug: 'pedicure', name: { ro: 'P', ru: 'P', en: 'P' }, color: 'mint', order: 1, isActive: true, createdAt: now, updatedAt: now,
      });
      const base = { categoryId, description: { ro: '', ru: '', en: '' }, durationMin: 60, price: 1, priceFrom: false, art: 'pedicure' as const, isPopular: true, isActive: true, order: 1, createdAt: now };
      await legacy.deps.col.services.insertMany([
        { ...base, _id: new ObjectId(), slug: 'pedicure-gel', name: { ro: 'A', ru: 'A', en: 'A' }, updatedAt: now },
        { ...base, _id: new ObjectId(), slug: 'pedicure-classic', name: { ro: 'B', ru: 'B', en: 'B' }, updatedAt: edited },
      ]);
      await legacy.deps.col.settings.insertOne({
        _id: 'studio', ...(await import('../src/modules/settings')).DEFAULT_SETTINGS, phone: '', instagram: 'studio_own', updatedAt: now,
      });

      // A database from before managed defaults: it has never recorded a synced version.
      await legacy.deps.col.meta.deleteOne({ _id: 'catalogDefaults' });
      await syncCatalogDefaults(legacy.deps);
      expect(await legacy.deps.col.services.findOne({ slug: 'pedicure-gel' })).toMatchObject({ isActive: false, isPopular: false });
      expect(await legacy.deps.col.services.findOne({ slug: 'pedicure-classic' })).toMatchObject({ isActive: true });
      expect(await legacy.deps.col.services.countDocuments({ defaultKey: { $regex: /^(extension|correction)-size-/ } })).toBe(12);

      expect(await syncSettingsDefaults(legacy.deps)).toBe(1);
      expect(await legacy.deps.col.settings.findOne({ _id: 'studio' })).toMatchObject({ phone: '+37368230429', instagram: 'studio_own' });
    } finally {
      await legacy.close();
    }
  });
});

describe('edits send only what changed', () => {
  it('does not reset a staff member when only the name changes', async () => {
    const owner = await loginAs(ctx, 'owner@example.com', strongPassword);
    const team = await owner.get('/api/admin/team/staff');
    const master = team.body.staff[0];
    const onlyGel = await service('gel-polish');
    await owner.patch(`/api/admin/team/staff/${master.id}`, { serviceIds: [String(onlyGel!._id)], isBookable: true });
    const renamed = await owner.patch(`/api/admin/team/staff/${master.id}`, { name: 'Alynna' });
    expect(renamed.status).toBe(200);
    const stored = await ctx.deps.col.staff.findOne({ _id: new ObjectId(master.id) });
    expect(stored).toMatchObject({ name: 'Alynna', isBookable: true });
    expect(stored?.serviceIds?.map(String)).toEqual([String(onlyGel!._id)]);
  });
});
