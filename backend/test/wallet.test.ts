import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { importSPKI, jwtVerify, decodeProtectedHeader } from 'jose';
import forge from 'node-forge';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

/*
 * The loyalty card in Apple Wallet and Google Wallet. Test credentials are made here: a
 * stand-in "WWDR" authority that issues the pass certificate, and an RSA key for Google.
 */

const PASS_TYPE_ID = 'pass.md.nailsbyalynna.test';
const TEAM_ID = 'ABCDE12345';
const ISSUER_ID = '3388000000012345678';
const SERVICE_ACCOUNT = 'wallet@nails-test.iam.gserviceaccount.com';

function rsaPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey,
  };
}

function certificate(opts: {
  subject: forge.pki.CertificateField[];
  issuer: forge.pki.CertificateField[];
  publicPem: string;
  signingPem: string;
  ca?: boolean;
  serial: string;
}): string {
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(opts.publicPem);
  cert.serialNumber = opts.serial;
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2028-01-01T00:00:00Z');
  cert.setSubject(opts.subject);
  cert.setIssuer(opts.issuer);
  if (opts.ca) cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, digitalSignature: true }]);
  cert.sign(forge.pki.privateKeyFromPem(opts.signingPem), forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

const wwdrKeys = rsaPair();
const signerKeys = rsaPair();
const googleKeys = rsaPair();
const wwdrName = [{ name: 'commonName', value: 'Test WWDR' }, { name: 'organizationalUnitName', value: 'G4' }];
const WWDR_PEM = certificate({ subject: wwdrName, issuer: wwdrName, publicPem: wwdrKeys.publicPem, signingPem: wwdrKeys.privatePem, ca: true, serial: '01' });
const SIGNER_PEM = certificate({
  subject: [
    { type: '0.9.2342.19200300.100.1.1', value: PASS_TYPE_ID },
    { name: 'commonName', value: `Pass Type ID: ${PASS_TYPE_ID}` },
    { name: 'organizationalUnitName', value: TEAM_ID },
  ],
  issuer: wwdrName,
  publicPem: signerKeys.publicPem,
  signingPem: wwdrKeys.privatePem,
  serial: '02',
});
// The key encrypted, as a .p12 export leaves it.
const ENCRYPTED_KEY = signerKeys.privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'nails' }).toString();

const base64 = (text: string) => Buffer.from(text).toString('base64');
const APPLE_ENV = {
  APPLE_WALLET_PASS_TYPE_ID: PASS_TYPE_ID,
  APPLE_WALLET_TEAM_ID: TEAM_ID,
  APPLE_WALLET_SIGNER_CERT: base64(SIGNER_PEM),
  APPLE_WALLET_SIGNER_KEY: base64(ENCRYPTED_KEY),
  APPLE_WALLET_SIGNER_KEY_PASSPHRASE: 'nails',
  // A raw PEM with "\n" escapes, as it looks pasted on one line.
  APPLE_WALLET_WWDR_CERT: WWDR_PEM.replace(/\n/g, '\\n'),
};
const GOOGLE_ENV = {
  GOOGLE_WALLET_ISSUER_ID: ISSUER_ID,
  GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: SERVICE_ACCOUNT,
  // As in the service account's JSON key.
  GOOGLE_WALLET_PRIVATE_KEY: googleKeys.privatePem.replace(/\n/g, '\\n'),
};

/** The files of a zip (stored or deflated entries), from its central directory. */
function unzip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at += 46 + nameLength + extra;
  }
  return files;
}

const sha1 = (data: Buffer) => createHash('sha1').update(data).digest('hex');

