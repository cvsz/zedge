import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

test('production dependencies contain only express', () => {
  const deps = Object.keys(pkg.dependencies || {});
  assert.deepStrictEqual(deps, ['express'], `unexpected production dependencies: ${deps.join(', ')}`);
});

test('no accidental latest dependency in production or dev dependencies', () => {
  const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  assert.ok(!('latest' in all), 'the accidental `latest` dependency must not be present');
  assert.ok(all.express, 'express must be present');
});
