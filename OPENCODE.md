# OpenCode Instructions - Zedge

## Overview
Zedge is a self-hosted Cloudflare control panel built with Node.js 20+, Express, and vanilla ES modules.

## OpenCode Integration
- **Skills Path:** `.agents/skills/` contains Cloudflare platform skills.
- **Development Commands:**
  - Start server: `npm start`
  - Run tests: `npm test`
- **Conventions:** Follow strict ES module practices, keep frontend assets in `public/` lightweight without build steps, and ensure all backend actions enforce RBAC permissions.
