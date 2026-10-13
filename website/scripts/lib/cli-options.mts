/**
 * Option parsing and the write-target guard shared by the content CLIs that
 * write to an existing database (`cms:rollout-aanbod`, `cms:patch-booking-cta`).
 */

/** Value of `--flag value` or `--flag=value`; null when the flag is absent. */
export function valueOf(args: string[], flag: string): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      return value;
    }
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return null;
}

export function rejectUnknownOptions(args: string[], known: readonly string[]): void {
  for (const arg of args) {
    const flag = arg.split('=')[0];
    if (arg.startsWith('--') && !known.includes(flag)) throw new Error(`unknown option ${arg}`);
  }
}

/** Host part of DATABASE_URL — never the credentials. */
export function databaseHost(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return 'unparseable';
  }
}

/**
 * A write to Neon needs `--expect-host` equal to the DATABASE_URL host, so a
 * wrong branch (e.g. production) is refused before anything is read.
 */
export function assertWriteTarget(
  driver: string,
  host: string | null,
  expectHost: string | null,
): void {
  if (driver !== 'neon-http') return;
  if (!expectHost) {
    throw new Error(
      `--expect-host is required to write to Neon; this DATABASE_URL points at ${host}`,
    );
  }
  if (expectHost !== host) {
    throw new Error(`--expect-host ${expectHost} does not match DATABASE_URL host ${host}`);
  }
}
