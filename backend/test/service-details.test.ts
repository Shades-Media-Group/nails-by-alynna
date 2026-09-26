import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plainText } from '../src/lib/validation';
import { SERVICE_DETAILS_MAX } from '../src/modules/admin/schemas';
import { migrate } from '../src/runtime';
import { CATALOG_DEFAULTS_VERSION, DEFAULT_CATALOG, type DefaultCategory } from '../src/seed/data';
import { syncCatalogDefaults } from '../src/seed/defaults';
import { createTestContext, loginAs, strongPassword, type TestClient, type TestContext } from './helpers';

/*
 * "About the procedure": the text clients read behind ⓘ next to a service. It ships with the
 * price list, staff edit it in Admin → Services, and a price-list update never overwrites it.
 */

let ctx: TestContext;
let staff: TestClient;

const LOCALES = ['ro', 'ru', 'en'] as const;
const DEFAULT_SERVICES = DEFAULT_CATALOG.flatMap((category) => category.services);
const empty = { ro: '', ru: '', en: '' };
const owner = { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' };

const serviceIn = (context: TestContext, key: string) => context.deps.col.services.findOne({ defaultKey: key });
const detailsOf = (key: string) => DEFAULT_SERVICES.find((service) => service.key === key)!.details;

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.seed({ admin: owner });
  staff = await loginAs(ctx, owner.email, owner.password);
});
afterAll(async () => {
  await ctx.close();
});

describe('default texts', () => {
  it('every service in the price list has its own text in Romanian, Russian and English', () => {
    expect(DEFAULT_SERVICES).toHaveLength(20);
    for (const { key, details } of DEFAULT_SERVICES) {
      for (const locale of LOCALES) {
        const text = details[locale];
        // Stored exactly as the admin form would save it: plain, trimmed, within the limit.
        expect(text, `${key}.${locale}`).toBe(plainText(text));
        expect(text, `${key}.${locale}`).not.toMatch(/[<>]/);
        expect(text.length, `${key}.${locale}`).toBeLessThanOrEqual(SERVICE_DETAILS_MAX);
        // Two to four short sentences.
        const sentences = text.split(/(?<=[.!?])\s+/);
        expect(sentences.length, `${key}.${locale}`).toBeGreaterThanOrEqual(2);
        expect(sentences.length, `${key}.${locale}`).toBeLessThanOrEqual(4);
      }
      expect(new Set(LOCALES.map((locale) => details[locale])).size, key).toBe(3);
    }
  });

  it('the catalog sends each service its text, and so does the admin price list', async () => {
    const catalog = await ctx.client().get('/api/catalog');
    expect(catalog.status).toBe(200);
    expect(catalog.body.services).toHaveLength(20);
    for (const service of catalog.body.services) {
      const stored = await ctx.deps.col.services.findOne({ slug: service.slug });
      expect(service.details, service.slug).toEqual(detailsOf(stored!.defaultKey!));
    }
    const size4 = catalog.body.services.find((s: { slug: string }) => s.slug === 'extension-size-4');
    expect(size4.details.ro).toMatch(/^Alungim unghiile la mărimea 4 .* O lungime medie/);
    expect(size4.details.ru).toContain('до размера 4');

    const admin = await staff.get('/api/admin/catalog');
    const gel = admin.body.services.find((s: { slug: string }) => s.slug === 'gel-polish');
    expect(gel.details).toEqual(detailsOf('gel-polish'));
  });
});

