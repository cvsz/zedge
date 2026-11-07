import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createValidator } from './validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_DIR = path.join(here, '..', 'schemas');

/** Every schema file under schemas/, keyed by its path without ".json" (for example "events/ClickRecorded.v1"). */
export function loadSchemas(dir = SCHEMA_DIR) {
  const out = {};
  const walk = (d, prefix) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) {walk(path.join(d, f.name), `${prefix}${f.name}/`);}
      else if (f.name.endsWith('.json')) {out[`${prefix}${f.name.slice(0, -5)}`] = JSON.parse(fs.readFileSync(path.join(d, f.name), 'utf8'));}
    }
  };
  walk(dir, '');
  return out;
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const validator = createValidator(loadSchemas());
export const EVENT_TYPES = loadSchemas()['event-envelope'].properties.type.enum;
export const ENTITIES = ['link', 'click', 'content', 'publication', 'approval-request'];

/** Validate an entity such as "link" or "content". */
export function validateEntity(name, value) {
  if (!ENTITIES.includes(name)) {throw new Error(`Unknown entity ${name}`);}
  return validator.validate(name, value);
}

/** Validate an event envelope and then its payload against the schema for its type and version. */
export function validateEvent(envelope) {
  const env = validator.validate('event-envelope', envelope);
  if (!env.valid) {return env;}
  const name = `events/${envelope.type}.v${envelope.version}`;
  if (!validator.has(name)) {return { valid: false, errors: [`$: no schema for ${envelope.type} version ${envelope.version}`] };}
  const p = validator.validate(name, envelope.payload);
  return { valid: p.valid, errors: p.errors.map((e) => e.replace(/^\$/, '$.payload')) };
}

/** Build an envelope (id and time filled in) and refuse to return one that does not validate. */
export function makeEvent({ type, organization_id, payload, correlation_id, version = 1, id = crypto.randomUUID(), occurred_at = new Date().toISOString() }) {
  const ev = { id, type, version, organization_id, occurred_at, correlation_id: correlation_id || crypto.randomUUID(), payload };
  const r = validateEvent(ev);
  if (!r.valid) {throw new Error(`Invalid ${type} event: ${r.errors.join('; ')}`);}
  return ev;
}

export { createValidator };
