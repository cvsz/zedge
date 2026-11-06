// Test runner: explicitly enumerates test files so it works on all Node versions
// (Node 20 does not expand shell globs in `node --test "test/*.test.js"`).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const testDir = path.join(process.cwd(), 'test');
const files = fs.readdirSync(testDir)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

if (files.length === 0) {
  console.error('No test files found in test/');
  process.exit(1);
}

const args = files.map((f) => path.join(testDir, f));
const child = spawn('node', ['--test', ...args], { stdio: 'inherit' });

child.on('exit', (code) => {
  process.exit(code || 0);
});
