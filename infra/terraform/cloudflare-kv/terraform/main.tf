terraform {
  required_version = ">= 1.15.0"

  # State lives on the platform (SB1): the runner exports TF_HTTP_* per job, so
  # this block stays empty — no S3 bucket, no AWS role, no workspaces.
  backend "http" {}

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.30"
    }
    external = {
      source  = "hashicorp/external"
      version = "~> 2.3"
    }
  }
}

# --- Providers ---

# Authenticates via the CLOUDFLARE_API_TOKEN env var (provider-native): the
# token is an orun-managed secret resolved into the job env at run time, so it
# never transits Terraform variables.
provider "cloudflare" {}

# --- Variables (standard Orun parameters) ---

variable "cloudflare_account_id" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Cloudflare account ID (from CLOUDFLARE_ACCOUNT_ID env var)"
}

variable "orgName" {
  type    = string
  default = "sourceplane"
}

variable "owner" {
  type    = string
  default = "sourceplane"
}

variable "repo" {
  type    = string
  default = "semantic-image-search"
}

variable "namespace" {
  type    = string
  default = "sourceplane"
}

variable "namespacePrefix" {
  type    = string
  default = ""
}

variable "lane" {
  type    = string
  default = "verify"
}

variable "environment" {
  type    = string
  default = "stage"
}

variable "component" {
  type    = string
  default = "cloudflare-kv"
}

variable "stackName" {
  type    = string
  default = "cloudflare-kv"
}

variable "terraformDir" {
  type    = string
  default = "terraform"
}

variable "terraformVersion" {
  type    = string
  default = "1.15.3"
}

# --- The KV namespace the search cache lives in ---
#
# Bound by apps/web as CACHE (upstream: Vercel KV). Keys are the app's: each
# query's results under the index's generation (lib/cache.ts, each PUT with a
# day's `expirationTtl`) and the generation itself — no Terraform-side TTL knob
# exists for KV namespaces themselves.

locals {
  # Built on var.repo (the product's repository slug) so the title is unique per
  # product. Cloudflare KV namespace titles must be unique per account, and two
  # products may share an account — without the slug the second create fails
  # with "a namespace with this account ID and title already exists" (10014).
  # The Worker binds this namespace by ID via the wiring secret, so the title is
  # free to change.
  app_kv_title = "${var.namespacePrefix}${var.repo}-app-kv-${var.environment}"
}

resource "cloudflare_workers_kv_namespace" "app_kv" {
  account_id = var.cloudflare_account_id
  title      = local.app_kv_title
}

# --- Wiring manifest (BF5, via orun secrets) ---
# The consumable outputs are published by the composition's wire-secrets step
# as the WIRING_CLOUDFLARE_KV secret on the project/{{env}} rung; worker
# deploys read it back as WIRING_CLOUDFLARE_KV_<ENV> secretEnv (BF6). Same
# document shape the Secrets Manager path carried.

output "wiring" {
  description = "Wiring document for downstream deploy-time binding resolution (pushed to orun secrets)"
  value = jsonencode({
    app_kv_id    = cloudflare_workers_kv_namespace.app_kv.id
    app_kv_title = cloudflare_workers_kv_namespace.app_kv.title
  })
}

# --- Outputs (non-secret) ---

output "app_kv_id" {
  description = "Cloudflare Workers KV namespace ID the search cache lives in"
  value       = cloudflare_workers_kv_namespace.app_kv.id
}

output "app_kv_title" {
  description = "Cloudflare Workers KV namespace title (human-readable identifier)"
  value       = cloudflare_workers_kv_namespace.app_kv.title
}
