import { randomUUID } from 'node:crypto';

/** Sandbox only. There is no setting that points Sauda at the live API. */
export const PAYPAL_BASE = 'https://api-m.sandbox.paypal.com';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const WRITES = new Set<Method>(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface PayPalCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ErrorSummary {
  name?: unknown;
  message?: unknown;
  details?: { issue?: unknown; field?: unknown; value?: unknown; description?: unknown }[];
}

/** What a call log sees: never the token, the credentials or the request body. */
export interface CallLogEntry {
  label: string;
  method: Method;
  path: string;
  status: number;
  debugId: string | null;
  ms: number;
  requestId: string | null;
  error?: ErrorSummary | string;
  /** True for calls that should not go on the deal's money timeline (background polling). */
  quiet?: boolean;
}

export type OnCall = (dealId: string | undefined, entry: CallLogEntry) => void;

export interface PayPalResponse<T = any> {
  method: Method;
  path: string;
  status: number;
  ok: boolean;
  debugId: string | null;
  ms: number;
  requestId: string | null;
  body: T;
}

export interface CallOptions {
  body?: unknown;
  query?: Record<string, string>;
  /** PayPal-Request-Id (idempotency key). Writes get a random UUID when it is not given. */
  requestId?: string;
  prefer?: 'return=representation' | 'return=minimal';
  label?: string;
  /** The deal whose money timeline gets this call. */
  dealId?: string;
  quiet?: boolean;
}

export interface Token {
  accessToken: string;
  expiresAt: number;
  scope: string;
}

/** A PayPal call that failed: the error name, message and debug ID PayPal returned. */
export class PayPalCallError extends Error {
  constructor(
    readonly what: string,
    readonly status: number,
    readonly debugId: string | null,
    readonly summary: ErrorSummary | string | undefined,
  ) {
    const s = typeof summary === 'object' ? summary : undefined;
    super(`${what}: HTTP ${status} ${String(s?.name ?? '')} ${String(s?.message ?? (typeof summary === 'string' ? summary : ''))}`.trim());
    this.name = 'PayPalCallError';
  }

  get paypalName(): string {
    return typeof this.summary === 'object' && this.summary.name ? String(this.summary.name) : `HTTP_${this.status}`;
  }

  get paypalMessage(): string {
    if (typeof this.summary === 'string') return this.summary.slice(0, 300);
    const s = this.summary;
    const detail = s?.details?.map((d) => d.description ?? d.issue).filter(Boolean).join('; ');
    return [s?.message, detail].filter(Boolean).map(String).join(': ').slice(0, 300);
  }
}

/** The error parts worth logging. Long values (for example agreement text) are shortened. */
export function summarizeError(body: unknown): ErrorSummary | string | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body !== 'object') return String(body).slice(0, 300);
  const b = body as Record<string, any>;
  return {
    name: b.name ?? b.error,
    message: b.message ?? b.error_description,
    details: Array.isArray(b.details)
      ? b.details.map((d: any) => ({
          issue: d?.issue,
          field: d?.field,
          value: typeof d?.value === 'string' && d.value.length > 60 ? `${d.value.slice(0, 20)}...(${d.value.length} chars)` : d?.value,
          description: d?.description,
        }))
      : undefined,
  };
}

function sandboxUrl(p: string): URL {
  const url = new URL(p, PAYPAL_BASE);
  if (url.origin !== PAYPAL_BASE) throw new Error(`Refusing non-sandbox PayPal URL: ${url.origin}`);
  return url;
}

const TIMEOUT_MS = 30_000;

/**
 * Sandbox-only PayPal REST client. OAuth tokens are cached until a minute before they expire, and a
 * 401 clears the cache and retries once. Writes carry a PayPal-Request-Id. Every call is reported to
 * onCall with its status, debug ID and timing, never with the token or the body.
 */
export class PayPalClient {
  private cached: Token | null = null;
  private readonly fetch: typeof fetch;
  onCall: OnCall | undefined;

