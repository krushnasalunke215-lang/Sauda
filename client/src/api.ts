export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
  }
}

async function handle<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'generic', data.details);
  return data as T;
}

/** fetch wrapper: JSON in and out, and the deal token in the X-Sauda-Token header. */
export async function api<T>(path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['X-Sauda-Token'] = opts.token;
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return handle<T>(res);
}

/** POSTs raw bytes (a voice clip or a photo) with their own Content-Type. */
export async function upload<T>(path: string, opts: { token: string; body: Blob; contentType: string }): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': opts.contentType, 'X-Sauda-Token': opts.token }, body: opts.body });
  return handle<T>(res);
}
