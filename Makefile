# Zedge control panel Makefile
# Usage: make start|stop|restart|update|upgrade|install|lint|test|build|deploy|logs|status|help
#
# See package.json for npm scripts.
# See .env.example for required environment variables. Default: CLOUDFLARE_API_TOKEN

.PHONY: start stop restart update upgrade install lint test build deploy logs status help

# ---- start: start the Zedge server ----
start:
	@echo "Starting Zedge server..."
	@export $(grep -v '^#' .env | xargs) && npm run start

# ---- stop: stop the running Zedge server ----
stop:
	@echo "Stopping Zedge server..."
	@-pkill -f "node server/index.js" 2>/dev/null; true
	@echo "Zedge stopped."

# ---- restart: restart the Zedge server ----
restart: stop start
	@echo "Zedge restarted."

# ---- update: update npm dependencies ----
update:
	@echo "Updating npm dependencies..."
	@npm update

# ---- upgrade: upgrade npm dependencies to latest ----
upgrade:
	@echo "Upgrading npm dependencies..."
	@npm install latest

# ---- install: install npm dependencies ----
install:
	@echo "Installing npm dependencies..."
	@npm install

# ---- lint: lint source code ----
lint:
	@echo "Linting source code..."
	@npm run lint 2>/dev/null || eslint "server/**/*.js" --quiet || true

# ---- test: run test suite ----
test:
	@echo "Running test suite..."
	@npm test

# ---- build: build the project ----
build:
	@echo "Building project..."
	@npm run build 2>/dev/null || true

# ---- deploy: deploy the project ----
deploy:
	@echo "Deploying Zedge..."
	@npm run deploy

# ---- logs: view running logs ----
logs:
	@echo "Viewing Zedge logs..."
	@pgrep -f "node server/index.js" && echo "Zedge is running. Use 'make stop' to stop." || echo "Zedge is not running."

# ---- status: check Zedge status ----
status:
	@echo "Checking Zedge status..."
	@pgrep -f "node server/index.js" && echo "Zedge is running on port 8787" || echo "Zedge is not running."

# ---- help: show this help message ----
help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@echo "  start      Start the Zedge server"
	@echo "  stop       Stop the Zedge server"
	@echo "  restart    Restart the Zedge server"
	@echo "  update     Update npm dependencies"
	@echo "  upgrade    Upgrade npm dependencies to latest"
	@echo "  install    Install npm dependencies"
	@echo "  lint       Lint source code"
	@echo "  test       Run test suite"
	@echo "  build      Build the project"
	@echo "  deploy     Deploy the project"
	@echo "  logs       View running logs"
	@echo "  status     Check Zedge status"
	@echo "  help       Show this help message"