  constructor(
    private readonly creds: PayPalCredentials,
    opts: { onCall?: OnCall; fetch?: typeof fetch } = {},
  ) {
    this.onCall = opts.onCall;
    this.fetch = opts.fetch ?? ((...a) => globalThis.fetch(...a));
  }

  private report(dealId: string | undefined, entry: CallLogEntry): void {
    try {
      this.onCall?.(dealId, entry);
    } catch {
      // logging must never break a payment call
    }
  }

  /** The current access token (and its scopes), fetched with client credentials when needed. */
  async token(dealId?: string, quiet = false): Promise<Token> {
    if (this.cached && Date.now() < this.cached.expiresAt - 60_000) return this.cached;
    const basic = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString('base64');
    const t0 = performance.now();
    const res = await this.fetch(sandboxUrl('/v1/oauth2/token'), {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Math.round(performance.now() - t0);
    const debugId = res.headers.get('paypal-debug-id');
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    const error = res.ok ? undefined : summarizeError(body);
    this.report(dealId, { label: 'oauth-token', method: 'POST', path: '/v1/oauth2/token', status: res.status, debugId, ms, requestId: null, ...(error ? { error } : {}), ...(quiet ? { quiet } : {}) });
    if (!res.ok || typeof body.access_token !== 'string') throw new PayPalCallError('OAuth token', res.status, debugId, error);
    this.cached = { accessToken: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 0) * 1000, scope: String(body.scope ?? '') };
    return this.cached;
  }

  clearToken(): void {
    this.cached = null;
  }

  async call<T = any>(method: Method, p: string, opts: CallOptions = {}): Promise<PayPalResponse<T>> {
    const url = sandboxUrl(p);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const requestId = WRITES.has(method) ? (opts.requestId ?? randomUUID()) : null;
    const label = opts.label ?? `${method} ${url.pathname}`;
    const pathWithQuery = url.pathname + url.search;

    for (let attempt = 0; ; attempt++) {
      const { accessToken } = await this.token(opts.dealId, opts.quiet);
      const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
      // Invoicing answers 415 to a body-less POST without a JSON content type (generate-next-invoice-number).
      if (opts.body !== undefined || method === 'POST' || method === 'PUT' || method === 'PATCH') headers['Content-Type'] = 'application/json';
      if (requestId) headers['PayPal-Request-Id'] = requestId;
      if (opts.prefer) headers.Prefer = opts.prefer;
      const t0 = performance.now();
      let res: Response;
      try {
        res = await this.fetch(url, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        const ms = Math.round(performance.now() - t0);
        const error = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : 'network error';
        this.report(opts.dealId, { label, method, path: pathWithQuery, status: 0, debugId: null, ms, requestId, error, ...(opts.quiet ? { quiet: true } : {}) });
        throw new PayPalCallError(label, 0, null, error);
      }
      const ms = Math.round(performance.now() - t0);
      const text = await res.text();
      let body: any = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // keep the raw text
      }
      const debugId = res.headers.get('paypal-debug-id');
      const error = res.ok ? undefined : summarizeError(body);
      this.report(opts.dealId, { label, method, path: pathWithQuery, status: res.status, debugId, ms, requestId, ...(error ? { error } : {}), ...(opts.quiet ? { quiet: true } : {}) });
      if (res.status === 401 && attempt === 0) {
        // The cached token expired early or was revoked: get a new one and try once more.
        this.clearToken();
        continue;
      }
      return { method, path: pathWithQuery, status: res.status, ok: res.ok, debugId, ms, requestId, body };
    }
  }
}

/** Throws PayPalCallError unless the call succeeded. */
export function expectOk<T>(r: PayPalResponse<T>, what: string): PayPalResponse<T> {
  if (!r.ok) throw new PayPalCallError(what, r.status, r.debugId, summarizeError(r.body));
  return r;
}

/** "POST /v2/invoicing/invoices -> HTTP 201 (debug f1234, 812 ms)" */
export function line(r: { method: string; path: string; status: number; debugId: string | null; ms: number }): string {
  return `${r.method} ${r.path} -> HTTP ${r.status} (debug ${r.debugId ?? 'n/a'}, ${r.ms} ms)`;
}
