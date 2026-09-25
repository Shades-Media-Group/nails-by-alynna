#!/usr/bin/env node
/**
 * One command to ship Nails by Alynna:
 *
 *   yarn deploy            api, then web, then verification
 *   yarn deploy api        build the Node bundle and upload it to host.md (FTPS), then restart
 *   yarn deploy web        build the PWA and deploy the Cloudflare Worker (assets + /api proxy)
 *   yarn deploy verify     run the live checks only
 *   add --dry-run          build and check everything, upload nothing
 *   add --sync-secret      also copy PROXY_SECRET from backend/.env.production to the Worker
 *
 * Deploy credentials live in .env.deploy (see .env.deploy.template); the API's own settings in
 * backend/.env.production (see backend/.env.production.template). Both are git-ignored.
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--')) ?? 'all';
const dryRun = args.includes('--dry-run');
const syncSecret = args.includes('--sync-secret');

if (!['all', 'api', 'web', 'verify'].includes(target)) {
  console.error(`Unknown target "${target}". Use: api | web | verify | all`);
  process.exit(2);
}

function parseEnv(file) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    values[match[1]] = value;
  }
  return values;
}

const deployEnv = parseEnv(join(root, '.env.deploy'));
const serverEnvFile = join(root, 'backend/.env.production');
const serverEnv = parseEnv(serverEnvFile);
const git = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
};
const commit = git('rev-parse --short HEAD') || 'local';
const dirty = git('status --porcelain') !== '';
// One version for both halves, so /health shows at a glance that web and API match.
const version = process.env.APP_VERSION || `${new Date().toISOString().slice(0, 10).replace(/-/g, '.')}-${commit}${dirty ? '-dirty' : ''}`;
const cloudflareEnv = {
  ...(deployEnv.CLOUDFLARE_API_TOKEN ? { CLOUDFLARE_API_TOKEN: deployEnv.CLOUDFLARE_API_TOKEN } : {}),
  ...(deployEnv.CLOUDFLARE_ACCOUNT_ID ? { CLOUDFLARE_ACCOUNT_ID: deployEnv.CLOUDFLARE_ACCOUNT_ID } : {}),
};

function step(title) {
  console.info(`\n▸ ${title}`);
}
function run(command, { cwd = root, env = {}, mutates = false } = {}) {
  console.info(`  $ ${command}${mutates && dryRun ? '   (skipped: --dry-run)' : ''}`);
  if (mutates && dryRun) return;
  try {
    execSync(command, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  } catch {
    fail(`Stopped: "${command}" failed (see the output above).`);
  }
}
function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

async function deployApi() {
  step('API: check backend/.env.production');
  run('yarn -s check-env .env.production', { cwd: join(root, 'backend') });

  step(`API: build the Node bundle (version ${version})`);
  run('yarn -s build:node', { cwd: join(root, 'backend'), env: { APP_VERSION: version } });

  const { HOSTMD_FTP_HOST: host, HOSTMD_FTP_USER: user, HOSTMD_FTP_PASSWORD: password } = deployEnv;
  const appDir = deployEnv.HOSTMD_APP_DIR || '/httpdocs';
  if (!host || !user || !password) {
    fail('Set HOSTMD_FTP_HOST, HOSTMD_FTP_USER and HOSTMD_FTP_PASSWORD in .env.deploy (Plesk → FTP Access).');
  }
  const dist = join(root, 'backend/dist/node');
  // The bundle goes up first under a temporary name and is then renamed, so the app never
  // starts from a half-uploaded file; restart.txt last tells Passenger to reload.
  const uploads = [
    ['package.json', join(dist, 'package.json')],
    ['version.json', join(dist, 'version.json')],
    ['app.js.map', join(dist, 'app.js.map')],
    ['public/robots.txt', join(dist, 'public/robots.txt')],
    ['.env', serverEnvFile],
  ];
  step(`API: upload to ${user}@${host}:${appDir} over FTPS`);
  for (const [remote] of [...uploads, ['app.js'], ['tmp/restart.txt']]) console.info(`  → ${appDir}/${remote}`);
  if (dryRun) return;

  const { Client } = await import('basic-ftp');
  const client = new Client(60_000);
  try {
    await client.access({ host, user, password, secure: true, secureOptions: { servername: host } });
    await client.ensureDir(appDir);
    await client.ensureDir(`${appDir}/public`);
    await client.ensureDir(`${appDir}/tmp`);
    await client.cd(appDir);
    for (const [remote, local] of uploads) await client.uploadFrom(local, remote);
    await client.uploadFrom(join(dist, 'app.js'), 'app.js.uploading');
    await client.rename('app.js.uploading', 'app.js');
    await client.uploadFrom(Readable.from([`restart ${new Date().toISOString()} ${version}\n`]), 'tmp/restart.txt');
    console.info('  ✓ uploaded; Passenger restarts the app on the next request');
  } finally {
    client.close();
  }
}

async function deployWeb() {
  step(`Web: build the PWA (version ${version})`);
  run('yarn -s build', { cwd: join(root, 'frontend'), env: { APP_VERSION: version } });

  const apiOrigin = deployEnv.API_ORIGIN || '';
  if (!apiOrigin) console.warn('  ! API_ORIGIN is empty in .env.deploy: /api will answer 503 until it is set.');
  if (syncSecret) {
    step('Web: sync PROXY_SECRET to the Worker');
    if (!serverEnv.PROXY_SECRET) fail('PROXY_SECRET is empty in backend/.env.production');
    console.info('  $ wrangler secret put PROXY_SECRET   (value from backend/.env.production)');
    if (!dryRun) {
      const result = spawnSync('npx', ['wrangler', 'secret', 'put', 'PROXY_SECRET'], {
        cwd: join(root, 'frontend'),
        input: serverEnv.PROXY_SECRET,
        stdio: ['pipe', 'inherit', 'inherit'],
        env: { ...process.env, ...cloudflareEnv },
      });
      if (result.status !== 0) fail('wrangler secret put failed');
    }
  }
  step('Web: deploy the Cloudflare Worker');
  run(`npx wrangler deploy --var API_ORIGIN:${apiOrigin}`, { cwd: join(root, 'frontend'), env: cloudflareEnv, mutates: true });
}

function verify() {
  const url = deployEnv.APP_URL || serverEnv.APP_URL;
  if (!url) fail('Set APP_URL in .env.deploy (or backend/.env.production) to verify.');
  step(`Verify ${url}`);
  run(`yarn -s deploy:verify ${url}${target === 'verify' ? '' : ` --version ${version}`}`, { cwd: join(root, 'backend'), mutates: true });
}

console.info(`Nails by Alynna deploy: ${target}${dryRun ? ' (dry run)' : ''}, version ${version}`);
if (dirty) console.warn('  ! the working tree has uncommitted changes; the version is marked -dirty');
if (target === 'api' || target === 'all') await deployApi();
if (target === 'web' || target === 'all') await deployWeb();
if (target === 'verify' || target === 'all') verify();
console.info('\nDone.');
