import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(process.cwd());

function readAll(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) readAll(p, out);
    else if (e.isFile() && /\.md$/.test(e.name)) out.push(p);
  }
  return out;
}

test('no unsupported production-ready claims without evidence', () => {
  const files = readAll(path.join(ROOT, 'docs'));
  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    // Strip backtick-quoted code (state names like `VERIFIED` are definitional, not claims)
    const stripped = text.replace(/`[^`]*`/g, '');
    // Flag PRODUCTION READY (always a claim) or VERIFIED used as a status claim (not in backticks)
    if (!/PRODUCTION READY/.test(stripped) && !/\bVERIFIED\b/.test(stripped)) continue;
    // The file must contain evidence: command, SHA, date, or environment mention
    const hasEvidence = /command|SHA|commit [0-9a-f]{7,}|Date: \d{4}-\d{2}-\d{2}|environment/.test(text);
    if (!hasEvidence) bad.push(f);
  }
  assert.deepStrictEqual(bad, [], `Unsupported claims found:\n${bad.join('\n')}`);
});

test('no routes/zerotrust.js references', () => {
  const files = readAll(path.join(ROOT, 'docs'));
  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    if (/routes\/zerotrust\.js/.test(text)) bad.push(f);
  }
  assert.deepStrictEqual(bad, [], `References routes/zerotrust.js: ${bad.join(', ')}`);
});
