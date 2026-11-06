// Production entry point. Configuration comes from the environment; nothing is read from files and nothing secret is logged.
//   DATABASE_URL        postgres://... (the app connects as a role allowed to SET ROLE aff_app; run migrations first)
//   ORGANIZATION_ID     the one organization this deployment serves
//   SESSION_SECRET      32+ random characters
//   ACCESS_TEAM_DOMAIN  e.g. myteam.cloudflareaccess.com
//   ACCESS_AUD          the Access application's AUD tag
//   METRICS_TOKEN       optional; enables GET /metrics for a scraper that sends it as a bearer token
//   SECURITY_CONTACT    optional; served at /.well-known/security.txt (for example mailto:security@example.com)
//   HOST (127.0.0.1) / PORT (8790)
import http from 'node:http';
import { openPostgres } from '@affiliate-os/db';
import { createAuth, jwksFetcher } from '@affiliate-os/auth';
import { createMetrics, createLogger } from '@affiliate-os/observability';
import { createAccessVerifier } from './access.js';
import { createStudio } from './server.js';

export function readConfig(env = process.env) {
  const need = ['DATABASE_URL', 'ORGANIZATION_ID', 'SESSION_SECRET', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD'];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) {throw new Error(`Missing environment variables: ${missing.join(', ')}`);}
  if (env.SESSION_SECRET.length < 32) {throw new Error('SESSION_SECRET must be at least 32 characters');}
  const team = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return { databaseUrl: env.DATABASE_URL, organizationId: env.ORGANIZATION_ID, sessionSecret: env.SESSION_SECRET, issuer: `https://${team}`, audience: env.ACCESS_AUD, metricsToken: env.METRICS_TOKEN || null, securityContact: env.SECURITY_CONTACT || null, host: env.HOST || '127.0.0.1', port: Number(env.PORT || 8790) };
}

export async function start(env = process.env) {
  const c = readConfig(env);
  const logger = createLogger({ service: 'studio' });
  const db = await openPostgres({ connectionString: c.databaseUrl, onError: (e) => console.error('database connection error:', e.code || e.message) });
  const auth = createAuth({ db, sessionSecret: c.sessionSecret });
  const keys = jwksFetcher(`${c.issuer}/cdn-cgi/access/certs`);
  const access = createAccessVerifier({ issuer: c.issuer, audience: c.audience, keys });
  const handler = createStudio({ db, auth, access, organizationId: c.organizationId, metrics: createMetrics(), metricsToken: c.metricsToken, logger, securityContact: c.securityContact });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(c.port, c.host, r));
  logger.info('studio listening', { host: c.host, port: server.address().port });
  // Graceful shutdown: stop accepting, let in-flight requests finish (10 s cap), then close the pool.
  const stop = async () => { logger.info('shutting down'); const t = setTimeout(() => process.exit(1), 10000); t.unref(); server.close(async () => { await db.close(); process.exit(0); }); server.closeIdleConnections?.(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  return { server, db };
}

if (import.meta.url === `file://${process.argv[1]}`) {start().catch((e) => { console.error(e.message); process.exit(1); });}
