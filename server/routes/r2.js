import express from 'express';
import { Readable } from 'node:stream';
import { createR2 } from '../s3.js';
import { bad } from '../errors.js';

const BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

function objectKey(req) {
  const key = String(req.query.key || '');
  if (!key || Buffer.byteLength(key) > 1024 || /[\u0000-\u001f]/.test(key)) throw bad('Invalid object key');
  return key;
}

export function registerR2(app, ctx) {
  const { config, wrap, need, accountId } = ctx;
  const r2 = createR2(config, { fetchImpl: ctx.fetchImpl });

  app.param('bucket', (req, res, next, v) => (BUCKET_RE.test(v) ? next() : next(bad('Invalid bucket name'))));

  app.get('/api/r2/status', need('read'), (req, res) => res.json({ objectAccess: !!(config.r2.accessKeyId && config.r2.secretAccessKey), maxUploadBytes: config.r2MaxBytes }));

  app.get('/api/r2/:bucket/objects', need('read'), wrap(async (req, res) => {
    const prefix = String(req.query.prefix || '');
    if (prefix.length > 1024) throw bad('Prefix is too long');
    res.json(await r2.list(await accountId(req), req.params.bucket, { prefix, token: req.query.token ? String(req.query.token) : undefined }));
  }));

  // Upload: the browser sends the raw file body with Content-Type: application/octet-stream.
  app.put('/api/r2/:bucket/object', need('r2.write'), express.raw({ type: () => true, limit: config.r2MaxBytes }), wrap(async (req, res) => {
    const key = objectKey(req);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Choose a file to upload');
    const type = String(req.get('x-object-content-type') || 'application/octet-stream').slice(0, 200);
    await r2.put(await accountId(req), req.params.bucket, key, req.body, type);
    res.status(201).json({ key, size: req.body.length });
  }));

  app.get('/api/r2/:bucket/object', need('read'), wrap(async (req, res) => {
    const key = objectKey(req);
    const upstream = await r2.get(await accountId(req), req.params.bucket, key);
    const name = key.split('/').pop() || 'download';
    // Always served as an attachment with a neutral type, so a stored HTML file can never run in this origin.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    Readable.fromWeb(upstream.body).pipe(res);
  }));

  app.delete('/api/r2/:bucket/object', need('r2.write'), wrap(async (req, res) => {
    await r2.del(await accountId(req), req.params.bucket, objectKey(req));
    res.json({ ok: true });
  }));
}
