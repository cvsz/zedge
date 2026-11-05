#!/usr/bin/env node
// CycloneDX 1.5 SBOM (JSON) built from package-lock.json: every installed package with version, purl and integrity hash.
// Usage: node scripts/sbom.mjs [package-lock.json] [--out sbom.json]
import fs from 'node:fs';
import crypto from 'node:crypto';

const purl = (name, version) => `pkg:npm/${name.startsWith('@') ? `%40${name.slice(1)}` : name}@${version}`;

export function buildSbom(lock, { name = 'app', version = '0.0.0', now = () => new Date() } = {}) {
  if (!lock || !lock.packages) throw new Error('Not an npm lockfile (v2/v3 with "packages" expected)');
  const components = [];
  for (const [path, p] of Object.entries(lock.packages)) {
    if (!path || p.link) continue;                                    // "" is the root; links are workspace symlinks
    const n = p.name || path.split('node_modules/').pop();
    if (!p.version) continue;
    const c = { type: 'library', 'bom-ref': `${path}`, name: n, version: p.version, purl: purl(n, p.version), scope: p.dev ? 'excluded' : 'required' };
    if (p.integrity && p.integrity.startsWith('sha512-')) c.hashes = [{ alg: 'SHA-512', content: Buffer.from(p.integrity.slice(7), 'base64').toString('hex') }];
    if (p.license) c.licenses = [{ license: { id: String(p.license) } }];
    components.push(c);
  }
  components.sort((a, b) => a.purl.localeCompare(b.purl) || a['bom-ref'].localeCompare(b['bom-ref']));
  return { bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: `urn:uuid:${crypto.randomUUID()}`, version: 1,
    metadata: { timestamp: now().toISOString(), component: { type: 'application', name, version }, tools: [{ name: 'zedge sbom.mjs' }] }, components };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2); const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out') || 'package-lock.json';
  const pkg = JSON.parse(fs.readFileSync(file.replace(/package-lock\.json$/, 'package.json'), 'utf8'));
  const sbom = buildSbom(JSON.parse(fs.readFileSync(file, 'utf8')), { name: pkg.name, version: pkg.version });
  const text = `${JSON.stringify(sbom, null, 2)}\n`;
  if (out) { fs.writeFileSync(out, text); console.log(`${out}: ${sbom.components.length} components`); } else process.stdout.write(text);
}
