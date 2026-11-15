# zedge / scripts

Utility scripts for the **zedge** project.

## `ztunnel.sh` — Cloudflare Tunnel TUI

Full-feature terminal UI for discovering, monitoring, and configuring **Cloudflare Tunnel** (`cloudflared`).

### Requirements

```bash
sudo apt update
sudo apt install -y cloudflared dialog curl jq
```

### Usage

```bash
chmod +x scripts/ztunnel.sh
./scripts/ztunnel.sh
```

### Features

| Menu | Action |
|------|--------|
| **ค้นหา / แสดงรายการ Tunnel** | List tunnels from local `cloudflared` credentials |
| **ค้นหาผ่าน Cloudflare API** | Fetch tunnels from Cloudflare API (needs API Token + Account ID) |
| **สร้าง Tunnel ใหม่** | `cloudflared tunnel create <name>` |
| **จัดการ Tunnel** | Info, service start/stop/restart/status, add/delete DNS routes, view logs, delete tunnel |
| **ดู Metrics เรียลไทม์** | Scrape `http://127.0.0.1:20241/metrics` |
| **แก้ไข config.yml** | Open `~/.cloudflared/config.yml` in `$EDITOR` |
| **ควบคุม Service** | systemd start / stop / restart / status / enable |
| **ดู Logs** | Tail `journalctl -u cloudflared` or log files |

### Install as systemd service (recommended)

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Then use **Menu 7** in the TUI to control the service.

### Notes

- Works on WSL2 with **Mirrored networking mode** (WSL shares the Windows host IP).
- Metrics endpoint requires `cloudflared` to be running with metrics enabled.
- API discovery requires a Cloudflare API Token with `Cloudflare Tunnel` permissions.
