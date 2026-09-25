import { ObjectId } from 'mongodb';
import type { AppDeps } from '../context';
import type { CategoryDoc, ServiceDoc, StudioSettings } from '../db/types';
import { isDuplicateKey } from '../lib/errors';
import { slugify } from '../lib/text';
import { DEFAULT_SETTINGS, invalidateSettingsCache } from '../modules/settings';
import {
  CATALOG_DEFAULTS_VERSION,
  DEFAULT_CATALOG,
  LEGACY_CATALOG_KEYS,
  type DefaultCategory,
  type DefaultService,
} from './data';

/**
 * Managed defaults: the studio's default price list and contact details ship with the code,
 * and each deploy brings existing databases up to date without overwriting anything the
 * studio changed by hand.
 *
 * - Entries created from the defaults carry `defaultKey`; staff edits record the edited field
 *   names in `customized`, and the sync only writes fields that are not listed there.
 * - A default entry staff deleted is remembered (tombstone) and never recreated.
 * - Default entries dropped from a newer list are hidden (isActive: false), never deleted,
 *   because past bookings keep pointing at them.
 * - Runs once per version (tracked in `meta`), at server start and from `yarn seed`.
 */

const META_ID = 'catalogDefaults';
/** Fields the defaults manage; staff edits to these are recorded in `customized`. */
export const MANAGED_CATEGORY_FIELDS: readonly string[] = ['name', 'description', 'singleChoice', 'color', 'order', 'isActive'];
export const MANAGED_SERVICE_FIELDS: readonly string[] = [
  'categoryId',
  'name',
  'description',
  'durationMin',
  'price',
  'priceFrom',
  'art',
  'isPopular',
  'order',
  'isActive',
];

/** The managed fields among the keys of an edit, for `$addToSet: { customized: … }`. */
export function customizedFields(input: object, managed: readonly string[]): string[] {
  return Object.keys(input).filter((field) => managed.includes(field));
}

interface CatalogMeta {
  _id: string;
  value: number;
  /** "category:<key>" / "service:<key>" of defaults the studio deleted. */
  removedKeys?: string[];
  updatedAt: Date;
}

function categoryDefaults(category: DefaultCategory, index: number) {
  return {
    name: category.name,
    description: category.description ?? null,
    singleChoice: category.singleChoice ?? false,
    color: category.color,
    order: index + 1,
    isActive: true,
  };
}

function serviceDefaults(service: DefaultService, index: number, categoryId: ObjectId) {
  return {
    categoryId,
    name: service.name,
    description: service.description,
    durationMin: service.durationMin,
    price: service.price,
    priceFrom: service.priceFrom ?? false,
    art: service.art,
    isPopular: service.isPopular ?? false,
    order: index + 1,
    isActive: true,
  };
}

/**
 * "Reset to default" for one entry: the current default values, or null when the entry did
 * not come from the price list (or its default no longer exists).
 */
export async function defaultValuesFor(
  deps: AppDeps,
  kind: 'category' | 'service',
  defaultKey: string | undefined,
): Promise<Record<string, unknown> | null> {
  if (!defaultKey) return null;
  for (const [categoryIndex, category] of DEFAULT_CATALOG.entries()) {
    if (kind === 'category' && category.key === defaultKey) return categoryDefaults(category, categoryIndex);
    if (kind !== 'service') continue;
    const serviceIndex = category.services.findIndex((service) => service.key === defaultKey);
    if (serviceIndex < 0) continue;
    const parent = await deps.col.categories.findOne({ defaultKey: category.key });
    if (!parent) return null;
    return serviceDefaults(category.services[serviceIndex]!, serviceIndex, parent._id);
  }
  return null;
}

export interface SyncResult {
  applied: boolean;
  created: number;
  updated: number;
  retired: number;
}

/** Only the fields staff have not customized. */
function unlocked<T extends Record<string, unknown>>(values: T, customized: string[] | undefined): Partial<T> {
  const locked = new Set(customized ?? []);
  return Object.fromEntries(Object.entries(values).filter(([field]) => !locked.has(field))) as Partial<T>;
}

function changed(doc: Record<string, unknown>, values: Record<string, unknown>): boolean {
  return Object.entries(values).some(([field, value]) => JSON.stringify(doc[field] ?? null) !== JSON.stringify(value ?? null));
}

/**
 * The first seed wrote entries without `defaultKey`. An entry that was never edited
 * (updatedAt still equals createdAt) is adopted as a managed default so a newer list can retire
 * it; an edited one is treated as the studio's own and left alone.
 */
async function adoptLegacyEntries(deps: AppDeps): Promise<void> {
  const { col } = deps;
  const untouched = { defaultKey: { $exists: false }, $expr: { $eq: ['$updatedAt', '$createdAt'] } };
  const categories = await col.categories.find({ ...untouched, slug: { $in: LEGACY_CATALOG_KEYS.categories } }).toArray();
  for (const category of categories) {
    await col.categories.updateOne({ _id: category._id }, { $set: { defaultKey: `legacy:${category.slug}`, customized: [] } });
  }
  const services = await col.services.find({ ...untouched, slug: { $in: LEGACY_CATALOG_KEYS.services } }).toArray();
  for (const service of services) {
    await col.services.updateOne({ _id: service._id }, { $set: { defaultKey: `legacy:${service.slug}`, customized: [] } });
  }
}

