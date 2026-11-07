variable "cloudflare_api_token" {
  description = "Cloudflare API Token with Zone - DNS - Edit and Zone - Zone - Read (limited to the zeaz.dev zone)"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare Account ID"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare Zone ID for zeaz.dev"
  type        = string
}

variable "zone_name" {
  description = "Root domain zone"
  type        = string
  default     = "zeaz.dev"
}

variable "subdomain" {
  description = "Subdomain for Zedge"
  type        = string
  default     = "zedge"
}

variable "tunnel_id" {
  description = "Cloudflare Tunnel UUID (create the tunnel in Zero Trust > Networks > Tunnels, then set its id here)"
  type        = string
}
