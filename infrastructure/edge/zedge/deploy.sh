#!/bin/bash
# Deploy Cloudflare Tunnel DNS for zedge.zeaz.dev via Terraform
#
# Prerequisites:
#   - terraform >= 1.5.0
#   - cloudflared
#   - Cloudflare API token with Zone DNS:Edit + Zone:Read on zeaz.dev
#
# Steps:
#   1. cp terraform.tfvars.example terraform.tfvars   # then fill in real values
#   2. Create a Cloudflare Tunnel (Zero Trust > Networks > Tunnels) and note its id
#   3. Set tunnel_id in terraform.tfvars
#   4. ./deploy.sh
#   5. Install cloudflared with the tunnel token and start it
#   6. Bring up Zedge: docker compose up -d --build   (needs .env with CLOUDFLARE_API_TOKEN, ZEDGE_ADMIN_PASSWORD, TUNNEL_TOKEN, ...)
#   7. Verify: https://zedge.zeaz.dev

set -euo pipefail

echo "=========================================="
echo "  Zedge Cloudflare Tunnel Deployer"
echo "  Domain: zedge.zeaz.dev"
echo "=========================================="

for cmd in terraform cloudflared; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "ERROR: $cmd is not installed. Please install it first."
    exit 1
  fi
done

if [[ ! -f "terraform.tfvars" ]]; then
  echo "WARNING: terraform.tfvars not found. Copying from example..."
  cp terraform.tfvars.example terraform.tfvars
  echo "Please edit terraform.tfvars with your Cloudflare credentials and re-run."
  exit 1
fi

echo "[1/3] Initializing Terraform..."
terraform init

echo "[2/3] Planning Terraform changes..."
terraform plan -out=tfplan

echo "[3/3] Applying Terraform changes..."
terraform apply tfplan

echo ""
echo "=========================================="
echo "  DNS Record Created Successfully!"
echo "  URL: https://zedge.zeaz.dev"
echo "  Tunnel: $(grep tunnel_id terraform.tfvars | cut -d'"' -f2).cfargotunnel.com"
echo "=========================================="

echo ""
echo "Next steps:"
echo "  1. Create the tunnel in Cloudflare Zero Trust > Networks > Tunnels"
echo "  2. Get the tunnel token and write it to Zedge's .env as TUNNEL_TOKEN"
echo "  3. Copy cloudflared-config.yml to /etc/cloudflared/config.yml (set the real tunnel id)"
echo "  4. Place credentials.json at /etc/cloudflared/credentials.json"
echo "  5. Run: sudo cloudflared service install  &&  sudo systemctl start cloudflared"
echo "  6. Create Zedge .env (see .env.example) with CLOUDFLARE_API_TOKEN, ZEDGE_ADMIN_PASSWORD, TUNNEL_TOKEN, COOKIE_SECURE=1"
echo "  7. Run: docker compose up -d --build"
echo "  8. Verify: https://zedge.zeaz.dev"
