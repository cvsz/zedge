/** Minimal Cloudflare API v4 client. */
export class CFError extends Error {
  constructor(status, errors, path) {
    const msg = (errors && errors.length ? errors.map((e) => `${e.message}${e.code ? ` (${e.code})` : ''}`).join('; ') : `HTTP ${status}`);
    super(msg);
    this.status = status;
    this.errors = errors || [];
    this.path = path;
  }
}

/** @param {{ token: string, apiBase: string, fetchImpl?: typeof fetch }} options */
export function createCF({ token, apiBase, fetchImpl = fetch }) {
  /** @param {string} method @param {string} path @param {{ body?: any, query?: any, form?: any }} [opts] */
  async function raw(method, path, { body, query, form } = {}) {
    const url = new URL(apiBase + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== '') url.searchParams.set(k, v);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (!form) headers['Content-Type'] = 'application/json'; // multipart sets its own boundary
    const res = await fetchImpl(url, {
      method,
      headers,
      body: form || (body === undefined ? undefined : JSON.stringify(body)),
      signal: AbortSignal.timeout(30000)
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok || (json && json.success === false)) {
      throw new CFError(res.status || 502, json && json.errors, path);
    }
    return json || { success: true, result: null };
  }

  const cf = {
    raw,
    get: (p, query) => raw('GET', p, { query }),
    post: (p, body) => raw('POST', p, { body }),
    put: (p, body) => raw('PUT', p, { body }),
    patch: (p, body) => raw('PATCH', p, { body }),
    del: (p) => raw('DELETE', p),
    putForm: (p, form) => raw('PUT', p, { form }),
    patchForm: (p, form) => raw('PATCH', p, { form }),

    /** GraphQL Analytics API. */
    async graphql(query, variables) {
      const res = await fetchImpl(`${apiBase}/graphql`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30000)
      });
      let json = null;
      try { json = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok || !json || (json.errors && json.errors.length)) {
        throw new CFError(res.ok ? 400 : res.status || 502, ((json && json.errors) || []).map((e) => ({ message: e.message })), '/graphql');
      }
      return json.data;
    },

    /** Fetch every page of a list endpoint. */
    async listAll(path, query = {}) {
      const out = [];
      let page = 1;
      for (;;) {
        const r = await raw('GET', path, { query: { ...query, page, per_page: 100 } });
        out.push(...(r.result || []));
        const pages = (r.result_info && r.result_info.total_pages) || 1;
        if (page >= pages) break;
        page += 1;
        if (page > 50) break; // safety stop
      }
      return out;
    }
  };
  return cf;
}
