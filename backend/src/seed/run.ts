import { ObjectId } from 'mongodb';
import type { AppDeps } from '../context';
import type { AppointmentDoc, AppointmentStatus, StaffDoc, UserDoc } from '../db/types';
import { bookingCode } from '../lib/crypto';
import { userSearch } from '../lib/text';
import { addDays, isoWeekday, MINUTE, todayIn, zonedTimeToUtc } from '../lib/time';
import { DEFAULT_SETTINGS, invalidateSettingsCache } from '../modules/settings';
import { DEFAULT_WEEKLY, SEED_MASTER } from './data';
import { syncDefaults } from './defaults';

export interface SeedOptions {
  admin?: { email: string; password: string; name: string; surname: string; resetPassword?: boolean };
  /** Shared read-only demo accounts (safe on production: they cannot change anything). */
  demoUsers?: { password: string };
  /** Sample clients and appointments so every screen has content (never on production). */
  demoData?: boolean;
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

  await syncDefaults(deps, log);

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
        // Set up by whoever runs the server, so the owner can also sign in with Google.
        emailVerifiedAt: now,
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

  if (options.demoUsers) await seedDemoUsers(deps, options.demoUsers.password, log);
  if (options.demoData) await seedDemoData(deps, log);
}

export const DEMO_ACCOUNTS = [
  { email: 'client.demo@example.com', name: 'Daria', surname: 'Demo', role: 'client' as const, phone: '+37360000001' },
  { email: 'admin.demo@example.com', name: 'Irina', surname: 'Demo', role: 'admin' as const, phone: null },
  { email: 'owner.demo@example.com', name: 'Alina', surname: 'Demo', role: 'administrator' as const, phone: null },
];

async function seedDemoUsers(deps: AppDeps, password: string, log: (m: string) => void) {
  const now = deps.now();
  const passwordHash = await deps.passwords.hash(password);
  for (const account of DEMO_ACCOUNTS) {
    const existing = await deps.col.users.findOne({ email: account.email });
    if (existing) {
      await deps.col.users.updateOne(
        { _id: existing._id },
        { $set: { isDemo: true, role: account.role, isActive: true, passwordHash, updatedAt: now } },
      );
      continue;
    }
    await deps.col.users.insertOne({
      _id: new ObjectId(),
      email: account.email,
      name: account.name,
      surname: account.surname,
      phone: account.phone,
      role: account.role,
      locale: 'ro',
      passwordHash,
      googleId: null,
      isActive: true,
      bookingBlocked: false,
      isDemo: true,
      tokenVersion: 0,
      notes: '',
      search: userSearch(account.name, account.surname, account.email, account.phone),
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }
  log(`✓ demo accounts ready (${DEMO_ACCOUNTS.map((a) => a.email).join(', ')})`);
}

const SAMPLE_CLIENTS = [
  { name: 'Maria', surname: 'Popescu', phone: '+37369111222' },
  { name: 'Elena', surname: 'Rusu', phone: '+37378333444' },
  { name: 'Olga', surname: 'Ceban', phone: '+37368555666' },
  { name: 'Ana', surname: 'Munteanu', phone: '+37379777888' },
];

async function seedDemoData(deps: AppDeps, log: (m: string) => void) {
  const { col } = deps;
  const now = deps.now();
  if ((await col.appointments.countDocuments({ source: 'staff', notes: 'sample' })) > 0) return;

  const master = await col.staff.findOne({}, { sort: { order: 1 } });
  const services = await col.services.find({ isActive: true }).toArray();
  if (!master || services.length === 0) return;
  const pick = (slug: string) => services.find((s) => s.slug === slug) ?? services[0]!;

  const clients: UserDoc[] = [];
  for (const sample of SAMPLE_CLIENTS) {
    const email = `${sample.name.toLowerCase()}.${sample.surname.toLowerCase()}@example.com`;
    let client = await col.users.findOne({ email });
    if (!client) {
      client = {
        _id: new ObjectId(),
        email,
        name: sample.name,
        surname: sample.surname,
        phone: sample.phone,
        role: 'client',
        locale: 'ro',
        passwordHash: null,
        googleId: null,
        isActive: true,
        bookingBlocked: false,
        tokenVersion: 0,
        notes: '',
        search: userSearch(sample.name, sample.surname, email, sample.phone),
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await col.users.insertOne(client);
    }
    clients.push(client);
  }
  const demoClient = await col.users.findOne({ email: DEMO_ACCOUNTS[0]!.email });
  if (demoClient) clients.push(demoClient);

  const settings = (await col.settings.findOne({ _id: 'studio' })) ?? DEFAULT_SETTINGS;
  const tz = settings.timezone;
  const today = todayIn(tz, now);
  const plan: Array<{ day: number; time: string; slugs: string[]; status: AppointmentStatus; client: number }> = [
    { day: -21, time: '11:00', slugs: ['gel-polish'], status: 'completed', client: 4 },
    { day: -14, time: '12:00', slugs: ['extension-size-2'], status: 'completed', client: 0 },
    { day: -9, time: '15:00', slugs: ['correction-size-3'], status: 'completed', client: 1 },
    { day: -7, time: '15:30', slugs: ['gel-polish', 'french'], status: 'completed', client: 4 },
    { day: -3, time: '10:00', slugs: ['removal', 'hygiene'], status: 'no_show', client: 2 },
    { day: 0, time: '10:00', slugs: ['gel-polish', 'design-complex'], status: 'confirmed', client: 3 },
    { day: 0, time: '13:30', slugs: ['correction-size-2'], status: 'confirmed', client: 0 },
    { day: 0, time: '16:00', slugs: ['gel-polish', 'french'], status: 'pending', client: 1 },
    { day: 1, time: '11:00', slugs: ['extension-size-1'], status: 'confirmed', client: 2 },
    { day: 2, time: '12:00', slugs: ['gel-polish', 'design-3d-gel'], status: 'confirmed', client: 4 },
    { day: 3, time: '14:00', slugs: ['extension-size-4'], status: 'pending', client: 3 },
  ];

  const docs: AppointmentDoc[] = [];
  for (const p of plan) {
    const client = clients[p.client] ?? clients[0]!;
    let day = addDays(today, p.day);
    // The default schedule is closed on Sundays; keep samples on working days.
    if (isoWeekday(day) === 7) day = addDays(day, p.day < 0 ? -1 : 1);
    const chosen = p.slugs.map(pick);
    const start = zonedTimeToUtc(day, p.time, tz);
    const durationMin = chosen.reduce((sum, s) => sum + s.durationMin, 0);
    docs.push({
      _id: new ObjectId(),
      code: bookingCode(),
      clientId: client._id,
      client: { name: client.name, surname: client.surname, phone: client.phone, email: client.email },
      staffId: master._id,
      services: chosen.map((s) => ({ serviceId: s._id, name: s.name, durationMin: s.durationMin, price: s.price, priceFrom: s.priceFrom })),
      start,
      end: new Date(start.getTime() + durationMin * MINUTE),
      durationMin,
      totalPrice: chosen.reduce((sum, s) => sum + s.price, 0),
      priceFrom: chosen.some((s) => s.priceFrom),
      status: p.status,
      notes: 'sample',
      staffNotes: '',
      source: 'staff',
      placedAt: now,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: '',
      createdBy: master._id,
      createdAt: now,
      updatedAt: now,
    });
  }
  await col.appointments.insertMany(docs);
  log(`✓ ${SAMPLE_CLIENTS.length} sample clients and ${docs.length} sample appointments`);
}
