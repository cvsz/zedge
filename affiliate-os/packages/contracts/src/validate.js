/**
 * A small JSON Schema validator: the subset the contracts use, with no dependencies.
 * Supported: type, enum, const, pattern, minLength, maxLength, minimum, maximum, items, minItems, maxItems,
 * properties, required, additionalProperties (false or a schema), format (uuid, date-time, date, uri-https, email),
 * oneOf, $ref ("#/$defs/x" or "name#/$defs/x" into another registered schema).
 * Unknown keywords are rejected when the schema is registered, so a typo cannot silently weaken a contract.
 */
const KNOWN = new Set(['$id', '$schema', '$ref', '$defs', 'title', 'description', 'type', 'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'items', 'minItems', 'maxItems', 'properties', 'required', 'additionalProperties', 'format', 'oneOf', 'x-version', 'examples']);

const FORMATS = {
  uuid: (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  'date-time': (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)),
  date: (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)),
  'uri-https': (s) => { try { return new URL(s).protocol === 'https:'; } catch { return false; } },
  email: (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)
};

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'integer' ? Number.isInteger(v) : typeOf(v) === t);

export function checkSchema(schema, path = '#') {
  if (typeof schema !== 'object' || schema === null) throw new Error(`${path}: schema must be an object`);
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) throw new Error(`${path}: unknown keyword "${k}"`);
  for (const [k, v] of Object.entries(schema.properties || {})) checkSchema(v, `${path}/properties/${k}`);
  for (const [k, v] of Object.entries(schema.$defs || {})) checkSchema(v, `${path}/$defs/${k}`);
  if (schema.items) checkSchema(schema.items, `${path}/items`);
  if (schema.oneOf) schema.oneOf.forEach((s, i) => checkSchema(s, `${path}/oneOf/${i}`));
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') checkSchema(schema.additionalProperties, `${path}/additionalProperties`);
}

export function createValidator(registry = {}) {
  const schemas = new Map();
  for (const [name, s] of Object.entries(registry)) { checkSchema(s, name); schemas.set(name, s); }

  function resolve(ref, current) {
    const [name, pointer] = ref.split('#');
    const root = name ? schemas.get(name) : current;
    if (!root) throw new Error(`Unknown schema reference ${ref}`);
    let node = root;
    for (const part of (pointer || '').split('/').filter(Boolean)) node = node && node[part];
    if (!node) throw new Error(`Unresolved reference ${ref}`);
    return { node, root };
  }

  function walk(value, schema, root, path, errors) {
    if (schema.$ref) { const r = resolve(schema.$ref, root); return walk(value, r.node, r.root, path, errors); }
    const err = (m) => errors.push(`${path}: ${m}`);
    if (schema.type) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((t) => isType(value, t))) { err(`expected ${types.join(' or ')}, got ${typeOf(value)}`); return; }
    }
    if (schema.const !== undefined && value !== schema.const) err(`must equal ${JSON.stringify(schema.const)}`);
    if (schema.enum && !schema.enum.includes(value)) err(`must be one of ${schema.enum.join(', ')}`);
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) err(`shorter than ${schema.minLength}`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) err(`longer than ${schema.maxLength}`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) err(`does not match ${schema.pattern}`);
      if (schema.format) { const f = FORMATS[schema.format]; if (!f) throw new Error(`Unknown format ${schema.format}`); if (!f(value)) err(`not a valid ${schema.format}`); }
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) err(`below ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) err(`above ${schema.maximum}`);
      if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) err(`must be above ${schema.exclusiveMinimum}`);
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) err(`fewer than ${schema.minItems} items`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) err(`more than ${schema.maxItems} items`);
      if (schema.items) value.forEach((v, i) => walk(v, schema.items, root, `${path}[${i}]`, errors));
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const r of schema.required || []) if (!(r in value)) err(`missing "${r}"`);
      const props = schema.properties || {};
      for (const [k, v] of Object.entries(value)) {
        if (k in props) walk(v, props[k], root, `${path}.${k}`, errors);
        else if (schema.additionalProperties === false) err(`unknown field "${k}"`);
        else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') walk(v, schema.additionalProperties, root, `${path}.${k}`, errors);
      }
    }
    if (schema.oneOf) {
      const ok = schema.oneOf.filter((s) => { const e = []; walk(value, s, root, path, e); return e.length === 0; }).length;
      if (ok !== 1) err(`must match exactly one alternative (matched ${ok})`);
    }
  }

  return {
    /** Returns { valid, errors }. Never throws on bad data, only on a broken schema. */
    validate(name, value) {
      const schema = schemas.get(name);
      if (!schema) throw new Error(`Unknown schema ${name}`);
      const errors = [];
      walk(value, schema, schema, '$', errors);
      return { valid: errors.length === 0, errors };
    },
    has: (name) => schemas.has(name),
    names: () => [...schemas.keys()]
  };
}
