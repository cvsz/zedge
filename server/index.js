import { loadConfig } from './config.js';
import { createApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(`Configuration error: ${e.message}`);
  process.exit(1);
}

createApp(config).listen(config.port, config.host, () => {
  console.log(`Zedge listening on http://${config.host}:${config.port}`);
  if (config.noAuth) {console.warn('WARNING: running without a password (loopback only).');}
  if (!['127.0.0.1', '::1', 'localhost'].includes(config.host) && !config.secureCookie) {
    console.warn('WARNING: HOST is not loopback. Put this behind HTTPS and set COOKIE_SECURE=1.');
  }
});
