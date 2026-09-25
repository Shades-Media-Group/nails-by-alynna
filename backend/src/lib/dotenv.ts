import { existsSync, readFileSync } from 'node:fs';

/**
 * Minimal .env loader (works on any Node version a host may offer). Values already present
 * in the real environment win, so Plesk/hosting panel variables override the file.
 */
export function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = (match[2] ?? '').trim();
    const quoted = /^(['"]).*\1$/.exec(value);
    if (quoted) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
