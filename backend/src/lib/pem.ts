import { createPrivateKey, X509Certificate, type KeyObject } from 'node:crypto';

/*
 * Certificates and keys kept in environment variables, where a value is one line: the PEM with
 * "\n" for its line breaks (as a Google service-account JSON has it), or the whole file in
 * base64. A certificate can also be the base64 of the DER file Apple hands out (.cer).
 */

function decode(value: string): string | Buffer {
  const text = value.trim().replace(/^(['"])(.*)\1$/s, '$2').replace(/\\n/g, '\n');
  if (text.includes('-----BEGIN ')) return text;
  const bytes = Buffer.from(text.replace(/\s+/g, ''), 'base64');
  const decoded = bytes.toString('utf8');
  return decoded.includes('-----BEGIN ') ? decoded.replace(/\\n/g, '\n') : bytes;
}

export function certificateFromEnv(name: string, value: string): X509Certificate {
  try {
    return new X509Certificate(decode(value));
  } catch {
    throw new Error(`Invalid configuration: ${name} is not a certificate (paste the PEM, or the file in base64 on one line)`);
  }
}

/** An RSA private key; `passphrase` opens an encrypted one (its variable is named in errors). */
export function rsaKeyFromEnv(name: string, value: string, passphrase?: { name: string; value: string | undefined }): KeyObject {
  let key: KeyObject;
  try {
    const pem = decode(value);
    if (typeof pem !== 'string') throw new Error('not a PEM');
    key = createPrivateKey({ key: pem, format: 'pem', passphrase: passphrase?.value });
  } catch {
    const hint = passphrase ? `, or ${passphrase.name} does not open it` : '';
    throw new Error(`Invalid configuration: ${name} is not a PEM private key (the PEM, or the file in base64 on one line)${hint}`);
  }
  if (key.asymmetricKeyType !== 'rsa') throw new Error(`Invalid configuration: ${name} must be an RSA key`);
  return key;
}
