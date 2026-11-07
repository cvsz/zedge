terraform {
  required_version = ">= 1.5.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# DNS CNAME record: zedge.zeaz.dev -> <tunnel-id>.cfargotunnel.com (proxied through Cloudflare)
resource "cloudflare_record" "zedge_tunnel" {
  zone_id = var.cloudflare_zone_id
  name    = "${var.subdomain}.${var.zone_name}"
  value   = "${var.tunnel_id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
  comment = "Managed by Terraform - Zedge Cloudflare Tunnel (zedge.zeaz.dev)"
}

# Output the public URL
output "tunnel_url" {
  value = "https://${var.subdomain}.${var.zone_name}"
}
