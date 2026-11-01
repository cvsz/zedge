# Repository Baseline Audit (Phase A)

**Repository:** `cvsz/zedge`  
**Audited HEAD:** `c11ccc6` (with local enhancements for Prometheus metrics and OpenAPI spec)  
**Branch:** `main`  
**Remote:** `git@github.com:cvsz/zedge.git`  
**Date:** November 1, 2026  

## 1. Repository Structure & Architecture
- **Backend:** Node.js (ES Modules, Express 4.21.2), single zero-dependency control panel architecture (except Express). File-backed JSON/JSONL store with atomic replace (`server/store.js`).
- **Frontend:** Vanilla JS SPA in `public/` (`index.html`, `app.js`, `lib.js`, `charts.js`, `styles.css`, views in `public/views/`).
- **Testing:** Native Node.js test runner (`node --test`), mock Cloudflare API (`test/mock-cf.js`), 54 comprehensive test cases covering auth, RBAC, DNS, proxy, WAF, Workers, R2, Zero Trust, email, metrics, and OpenAPI.

## 2. Discovered Working Tree Status
- Modified: `server/app.js` (integrated metrics recording and OpenAPI endpoint)
- Untracked: `.github/workflows/ci.yml`, `server/metrics.js`, `server/openapi.js`, `test/metrics.test.js`

## 3. Risks & Observations
- Local file store (`DATA_DIR`) requires persistent volume mounting in Docker deployments.
- R2 object browsing requires R2 S3 API access keys (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) because Cloudflare REST API does not provide object content endpoints.
