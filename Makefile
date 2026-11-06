# Zedge + Affiliate OS. Run `make help`.
# Every target wraps a command that already exists in package.json, scripts/ or deploy/. Nothing here talks to
# Cloudflare unless you run `deploy` or `backup` yourself with CLOUDFLARE_API_TOKEN set.

SHELL := /bin/bash
.DEFAULT_GOAL := help
.ONESHELL:
.SHELLFLAGS := -eu -o pipefail -c

NODE      ?= node
NPM       ?= npm
AFF       := affiliate-os
IMAGE     ?= zedge
TAG       ?= $(shell $(NODE) -p "require('./package.json').version")
OUT       ?= dist
ZIP       := $(OUT)/zedge-$(TAG).zip
HELM_CHART := deploy/helm/zedge

.PHONY: help
help: ## Show this list
	@awk 'BEGIN{FS=":.*## "} /^[a-zA-Z0-9_.-]+:.*## /{printf "  \033[1m%-18s\033[0m %s\n",$$1,$$2} /^##@/{printf "\n%s\n",substr($$0,5)}' $(MAKEFILE_LIST)

##@ Setup
.PHONY: check-node install install-aff install-all env
check-node: ## Fail unless Node >= 22
	@$(NODE) -e "const m=+process.versions.node.split('.')[0]; if(m<22){console.error('Node 22+ required, have '+process.versions.node);process.exit(1)}"
install: check-node ## Install Zedge dependencies
	$(NPM) ci
install-aff: check-node ## Install Affiliate OS dependencies
	cd $(AFF) && $(NPM) ci
install-all: install install-aff ## Install both
env: ## Create .env from .env.example if missing (never overwrites)
	@if [ -f .env ]; then echo ".env exists, left alone"; else cp .env.example .env && chmod 600 .env && echo "Created .env: set CLOUDFLARE_API_TOKEN and ZEDGE_ADMIN_PASSWORD"; fi

lint: ## Lint source code with eslint (fails on errors)
	$(NPM) exec eslint "server/**/*.js" "public/**/*.js" "scripts/**/*.mjs" "test/**/*.mjs" 2>&1

##@ Run
.PHONY: run run-studio migrate migrate-status migrate-down
run: ## Start Zedge on http://127.0.0.1:8787 (reads .env)
	@test -f .env || { echo "No .env: run 'make env' first"; exit 1; }
	set -a; . ./.env; set +a; $(NPM) start
run-studio: ## Start the Affiliate studio (needs DATABASE_URL, ORGANIZATION_ID, SESSION_SECRET, ACCESS_TEAM_DOMAIN, ACCESS_AUD)
	cd $(AFF) && $(NPM) start -w @affiliate-os/studio
migrate: ## Apply Affiliate OS migrations (needs DATABASE_URL)
	@test -n "$${DATABASE_URL:-}" || { echo "Set DATABASE_URL"; exit 1; }
	cd $(AFF) && $(NPM) run migrate -w @affiliate-os/db -- up
migrate-status: ## Show Affiliate OS migration status (needs DATABASE_URL)
	@test -n "$${DATABASE_URL:-}" || { echo "Set DATABASE_URL"; exit 1; }
	cd $(AFF) && $(NPM) run migrate -w @affiliate-os/db -- status
migrate-down: ## Undo the last migration (needs DATABASE_URL; STEPS=n for more)
	@test -n "$${DATABASE_URL:-}" || { echo "Set DATABASE_URL"; exit 1; }
	cd $(AFF) && $(NPM) run migrate -w @affiliate-os/db -- down $(or $(STEPS),1)

##@ Test and quality
.PHONY: test test-aff test-pg e2e-pg smoke browser-studio typecheck openapi openapi-check check ci
test: ## Zedge tests (mock Cloudflare, no network)
	$(NPM) test
test-aff: ## Affiliate OS tests on in-memory Postgres (PGlite)
	cd $(AFF) && $(NPM) test
test-pg: ## Affiliate OS tests on a real PostgreSQL (embedded-postgres; installs it with --no-save)
	cd $(AFF) && $(NPM) run test:pg
e2e-pg: ## Migrate CLI + studio entry point on a real PostgreSQL
	cd $(AFF) && $(NPM) run e2e:pg
