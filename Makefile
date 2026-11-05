# Zedge control panel Makefile
# Usage: make start|stop|restart|update|upgrade
#
# See package.json for npm scripts.
# See .env.example for required environment variables. Default: CLOUDFLARE_API_TOKEN

.PHONY: start stop restart update upgrade help

# ---- start: start the Zedge server ----
start:
	@echo "Starting Zedge server..."
	@npm run start

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

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@echo "  start      Start the Zedge server"
	@echo "  stop       Stop the Zedge server"
	@echo "  restart    Restart the Zedge server"
	@echo "  update     Update npm dependencies"
	@echo "  upgrade    Upgrade npm dependencies to latest"
	@echo "  help       Show this help message"