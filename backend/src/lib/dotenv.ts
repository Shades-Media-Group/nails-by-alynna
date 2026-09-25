import { existsSync, readFileSync } from 'node:fs';

/** Parses KEY=value lines (optional `export`, quotes, trailing # comments). */
export function parseDotEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = (match[2] ?? '').trim();
    const quoted = /^(['"]).*\1$/.exec(value);
    if (quoted) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    values[match[1]!] = value;
  }
  return values;
}

/**
 * Minimal .env loader (works on any Node version a host may offer). Values already present
 * in the real environment win, so Plesk/hosting panel variables override the file.
 */
export function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  for (const [key, value] of Object.entries(parseDotEnv(readFileSync(path, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