export async function syncCatalogDefaults(
  deps: AppDeps,
  options: { catalog?: DefaultCategory[]; version?: number; log?: (message: string) => void } = {},
): Promise<SyncResult> {
  const catalog = options.catalog ?? DEFAULT_CATALOG;
  const version = options.version ?? CATALOG_DEFAULTS_VERSION;
  const log = options.log ?? (() => undefined);
  const { col } = deps;
  const metaCol = deps.db.collection<CatalogMeta>('meta');
  const meta = await metaCol.findOne({ _id: META_ID });
  const result: SyncResult = { applied: false, created: 0, updated: 0, retired: 0 };
  if (meta && meta.value >= version) return result;

  const now = deps.now();
  const removed = new Set(meta?.removedKeys ?? []);
  await adoptLegacyEntries(deps);

  const keepCategories: string[] = [];
  const keepServices: string[] = [];
  for (const [categoryIndex, category] of catalog.entries()) {
    keepCategories.push(category.key);
    const categoryValues = categoryDefaults(category, categoryIndex);
    let categoryDoc = await col.categories.findOne({ defaultKey: category.key });
    if (!categoryDoc) {
      if (removed.has(`category:${category.key}`)) continue;
      const doc: CategoryDoc = {
        _id: new ObjectId(),
        slug: category.key,
        ...categoryValues,
        defaultKey: category.key,
        customized: [],
        createdAt: now,
        updatedAt: now,
      };
      try {
        await col.categories.insertOne(doc);
        result.created++;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error; // another process created it first
      }
      categoryDoc = await col.categories.findOne({ defaultKey: category.key });
      if (!categoryDoc) continue;
    } else {
      const values = unlocked(categoryValues, categoryDoc.customized);
      if (changed(categoryDoc as unknown as Record<string, unknown>, values)) {
        await col.categories.updateOne({ _id: categoryDoc._id }, { $set: { ...values, updatedAt: now } });
        result.updated++;
      }
    }

    for (const [serviceIndex, service] of category.services.entries()) {
      keepServices.push(service.key);
      const serviceValues = serviceDefaults(service, serviceIndex, categoryDoc._id);
      const serviceDoc = await col.services.findOne({ defaultKey: service.key });
      if (!serviceDoc) {
        if (removed.has(`service:${service.key}`)) continue;
        const doc: ServiceDoc = {
          _id: new ObjectId(),
          slug: slugify(service.key),
          ...serviceValues,
          defaultKey: service.key,
          customized: [],
          createdAt: now,
          updatedAt: now,
        };
        try {
          await col.services.insertOne(doc);
          result.created++;
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
        }
      } else {
        const values = unlocked(serviceValues, serviceDoc.customized);
        if (changed(serviceDoc as unknown as Record<string, unknown>, values)) {
          await col.services.updateOne({ _id: serviceDoc._id }, { $set: { ...values, updatedAt: now } });
          result.updated++;
        }
      }
    }
  }

  // Defaults that left the list: hide them unless the studio decided their visibility itself.
  const retireFilter = (keep: string[]) => ({
    defaultKey: { $type: 'string' as const, $nin: keep },
    isActive: true,
    customized: { $ne: 'isActive' },
  });
  const retiredServices = await col.services.updateMany(retireFilter(keepServices), { $set: { isActive: false, isPopular: false, updatedAt: now } });
  const retiredCategories = await col.categories.updateMany(retireFilter(keepCategories), { $set: { isActive: false, updatedAt: now } });
  result.retired = retiredServices.modifiedCount + retiredCategories.modifiedCount;

  await metaCol.updateOne({ _id: META_ID }, { $set: { value: version, updatedAt: now } }, { upsert: true });
  result.applied = true;
  log(`✓ price list v${version}: ${result.created} added, ${result.updated} updated, ${result.retired} retired`);
  return result;
}

/** Called when staff delete a default entry, so no later version brings it back. */
export async function rememberRemovedDefault(deps: AppDeps, kind: 'category' | 'service', defaultKey: string | undefined): Promise<void> {
  if (!defaultKey || defaultKey.startsWith('legacy:')) return;
  await deps.db
    .collection<CatalogMeta>('meta')
    .updateOne({ _id: META_ID }, { $addToSet: { removedKeys: `${kind}:${defaultKey}` }, $setOnInsert: { value: 0 } }, { upsert: true });
}

/**
 * Settings whose default changed in a later version, with the value they had before. A field
 * still holding its old default (and not saved in Admin → Settings) takes the new one.
 */
const SETTINGS_DEFAULT_CHANGES: Array<{ field: keyof StudioSettings; previous: unknown }> = [
  // Version 2: contact details from the published price list.
  { field: 'phone', previous: '' },
  { field: 'instagram', previous: '' },
];

export async function syncSettingsDefaults(deps: AppDeps, log: (message: string) => void = () => undefined): Promise<number> {
  const doc = await deps.col.settings.findOne({ _id: 'studio' });
  if (!doc) return 0;
  const locked = new Set(doc.customized ?? []);
  const set: Partial<StudioSettings> = {};
  for (const { field, previous } of SETTINGS_DEFAULT_CHANGES) {
    const current = doc[field];
    if (locked.has(field) || JSON.stringify(current ?? null) !== JSON.stringify(previous)) continue;
    if (JSON.stringify(current) === JSON.stringify(DEFAULT_SETTINGS[field])) continue;
    (set as Record<string, unknown>)[field] = DEFAULT_SETTINGS[field];
  }
  const fields = Object.keys(set);
  if (fields.length === 0) return 0;
  await deps.col.settings.updateOne({ _id: 'studio' }, { $set: { ...set, updatedAt: deps.now() } });
  invalidateSettingsCache(deps);
  log(`✓ studio settings: new defaults for ${fields.join(', ')}`);
  return fields.length;
}

/** Everything default-driven, in order. Cheap when already current (one meta read). */
export async function syncDefaults(deps: AppDeps, log?: (message: string) => void): Promise<void> {
  await syncCatalogDefaults(deps, { log });
  await syncSettingsDefaults(deps, log);
}