describe('staff editing the text', () => {
  it('saves it trimmed, keeps paragraphs, and records the field as the studio’s own', async () => {
    const gel = await serviceIn(ctx, 'gel-polish');
    const res = await staff.patch(`/api/admin/catalog/services/${gel!._id}`, {
      details: {
        ro: '  Primul paragraf.  \r\n\r\n\r\n\r\nAl doilea,\t\r\npe două rânduri.\u0007  ',
        ru: '\n Текст. \n',
        en: '   ',
      },
    });
    expect(res.status).toBe(200);
    const saved = { ro: 'Primul paragraf.\n\nAl doilea,\npe două rânduri.', ru: 'Текст.', en: '' };
    expect(res.body.service.details).toEqual(saved);
    expect(res.body.service.customized).toEqual(['details']);
    // Only the text changed.
    expect(res.body.service).toMatchObject({ price: 300, durationMin: 90, description: { ro: 'Lac gel pe unghiile naturale, într-o culoare la alegere.' } });

    const catalog = await ctx.client().get('/api/catalog');
    expect(catalog.body.services.find((s: { slug: string }) => s.slug === 'gel-polish').details).toEqual(saved);
  });

  it('refuses a text over the limit or with HTML, and accepts < and > in words', async () => {
    const french = await serviceIn(ctx, 'french');
    const path = `/api/admin/catalog/services/${french!._id}`;

    const long = await staff.patch(path, { details: { ...empty, ru: 'а'.repeat(SERVICE_DETAILS_MAX + 1) } });
    expect(long.status).toBe(422);
    expect(long.body.error).toMatchObject({ code: 'VALIDATION_ERROR', fields: { 'details.ru': 'too_long' } });
    // The limit counts the saved text: spaces around it are not part of it.
    const atLimit = await staff.patch(path, { details: { ...empty, ru: ` ${'а'.repeat(SERVICE_DETAILS_MAX)} ` } });
    expect(atLimit.status).toBe(200);
    expect(atLimit.body.service.details.ru).toHaveLength(SERVICE_DETAILS_MAX);

    for (const markup of ['<b>Bold</b>', 'Click <a href="https://example.com">here</a>', '<!-- note -->', '<script>alert(1)</script>']) {
      const res = await staff.patch(path, { details: { ...empty, en: markup } });
      expect(res.status, markup).toBe(422);
      expect(res.body.error.fields, markup).toEqual({ 'details.en': 'plain_text' });
    }
    const words = await staff.patch(path, { details: { ...empty, en: 'Size <3 is short; 5 > 4.' } });
    expect(words.status).toBe(200);
    expect(words.body.service.details.en).toBe('Size <3 is short; 5 > 4.');
  });

  it('a service the studio adds starts without a text, or with the one given', async () => {
    const gel = await serviceIn(ctx, 'gel-polish');
    const base = {
      categoryId: String(gel!.categoryId),
      name: { ro: 'Test', ru: 'Тест', en: 'Test' },
      description: empty,
      durationMin: 30,
      price: 10,
    };
    const bare = await staff.post('/api/admin/catalog/services', base);
    expect(bare.status).toBe(201);
    expect(bare.body.service.details).toEqual(empty);

    const withText = await staff.post('/api/admin/catalog/services', { ...base, details: { ro: ' Despre. ', ru: 'О процедуре.', en: '' } });
    expect(withText.status).toBe(201);
    expect(withText.body.service.details).toEqual({ ro: 'Despre.', ru: 'О процедуре.', en: '' });
  });
});

describe('databases from before the texts', () => {
  /** A deep copy of the price list to play "the next version" with. */
  const nextVersion = (edit: (catalog: DefaultCategory[]) => void) => {
    const catalog = structuredClone(DEFAULT_CATALOG);
    edit(catalog);
    return catalog;
  };

  it('get the texts once at start-up, and a later price list never overwrites what the studio wrote', async () => {
    const old = await createTestContext();
    try {
      await old.seed({ admin: owner });
      // As production was: the price list at the previous version, services without texts,
      // and one service whose price the studio had already changed.
      await old.deps.col.services.updateMany({}, { $unset: { details: '' } });
      await old.deps.col.meta.updateOne({ _id: 'catalogDefaults' }, { $set: { value: CATALOG_DEFAULTS_VERSION - 1 } });
      await old.deps.col.services.updateOne({ defaultKey: 'french' }, { $set: { price: 40 }, $addToSet: { customized: 'price' } });
      expect((await old.client().get('/api/catalog')).body.services[0].details).toEqual(empty);

      await migrate(old.deps);
      for (const { key, details } of DEFAULT_SERVICES) expect((await serviceIn(old, key))?.details, key).toEqual(details);
      expect(await serviceIn(old, 'french')).toMatchObject({ price: 40, customized: ['price'] });

      // The studio rewrites one text and clears another.
      const desk = await loginAs(old, owner.email, owner.password);
      const removal = await serviceIn(old, 'removal');
      const hygiene = await serviceIn(old, 'hygiene');
      const own = { ro: 'Textul salonului.', ru: 'Текст салона.', en: '' };
      expect((await desk.patch(`/api/admin/catalog/services/${removal!._id}`, { details: own })).status).toBe(200);
      expect((await desk.patch(`/api/admin/catalog/services/${hygiene!._id}`, { details: empty })).status).toBe(200);

      // Once per version: starting again changes nothing.
      expect((await syncCatalogDefaults(old.deps)).applied).toBe(false);
      await migrate(old.deps);
      expect((await serviceIn(old, 'removal'))?.details).toEqual(own);
      expect((await serviceIn(old, 'hygiene'))?.details).toEqual(empty);

      // A newer price list with new texts: only the untouched ones follow it.
      const newer = { ro: 'Text nou.', ru: 'Новый текст.', en: 'New text.' };
      const result = await syncCatalogDefaults(old.deps, {
        version: CATALOG_DEFAULTS_VERSION + 1,
        catalog: nextVersion((catalog) => {
          for (const service of catalog.flatMap((category) => category.services)) {
            if (['removal', 'hygiene', 'gel-polish'].includes(service.key)) service.details = newer;
          }
        }),
      });
      expect(result.applied).toBe(true);
      expect((await serviceIn(old, 'removal'))?.details).toEqual(own);
      expect((await serviceIn(old, 'hygiene'))?.details).toEqual(empty);
      expect((await serviceIn(old, 'gel-polish'))?.details).toEqual(newer);

      // "Reset to the price list" brings back the text the code ships with.
      const reset = await desk.post(`/api/admin/catalog/services/${removal!._id}/reset`);
      expect(reset.body.service).toMatchObject({ details: detailsOf('removal'), customized: [] });
    } finally {
      await old.close();
    }
  });
});
