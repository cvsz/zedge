import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();
const en = JSON.parse(fs.readFileSync(`${ROOT}/public/i18n/en.json`, 'utf8'));
const th = JSON.parse(fs.readFileSync(`${ROOT}/public/i18n/th.json`, 'utf8'));

test('i18n key parity: en.json and th.json have identical keys', () => {
  const enKeys = Object.keys(en).sort();
  const thKeys = Object.keys(th).sort();
  assert.deepStrictEqual(enKeys, thKeys, `Key mismatch. Only in en: ${enKeys.filter(k => !thKeys.includes(k)).join(', ')}. Only in th: ${thKeys.filter(k => !enKeys.includes(k)).join(', ')}`);
});

test('i18n no empty values', () => {
  for (const [lang, obj] of [['en', en], ['th', th]]) {
    for (const [k, v] of Object.entries(obj)) {
      assert.ok(v && v.trim().length > 0, `${lang}.${k} is empty`);
    }
  }
});
