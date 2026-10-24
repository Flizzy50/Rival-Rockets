// Pure WebSocket origin check (Requirement 7.2–7.4, design M2-7). Env values
// and headers are passed in; main.ts reads process.env.

export interface OriginEnv {
  RENDER_EXTERNAL_URL?: string | undefined;
  ALLOWED_ORIGINS?: string | undefined;
}

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

// Returns the serialized origin, or null for anything that is not an
// http(s) URL. Opaque origins serialize as "null" and are never allowed.
function serializeOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (!WEB_PROTOCOLS.has(url.protocol)) return null;
  return url.origin;
}

// RENDER_EXTERNAL_URL is one URL; ALLOWED_ORIGINS is comma-separated.
// Malformed entries are skipped so one typo does not open or close everything.
export function buildAllowedOrigins(env: OriginEnv): ReadonlySet<string> {
  const entries = [env.RENDER_EXTERNAL_URL ?? '', ...(env.ALLOWED_ORIGINS ?? '').split(',')];
  const allowed = new Set<string>();
  for (const entry of entries) {
    if (entry.trim() === '') continue;
    const origin = serializeOrigin(entry);
    if (origin !== null) allowed.add(origin);
  }
  return allowed;
}

// Browsers send the serialized origin, so the header must already be in that
// form; anything with a path, credentials, or odd casing is refused.
export function isOriginAllowed(
  origin: string | undefined,
  host: string | undefined,
  allowed: ReadonlySet<string>,
  devMode: boolean,
): boolean {
  if (origin === undefined || origin === '') return false;
  const serialized = serializeOrigin(origin);
  if (serialized === null || serialized !== origin) return false;
  if (allowed.has(serialized)) return true;
  if (!devMode || host === undefined || host === '') return false;
  // Dev only: LAN IPs change, so accept the page that the request was sent to.
  // A cross-site page still has a different host than the Host header.
  return new URL(serialized).host === host.trim().toLowerCase();
}
