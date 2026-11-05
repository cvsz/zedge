// A D1-shaped wrapper over node:sqlite so the Worker can be tested without Cloudflare.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql'), 'utf8'));
  return {
    raw: db,
    prepare(sql) {
      const stmt = db.prepare(sql);
      const wrap = (args) => ({
        first: async () => stmt.get(...args) || null,
        all: async () => ({ results: stmt.all(...args) }),
        run: async () => { const r = stmt.run(...args); return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; }
      });
      return { bind: (...args) => wrap(args), ...wrap([]) };
    }
  };
}
