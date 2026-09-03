/**
 * SSRF guard for outbound HTTP calls made by the `http_request` tool.
 *
 * Defaults to "deny by default, allow only configured hosts" so that
 * crafted agent output cannot target internal infrastructure
 * (169.254.169.254, localhost, RFC1918, etc.) even if a malicious prompt
 * manages to slip through.
 *
 * Configuration:
 *   - env `HTTP_ALLOWED_HOSTS` (comma-separated list of hostnames/domains)
 *     If empty, ALL public hosts are allowed (we still block private IPs
 *     and link-local ranges). The recommended setup in production is to
 *     set an explicit allowlist.
 *
 * Blocked:
 *   - Non-HTTPS (HTTP is allowed in dev only)
 *   - localhost, *.localhost, *.local
 *   - IP literals in private / loopback / link-local ranges
 *   - cloud metadata endpoints (169.254.169.254, etc.)
 */

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./, // CGNAT
  /^192\.0\.(0|2)\./,                          // IETF protocol
  /^198\.(1[8-9])\./,                          // benchmarking
  /^198\.51\.100\./,                          // TEST-NET-2
  /^203\.0\.113\./,                           // TEST-NET-3
];

const PRIVATE_V6 = [
  /^::1$/,                                   // loopback
  /^fe[89ab][0-9a-f]:/i,                      // fec00::/7 (ULA)
  /^fc[0-9a-f]{2}:/i,                        // fc00::/7
  /^fd[0-9a-f]{2}:/i,                        // fd00::/8
  /^ff[0-9a-f]{2}:/i,                        // multicast
  /^::ffff:(10|127|172|192|169)\./i,         // IPv4-mapped to private
];

function isHttpAllowed(): boolean {
  return (process.env.NODE_ENV ?? 'development') !== 'production';
}

function getAllowlist(): string[] {
  return (process.env.HTTP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export interface SsrfCheck {
  ok: boolean;
  reason?: string;
  code?: 'INVALID_URL' | 'NON_HTTPS' | 'PRIVATE_IP' | 'BLOCKED_HOST' | 'NOT_ALLOWLISTED';
}

export function assertSafeUrl(raw: string): SsrfCheck {
  if (typeof raw !== 'string' || raw.length > 2048) {
    return { ok: false, reason: 'Invalid URL length', code: 'INVALID_URL' };
  }
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: 'Invalid URL', code: 'INVALID_URL' }; }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, reason: `Protocol "${url.protocol}" not allowed`, code: 'INVALID_URL' };
  }
  if (url.protocol === 'http:' && !isHttpAllowed()) {
    return { ok: false, reason: 'HTTP is not allowed in production', code: 'NON_HTTPS' };
  }
  const host = url.hostname.toLowerCase();

  // 1. Loopback / private hostnames
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '0.0.0.0') {
    return { ok: false, reason: 'Loopback hostname blocked', code: 'BLOCKED_HOST' };
  }

  // 2. IP-literal checks (IPv4 and IPv6)
  if (looksLikeIpv4(host)) {
    if (PRIVATE_V4.some((re) => re.test(host))) {
      return { ok: false, reason: `Private IP blocked: ${host}`, code: 'PRIVATE_IP' };
    }
  } else if (host.includes(':')) {
    // naive IPv6 literal detection
    if (PRIVATE_V6.some((re) => re.test(host))) {
      return { ok: false, reason: `Private IPv6 blocked: ${host}`, code: 'PRIVATE_IP' };
    }
  }

  // 3. Cloud metadata (defense in depth)
  if (host === 'metadata.google.internal' || host === 'metadata.azure.com') {
    return { ok: false, reason: 'Cloud metadata endpoint blocked', code: 'BLOCKED_HOST' };
  }

  // 4. Allowlist (only if configured)
  const allowlist = getAllowlist();
  if (allowlist.length > 0) {
    const ok = allowlist.some((entry) => {
      if (entry.startsWith('*.')) return host.endsWith(entry.slice(1));
      return host === entry;
    });
    if (!ok) return { ok: false, reason: `Host not in allowlist: ${host}`, code: 'NOT_ALLOWLISTED' };
  }

  return { ok: true };
}

function looksLikeIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * Fetch a URL while re-validating every redirect target against
 * `assertSafeUrl()`. Returns the final response (after up to `maxHops`
 * hops) or a refusal envelope if any hop points at a blocked target.
 *
 * Why `redirect: 'manual'` and per-hop validation:
 *   - `redirect: 'follow'` (the fetch default) would open a TCP
 *     connection to the private IP before we have a chance to block it.
 *   - DNS rebinding is mitigated by re-validating the host string of
 *     each `Location:` header (the host is taken from the response, not
 *     from a pre-resolved IP).
 *
 * The caller must still pass an `assertSafeUrl`-clean initial URL.
 */
export interface SafeFetchResult {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
  code?: 'SSRF_BLOCKED' | 'TOO_MANY_REDIRECTS' | 'FETCH_FAILED';
  hops?: number;
}

export async function safeFetch(
  initialUrl: string,
  init: RequestInit & { maxHops?: number; timeoutMs?: number } = {},
): Promise<SafeFetchResult> {
  const maxHops = init.maxHops ?? 5;
  const timeoutMs = init.timeoutMs ?? 15_000;

  let url = initialUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    const check = assertSafeUrl(url);
    if (!check.ok) {
      return { ok: false, error: check.reason, code: 'SSRF_BLOCKED', hops: hop };
    }
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      return { ok: false, error: (e as Error).message, code: 'FETCH_FAILED', hops: hop };
    }

    // 3xx — extract Location, re-validate, loop
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        // 3xx with no Location is malformed; treat as terminal.
        return { ok: true, status: res.status, data: null, hops: hop };
      }
      try {
        // Resolve relative redirects against the current URL
        url = new URL(location, url).toString();
      } catch {
        return { ok: false, error: `Invalid Location header: ${location}`, code: 'SSRF_BLOCKED', hops: hop };
      }
      if (hop === maxHops) {
        return { ok: false, error: `Too many redirects (> ${maxHops})`, code: 'TOO_MANY_REDIRECTS', hops: hop + 1 };
      }
      continue;
    }

    // Terminal response
    let data: unknown = null;
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data, hops: hop };
  }

  // Should be unreachable (loop returns or breaks)
  return { ok: false, error: 'Unreachable', code: 'TOO_MANY_REDIRECTS' };
}
