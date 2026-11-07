# Zedge on Cloudflare Tunnel at https://zedge.zeaz.dev

## Overview

Terraform + cloudflared configuration to publish Zedge at `https://zedge.zeaz.dev` through Cloudflare Tunnel.

The stack:

- **Terraform** creates a proxied CNAME DNS record `zedge.zeaz.dev -> <tunnel-id>.cfargotunnel.com`.
- **cloudflared** runs inside `docker compose` (service `cloudflared`) and tunnels `zedge.zeaz.dev` to the Zedge app container on port 8787.
- **Nothing is published on the host** — the tunnel is the only way in. Add Cloudflare Access in front for an additional auth layer.

## Repository layout

```
infrastructure/edge/zedge/
├── main.tf             # Terraform: Cloudflare provider + cloudflare_record CNAME
├── variables.tf        # Input variables
├── terraform.tfvars.example   # Copy to terraform.tfvars and fill in real values
├── cloudflared-config.yml     # cloudflared ingress config (tunnel id + origin)
├── deploy.sh            # terraform init/plan/apply + next steps
└── README.md            # this file
```

`terraform.tfvars`, `credentials.json`, and `*.tfstate` are gitignored — never commit real tokens.

## Prerequisites

1. **Cloudflare API Token** with:
   - Zone - DNS - Edit
   - Zone - Zone - Read
   - Limited to the `zeaz.dev` zone
2. **Tools**: `terraform` (>= 1.5.0), `cloudflared`, `docker compose`
3. The `zeaz.dev` zone already exists on this Cloudflare account.

## Deployment

### 1. Configure Terraform variables

```bash
cd infrastructure/edge/zedge
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars: cloudflare_api_token, cloudflare_account_id,
# cloudflare_zone_id, and (after step 2) tunnel_id
```

### 2. Create the Cloudflare Tunnel

In Cloudflare Zero Trust > Networks > Tunnels, create a tunnel, note its UUID, and set `tunnel_id` in `terraform.tfvars`.

### 3. Apply Terraform

```bash
chmod +x deploy.sh
./deploy.sh
```

This creates the CNAME record `zedge.zeaz.dev -> <tunnel-id>.cfargotunnel.com` (proxied).

### 4. Run cloudflared (inside docker compose)

`docker-compose.yml` already defines a `cloudflared` service that reads `TUNNEL_TOKEN` from `.env`.

Get the tunnel token from Cloudflare Zero Trust > Networks > Tunnels > your tunnel > "Show token", then add to Zedge's `.env`:

```
CLOUDFLARE_API_TOKEN=***
ZEDGE_ADMIN_PASSWORD=***     # 12+ chars, creates the first admin
SESSION_SECRET=***           # 32+ random chars
TUNNEL_TOKEN=***             # from the Cloudflare tunnel page
HOST=0.0.0.0
PORT=8787
COOKIE_SECURE=1              # required when HOST is not loopback
TRUST_CF_CONNECTING_IP=1     # use the real client IP from the tunnel
DATA_DIR=/data
```

Then start:

```bash
cd /home/cvsz/zedge   # repo root
docker compose up -d --build
```

### 5. Verify

Visit `https://zedge.zeaz.dev`. Sign in as `admin` with `ZEDGE_ADMIN_PASSWORD`.

## Optional: Cloudflare Access

Put an Access application + policy in front of `zedge.zeaz.dev` so only allowed emails can reach the console login. Zedge's own RBAC then governs what each signed-in user can do.

## Security notes

- Never commit `terraform.tfvars` (real API token) or `credentials.json`.
- `COOKIE_SECURE=1` is mandatory for non-loopback `HOST`.
- Zedge stores users, roles and the audit log in `DATA_DIR` (`/data`) — mount a persistent volume (`edge-data` in docker compose).
- See `SECURITY.md` and `THREAT-MODEL.md` in the repo root.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `terraform plan` fails | Check `terraform.tfvars` credentials and zone id |
| 502 Bad Gateway | cloudflared not running, or Zedge container not healthy |
| DNS not propagating | Wait 1–5 minutes, or re-run `terraform apply` |
| `cloudflared` not found | Install from Cloudflare's releases page |
