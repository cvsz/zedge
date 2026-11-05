import crypto from 'node:crypto';
import { HttpError } from './errors.js';

const sha256hex = (d) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** AWS Signature Version 4 for a single request. `pathname` is the decoded path starting with "/". */
export function signV4({ method, host, pathname, query = {}, headers = {}, payloadHash, accessKeyId, secretAccessKey, region = 'auto', service = 's3', amzDate }) {
  const dateStamp = amzDate.slice(0, 8);
  const h = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  const names = Object.keys(h).sort();
  const canonicalHeaders = names.map((n) => `${n}:${h[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&');
  const canonicalUri = pathname.split('/').map(enc).join('/');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service), 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');
  return {
    signature,
    signedHeaders,
    canonicalUri,
    canonicalQuery,
    headers: h,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? decodeXml(m[1]) : undefined; };
const all = (x, t) => [...x.matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'g'))].map((m) => m[1]);

export function parseList(xml) {
  return {
    objects: all(xml, 'Contents').map((c) => ({ key: tag(c, 'Key'), size: Number(tag(c, 'Size') || 0), modified: tag(c, 'LastModified'), etag: tag(c, 'ETag') })),
    prefixes: all(xml, 'CommonPrefixes').map((c) => tag(c, 'Prefix')),
    truncated: tag(xml, 'IsTruncated') === 'true',
    nextToken: tag(xml, 'NextContinuationToken') || null
  };
}

/** R2 object operations over its S3-compatible API (needs an R2 access key pair). */
export function createR2(config, { fetchImpl = fetch } = {}) {
  /** @param {any} accountId @param {string} method @param {string} bucket @param {string} key @param {{ query?: any, body?: any, contentType?: string }} [opts] */
  async function call(accountId, method, bucket, key, { query = {}, body, contentType } = {}) {
    const { accessKeyId, secretAccessKey, endpoint } = config.r2;
    if (!accessKeyId || !secretAccessKey) {
      throw new HttpError(409, 'Object browsing needs an R2 access key. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (create them under R2 > Manage API tokens).');
    }
    const base = new URL(endpoint || `https://${accountId}.r2.cloudflarestorage.com`);
    const pathname = key === undefined ? `/${bucket}` : `/${bucket}/${key}`;
    const payload = body && body.length ? body : Buffer.alloc(0);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const headers = contentType ? { 'content-type': contentType } : {};
    const signed = signV4({ method, host: base.host, pathname, query, headers, payloadHash: sha256hex(payload), accessKeyId, secretAccessKey, amzDate });
    const qs = Object.keys(query).length ? `?${signed.canonicalQuery}` : '';
    const res = await fetchImpl(`${base.origin}${signed.canonicalUri}${qs}`, {
      method,
      headers: { ...signed.headers, authorization: signed.authorization },
      body: method === 'PUT' ? payload : undefined,
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const code = tag(text, 'Code') || `HTTP ${res.status}`;
      const msg = tag(text, 'Message') || '';
      const status = res.status === 404 ? 404 : 502;
      throw new HttpError(status, `R2: ${code}${msg ? ` - ${msg}` : ''}`);
    }
    return res;
  }

  return {
    /** @param {any} accountId @param {string} bucket @param {{ prefix?: string, token?: string }} [opts] */
    async list(accountId, bucket, { prefix = '', token } = {}) {
      const query = { 'list-type': '2', delimiter: '/', 'max-keys': '200' };
      if (prefix) query.prefix = prefix;
      if (token) query['continuation-token'] = token;
      return parseList(await (await call(accountId, 'GET', bucket, undefined, { query })).text());
    },
    put: (accountId, bucket, key, body, contentType) => call(accountId, 'PUT', bucket, key, { body, contentType }),
    get: (accountId, bucket, key) => call(accountId, 'GET', bucket, key),
    async del(accountId, bucket, key) { await call(accountId, 'DELETE', bucket, key); }
  };
}
