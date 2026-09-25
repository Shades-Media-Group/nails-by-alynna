import { ObjectId } from 'mongodb';
import type { AppDeps } from '../context';
import type { AppointmentDoc, AppointmentStatus, CategoryDoc, ServiceDoc, StaffDoc, UserDoc } from '../db/types';
import { bookingCode } from '../lib/crypto';
import { slugify, userSearch } from '../lib/text';
import { addDays, isoWeekday, MINUTE, todayIn, zonedTimeToUtc } from '../lib/time';
import { DEFAULT_SETTINGS, invalidateSettingsCache } from '../modules/settings';
import { DEFAULT_WEEKLY, SEED_CATALOG, SEED_MASTER } from './data';

export interface SeedOptions {
  admin?: { email: string; password: string; name: string; surname: string; resetPassword?: boolean };
  demo?: { password: string };
  log?: (message: string) => void;
}

/** Idempotent: only creates what is missing, never overwrites the studio's edits. */
export async function runSeed(deps: AppDeps, options: SeedOptions = {}): Promise<void> {
  const log = options.log ?? (() => undefined);
  const now = deps.now();
  const { col } = deps;

  const settings = await col.settings.findOne({ _id: 'studio' });
  if (!settings) {
    await col.settings.insertOne({ _id: 'studio', ...DEFAULT_SETTINGS, updatedAt: now });
    invalidateSettingsCache(deps);
    log('✓ studio settings created');
  }

  if ((await col.categories.countDocuments()) === 0) {
    let categoryOrder = 0;
    for (const category of SEED_CATALOG) {
      const categoryId = new ObjectId();
      const categoryDoc: CategoryDoc = {
        _id: categoryId,
        slug: category.key,
        name: category.name,
        color: category.color,
        order: ++categoryOrder,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      await col.categories.insertOne(categoryDoc);
      const services: ServiceDoc[] = category.services.map((s, index) => ({
        _id: new ObjectId(),
        categoryId,
        slug: slugify(s.key),
        name: s.name,
        description: s.description,
        durationMin: s.durationMin,
        price: s.price,
        priceFrom: s.priceFrom ?? false,
        art: s.art,
        isPopular: s.isPopular ?? false,
        isActive: true,
        order: index + 1,
        createdAt: now,
        updatedAt: now,
      }));
      await col.services.insertMany(services);
    }
    log(`✓ catalog created (${SEED_CATALOG.length} categories)`);
  }

  let adminUser: UserDoc | null = null;
  if (options.admin) {
    const email = options.admin.email.trim().toLowerCase();
    adminUser = await col.users.findOne({ email });
    if (!adminUser) {
      adminUser = {
        _id: new ObjectId(),
        email,
        name: options.admin.name,
        surname: options.admin.surname,
        phone: null,
        role: 'administrator',
        locale: 'ro',
        passwordHash: await deps.passwords.hash(options.admin.password),
        googleId: null,
        isActive: true,
        bookingBlocked: false,
        tokenVersion: 0,
        notes: '',
        search: userSearch(options.admin.name, options.admin.surname, email, null),
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await col.users.insertOne(adminUser);
      log(`✓ administrator ${email} created`);
    } else {
      const set: Partial<UserDoc> = { role: 'administrator', isActive: true, updatedAt: now };
      if (options.admin.resetPassword) set.passwordHash = await deps.passwords.hash(options.admin.password);
      await col.users.updateOne({ _id: adminUser._id }, { $set: set, $inc: { tokenVersion: 1 } });
      log(`✓ administrator ${email} ensured${options.admin.resetPassword ? ' (password reset)' : ''}`);
    }
  }

  if ((await col.staff.countDocuments()) === 0) {
    const master: StaffDoc = {
      _id: new ObjectId(),
      name: SEED_MASTER.name,
      title: SEED_MASTER.title,
      color: SEED_MASTER.color,
      userId: adminUser?._id ?? null,
      serviceIds: null,
      weekly: DEFAULT_WEEKLY,
      isActive: true,
      isBookable: true,
      order: 1,
      createdAt: now,
      updatedAt: now,
    };
    await col.staff.insertOne(master);
    log(`✓ master ${master.name} created`);
  }

  if (options.demo) await seedDemo(deps, options.demo.password, log);
}

async function seedDemo(deps: AppDeps, password: string, log: (m: string) => void) {
  const { col } = deps;
  const now = deps.now();
  const email = 'demo.client@example.com';
  let client = await col.users.findOne({ email });
  if (!client) {
    client = {
      _id: new ObjectId(),
      email,
      name: 'Daria',
      surname: 'Demo',
      phone: '+37360000001',
      role: 'client',
      locale: 'ro',
      passwordHash: await deps.passwords.hash(password),
      googleId: null,
      isActive: true,
      bookingBlocked: false,
      tokenVersion: 0,
      notes: '',
      search: userSearch('Daria', 'Demo', email, '+37360000001'),
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await col.users.insertOne(client);
    log(`✓ demo client ${email} created`);
  }

  if ((await col.appointments.countDocuments({ clientId: client._id })) > 0) return;

  const master = await col.staff.findOne({}, { sort: { order: 1 } });
  const services = await col.services.find({ isActive: true }).toArray();
  const pick = (key: string) => services.find((s) => s.slug === key) ?? services[0];
  if (!master || services.length === 0) return;

  const settings = (await col.settings.findOne({ _id: 'studio' })) ?? DEFAULT_SETTINGS;
  const tz = settings.timezone;
  const today = todayIn(tz, now);
  const plan: Array<{ day: number; time: string; slugs: string[]; status: AppointmentStatus }> = [
    { day: -21, time: '11:00', slugs: ['manicure-gel'], status: 'completed' },
    { day: -7, time: '15:30', slugs: ['pedicure-gel'], status: 'completed' },
    { day: 2, time: '12:00', slugs: ['manicure-gel', 'art-simple'], status: 'confirmed' },
  ];

  const docs: AppointmentDoc[] = plan.map((p) => {
    const chosen = p.slugs.map(pick).filter((s): s is ServiceDoc => Boolean(s));
    let day = addDays(today, p.day);
    // The default schedule is closed on Sundays; keep demo visits on working days.
    if (isoWeekday(day) === 7) day = addDays(day, p.day < 0 ? -1 : 1);
    const start = zonedTimeToUtc(day, p.time, tz);
    const durationMin = chosen.reduce((sum, s) => sum + s.durationMin, 0);
    return {
      _id: new ObjectId(),
      code: bookingCode(),
      clientId: client._id,
      client: { name: client.name, surname: client.surname, phone: client.phone, email: client.email },
      staffId: master._id,
      services: chosen.map((s) => ({
        serviceId: s._id,
        name: s.name,
        durationMin: s.durationMin,
        price: s.price,
        priceFrom: s.priceFrom,
      })),
      start,
      end: new Date(start.getTime() + durationMin * MINUTE),
      durationMin,
      totalPrice: chosen.reduce((sum, s) => sum + s.price, 0),
      priceFrom: chosen.some((s) => s.priceFrom),
      status: p.status,
      notes: '',
      staffNotes: '',
      source: 'client',
      placedAt: now,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: '',
      createdBy: client._id,
      createdAt: now,
      updatedAt: now,
    };
  });
  await col.appointments.insertMany(docs);
  log(`✓ ${docs.length} demo appointments created`);
}
