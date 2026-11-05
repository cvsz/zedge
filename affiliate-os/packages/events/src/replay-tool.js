#!/usr/bin/env node
// Replay dead letters for one consumer after the bug is fixed.
//   node src/replay-tool.js --help
// The tool is a thin wrapper: operators wire `createConsumer` with their real handlers and call consumer.replay(org, { ids }).
export const usage = 'Usage: import { createConsumer } from "@affiliate-os/events"; await consumer.replay(organizationId, { ids: [1, 2] })';
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href && process.argv.includes('--help')) console.log(usage);