async function asBuffer(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

describe('Wallet settings', () => {
  const base = { APP_ENV: 'test', DATABASE_URL: 'postgres://x@localhost/x', JWT_SECRET: 'test-secret-'.padEnd(48, 'x') };

  it('stays off, naming what is missing, until every value is in', () => {
    expect(loadConfig(base).wallet).toEqual({ apple: undefined, google: undefined, missing: { apple: [], google: [] } });
    const partial = loadConfig({ ...base, APPLE_WALLET_PASS_TYPE_ID: PASS_TYPE_ID, GOOGLE_WALLET_ISSUER_ID: ISSUER_ID });
    expect(partial.wallet.apple).toBeUndefined();
    expect(partial.wallet.missing.apple).toEqual([
      'APPLE_WALLET_TEAM_ID',
      'APPLE_WALLET_SIGNER_CERT',
      'APPLE_WALLET_SIGNER_KEY',
      'APPLE_WALLET_WWDR_CERT',
    ]);
    expect(partial.wallet.missing.google).toEqual(['GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_WALLET_PRIVATE_KEY']);
  });

  it('refuses credentials that could never make a valid pass, saying which one', () => {
    expect(() => loadConfig({ ...base, ...APPLE_ENV, APPLE_WALLET_PASS_TYPE_ID: 'pass.md.other' })).toThrow(/is for pass\.md\.nailsbyalynna\.test/);
    expect(() => loadConfig({ ...base, ...APPLE_ENV, APPLE_WALLET_TEAM_ID: 'ZZZZZ99999' })).toThrow(/belongs to team ABCDE12345/);
    expect(() => loadConfig({ ...base, ...APPLE_ENV, APPLE_WALLET_SIGNER_KEY_PASSPHRASE: 'wrong' })).toThrow(/SIGNER_KEY_PASSPHRASE does not open it/);
    expect(() => loadConfig({ ...base, ...APPLE_ENV, APPLE_WALLET_SIGNER_KEY: base64(rsaPair().privatePem) })).toThrow(/is not the key of/);
    expect(() => loadConfig({ ...base, ...APPLE_ENV, APPLE_WALLET_WWDR_CERT: base64(SIGNER_PEM) })).toThrow(/did not issue/);
    expect(() => loadConfig({ ...base, ...GOOGLE_ENV, GOOGLE_WALLET_PRIVATE_KEY: 'not a key' })).toThrow(/GOOGLE_WALLET_PRIVATE_KEY is not a PEM private key/);
    expect(loadConfig({ ...base, ...APPLE_ENV, ...GOOGLE_ENV }).wallet.apple?.certificateExpiresAt.toISOString()).toBe('2028-01-01T00:00:00.000Z');
  });
});

describe('Wallet without credentials', () => {
  let ctx: TestContext;
  let client: TestClient;

  beforeAll(async () => {
    ctx = await createTestContext();
    client = (await registerClient(ctx)).client;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('says neither Wallet is set up and offers no pass', async () => {
    expect((await client.get('/api/wallet')).body).toEqual({ apple: false, google: false });
    for (const path of ['/api/wallet/apple', '/api/wallet/apple/link', '/api/wallet/google']) {
      const res = await client.get(path);
      expect(res.status, path).toBe(404);
      expect(res.body.error.code).toBe('WALLET_UNAVAILABLE');
    }
  });

  it('answers only signed-in clients', async () => {
    for (const path of ['/api/wallet', '/api/wallet/apple', '/api/wallet/apple/link', '/api/wallet/google']) {
      expect((await ctx.client().get(path)).status, path).toBe(401);
    }
  });
});

describe('Wallet with credentials', () => {
  let ctx: TestContext;
  let owner: TestClient;
  let client: TestClient;
  let clientId: string;

  beforeAll(async () => {
    ctx = await createTestContext({ ...APPLE_ENV, ...GOOGLE_ENV });
    await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' } });
    owner = await loginAs(ctx, 'owner@example.com', strongPassword);
    const registered = await registerClient(ctx, { name: 'Ana', surname: 'Rusu' });
    client = registered.client;
    clientId = registered.user.id;
    // Three stamps on the card.
    for (let i = 0; i < 3; i++) {
      expect((await owner.post(`/api/admin/loyalty/clients/${clientId}/stamps`, { delta: 1 })).status).toBe(200);
    }
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('says both Wallets are set up; staff get no pass', async () => {
    expect((await client.get('/api/wallet')).body).toEqual({ apple: true, google: true });
    expect((await owner.get('/api/wallet/apple')).status).toBe(403);
    expect((await owner.get('/api/wallet/google')).status).toBe(403);
  });

  it('signs a .pkpass: the card in pass.json, every file in the manifest, a detached signature', async () => {
    const res = await ctx.app.request('/api/wallet/apple', { headers: { cookie: client.cookieHeader() } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.apple.pkpass');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="nails-by-alynna.pkpass"');
    const files = unzip(await asBuffer(res));
    expect([...files.keys()].sort()).toEqual([
      'icon.png',
      'icon@2x.png',
      'icon@3x.png',
      'logo.png',
      'logo@2x.png',
      'logo@3x.png',
      'manifest.json',
      'pass.json',
      'signature',
    ]);

    const pass = JSON.parse(files.get('pass.json')!.toString('utf8'));
    const record = await ctx.deps.col.walletPasses.findOne({});
    expect(record?.serialNumber).toMatch(/^[0-9a-f-]{36}$/);
    expect(record?.authenticationToken.length).toBeGreaterThanOrEqual(16);
    expect(pass).toMatchObject({
      formatVersion: 1,
      passTypeIdentifier: PASS_TYPE_ID,
      teamIdentifier: TEAM_ID,
      serialNumber: record!.serialNumber,
      organizationName: 'Nails by Alynna',
      logoText: 'Nails by Alynna',
      description: 'Cardul de fidelitate Nails by Alynna',
      backgroundColor: 'rgb(253, 231, 252)',
    });
    expect(pass.storeCard.headerFields).toEqual([{ key: 'stamps', label: 'Ștampile', value: '3/8' }]);
    expect(pass.storeCard.primaryFields).toEqual([{ key: 'member', label: 'Membru', value: 'Ana Rusu' }]);
    expect(pass.storeCard.secondaryFields).toEqual([{ key: 'next', label: 'Următoarea reducere', value: '−15% la următoarea vizită' }]);
    const back = Object.fromEntries(pass.storeCard.backFields.map((f: { key: string; value: string }) => [f.key, f.value]));
    expect(back.phone).toBe('+37368230429');
    expect(back.address).toBe('Chișinău');
    expect(back.how).toContain('A 4-a vizită de pe fiecare card: −15% la acea vizită.');
    const code = (await client.get('/api/loyalty')).body.card.code as string;
    expect(pass.barcodes).toEqual([
      {
        format: 'PKBarcodeFormatQR',
        message: `http://localhost:5180/c/${code}`,
        messageEncoding: 'iso-8859-1',
        altText: `${code.slice(0, 4)} ${code.slice(4)}`,
      },
    ]);

    const manifestFile = files.get('manifest.json')!;
    const manifest = JSON.parse(manifestFile.toString('utf8'));
    const signed = [...files.keys()].filter((name) => name !== 'manifest.json' && name !== 'signature').sort();
    expect(Object.keys(manifest).sort()).toEqual(signed);
    for (const name of signed) expect(manifest[name], name).toBe(sha1(files.get(name)!));

    // PKCS #7 signed data carrying both certificates; the signer's attributes hold the manifest's
    // digest and are signed with the pass certificate's key.
    const der = forge.util.createBuffer(files.get('signature')!.toString('binary'));
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der)) as forge.pkcs7.PkcsSignedData & {
      rawCapture: { signerInfos: forge.asn1.Asn1[] };
    };
    expect(p7.certificates.map((c) => c.serialNumber).sort()).toEqual(['01', '02']);
    // SignerInfo: version, issuerAndSerialNumber, digestAlgorithm, [0] attributes, signature algorithm, signature.
    const signerInfo = p7.rawCapture.signerInfos[0]!.value as forge.asn1.Asn1[];
    const attributesAt = signerInfo.findIndex((part) => part.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && part.type === 0);
    const attributes = signerInfo[attributesAt]!.value as forge.asn1.Asn1[];
    const signature = signerInfo[attributesAt + 2]!.value as string;
    const digestAttribute = attributes.find(
      (a) => forge.asn1.derToOid((a.value as forge.asn1.Asn1[])[0]!.value as string) === forge.pki.oids.messageDigest!,
    );
    const digest = ((digestAttribute!.value as forge.asn1.Asn1[])[1]!.value as forge.asn1.Asn1[])[0]!.value as string;
    expect(forge.util.bytesToHex(digest)).toBe(sha1(manifestFile));
    const signedAttributes = forge.asn1.toDer(forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attributes));
    expect(
      verify('sha1', Buffer.from(signedAttributes.getBytes(), 'binary'), SIGNER_PEM, Buffer.from(signature, 'binary')),
    ).toBe(true);

    // The same card (serial) every time it is added.
    const again = unzip(await asBuffer(await ctx.app.request('/api/wallet/apple', { headers: { cookie: client.cookieHeader() } })));
    expect(JSON.parse(again.get('pass.json')!.toString('utf8')).serialNumber).toBe(record!.serialNumber);
    expect((await ctx.deps.col.walletPasses.countDocuments({}))).toBe(1);
  });

  it('opens the pass through a short-lived signed link, without the session cookie', async () => {
    const { url } = (await client.get('/api/wallet/apple/link')).body as { url: string };
    expect(url).toMatch(/^\/api\/wallet\/apple\/pass\/[a-f0-9]{24}\.\d+\.[A-Za-z0-9_-]{43}\.pkpass$/);
    const res = await ctx.app.request(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.apple.pkpass');
    expect(unzip(await asBuffer(res)).has('pass.json')).toBe(true);

    expect((await ctx.app.request(url.replace(/.\.pkpass$/, (m) => `${m[0] === 'A' ? 'B' : 'A'}.pkpass`))).status).toBe(404);
    ctx.advance(11 * 60_000);
    expect((await ctx.app.request(url)).status).toBe(404);
  });

  it('makes an "Add to Google Wallet" link whose JWT verifies with the service account key', async () => {
    const res = await client.get('/api/wallet/google');
    expect(res.status).toBe(200);
    const url = res.body.url as string;
    expect(url.startsWith('https://pay.google.com/gp/v/save/')).toBe(true);
    const token = url.slice('https://pay.google.com/gp/v/save/'.length);
    // Google's safe length for a save link's JWT.
    expect(token.length).toBeLessThan(1800);
    expect(decodeProtectedHeader(token)).toEqual({ alg: 'RS256', typ: 'JWT' });
    const { payload } = await jwtVerify(token, await importSPKI(googleKeys.publicPem, 'RS256'), {
      issuer: SERVICE_ACCOUNT,
      audience: 'google',
      currentDate: ctx.now(),
    });
    expect(payload.typ).toBe('savetowallet');
    expect(payload.origins).toEqual(['http://localhost:5180']);
    const { loyaltyClasses, loyaltyObjects } = payload.payload as { loyaltyClasses: any[]; loyaltyObjects: any[] };
    const serial = (await ctx.deps.col.walletPasses.findOne({}))!.serialNumber;
    expect(loyaltyClasses).toEqual([
      expect.objectContaining({
        id: `${ISSUER_ID}.loyalty`,
        issuerName: 'Nails by Alynna',
        programName: 'Card de fidelitate',
        programLogo: { sourceUri: { uri: 'http://localhost:5180/wallet/logo.png' } },
        reviewStatus: 'UNDER_REVIEW',
      }),
    ]);
    const code = (await client.get('/api/loyalty')).body.card.code as string;
    expect(loyaltyObjects).toEqual([
      {
        id: `${ISSUER_ID}.${serial}`,
        classId: `${ISSUER_ID}.loyalty`,
        state: 'ACTIVE',
        accountName: 'Ana Rusu',
        loyaltyPoints: { label: 'Ștampile', balance: { string: '3/8' } },
        barcode: { type: 'QR_CODE', value: `http://localhost:5180/c/${code}`, alternateText: `${code.slice(0, 4)} ${code.slice(4)}` },
      },
    ]);
    expect((await ctx.deps.col.walletPasses.findOne({}))?.googleIssuedAt).toBeInstanceOf(Date);
  });

  it('forgets the pass record when the client deletes the account', async () => {
    expect(await ctx.deps.col.walletPasses.countDocuments({})).toBe(1);
    expect((await client.delete('/api/me', { password: strongPassword })).status).toBe(200);
    expect(await ctx.deps.col.walletPasses.countDocuments({})).toBe(0);
  });
});