smoke: ## Browser smoke test of Zedge (needs Playwright)
	$(NPM) run smoke
browser-studio: ## Browser check of the studio UI (needs Playwright)
	cd $(AFF) && $(NODE) services/studio/test/browser.mjs
typecheck: ## tsc --checkJs over server/ public/ scripts/
	$(NPM) run typecheck
openapi: ## Regenerate docs/openapi.json (do this after route or version changes)
	$(NPM) run openapi
openapi-check: ## Fail if docs/openapi.json is out of date
	$(NPM) run openapi:check
check: typecheck openapi-check test test-aff ## Fast gate: types, OpenAPI drift, both test suites
ci: check smoke test-pg e2e-pg browser-studio ## Everything that can run without outside accounts

##@ Supply chain
.PHONY: sbom audit
sbom: ## CycloneDX SBOMs into dist/
	@mkdir -p $(OUT)
	$(NODE) scripts/sbom.mjs package-lock.json --out $(OUT)/sbom-console.json
	$(NODE) scripts/sbom.mjs $(AFF)/package-lock.json --out $(OUT)/sbom-affiliate-os.json
audit: ## npm audit for production dependencies (needs network)
	$(NPM) audit --omit=dev --audit-level=high
	cd $(AFF) && $(NPM) audit --omit=dev --audit-level=high

##@ Container and cluster (never run in this repo's history: expect first-run fixes)
.PHONY: docker-build docker-run helm-lint helm-template deploy backup
docker-build: ## Build the Zedge image
	docker build -t $(IMAGE):$(TAG) -t $(IMAGE):latest .
docker-run: ## Run the image locally on :8787 (needs CLOUDFLARE_API_TOKEN and ZEDGE_ADMIN_PASSWORD in the environment)
	@test -n "$${CLOUDFLARE_API_TOKEN:-}" && test -n "$${ZEDGE_ADMIN_PASSWORD:-}" || { echo "Set CLOUDFLARE_API_TOKEN and ZEDGE_ADMIN_PASSWORD"; exit 1; }
	docker run --rm -p 127.0.0.1:8787:8787 -e HOST=0.0.0.0 -e CLOUDFLARE_API_TOKEN -e ZEDGE_ADMIN_PASSWORD -e COOKIE_SECURE=0 $(IMAGE):$(TAG)
helm-lint: ## Lint the Helm chart
	helm lint $(HELM_CHART)
helm-template: ## Render the chart to stdout
	helm template zedge $(HELM_CHART)
deploy: ## One-command tunnel deploy: make deploy HOST=console.example.com ALLOW=you@example.com (needs CLOUDFLARE_API_TOKEN)
	@test -n "$(HOST)" || { echo "Usage: make deploy HOST=console.example.com [ALLOW=you@example.com]"; exit 1; }
	$(NPM) run deploy -- --hostname $(HOST) $(if $(ALLOW),--allow $(ALLOW),)
backup: ## Export Cloudflare configuration snapshots (needs CLOUDFLARE_API_TOKEN)
	$(NPM) run backup

##@ Secrets
rotate: ## Rotate secrets: make rotate T='session metrics admin-password' [DRY=1] (cloudflare-token needs YES=1)
	@test -n "$(T)" || { echo "Usage: make rotate T='session metrics admin-password' [DRY=1]   (targets: session metrics admin-password cloudflare-token all)"; exit 1; }
	$(NPM) run rotate -- $(T) $(if $(DRY),--dry-run,) $(if $(YES),--yes,)

##@ Release
.PHONY: rotate version package clean distclean
version: ## Print the version
	@echo $(TAG)
package: ## Zip the repo into dist/ without node_modules, .env, data/, dist/
	@mkdir -p $(OUT)
	rm -f $(ZIP)
	zip -qr $(ZIP) . -x 'node_modules/*' '*/node_modules/*' '.env' 'data/*' '$(OUT)/*' 'sbom*.json' '.git/*'
	@echo "$(ZIP)  ($$(du -h $(ZIP) | cut -f1))"
clean: ## Remove generated files (dist/, sbom.json)
	rm -rf $(OUT) sbom.json
distclean: clean ## Also remove node_modules in both projects
	rm -rf node_modules $(AFF)/node_modules
