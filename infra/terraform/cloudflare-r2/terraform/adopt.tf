# --- Self-healing adoption ---
#
# When the platform state does not yet track the bucket but Cloudflare already
# has one under this name (a re-bootstrap over a torn-down workspace), import
# it at plan time instead of colliding with the duplicate-name guard. Fresh
# products resolve to id = "" and create normally; a resource already in state
# short-circuits the lookup.

data "external" "adopt_app_bucket" {
  program = ["bash", "-c", <<-EOT
    set -euo pipefail
    name="$(jq -r .name)"
    state_file="$(mktemp)"
    trap 'rm -f "$state_file"' EXIT
    code="$(curl -s -o "$state_file" -w '%%{http_code}' \
      -u "$TF_HTTP_USERNAME:$TF_HTTP_PASSWORD" "$TF_HTTP_ADDRESS" || echo 000)"
    if [ "$code" = "200" ] && jq -e \
        '[.resources[]? | select(.type == "cloudflare_r2_bucket" and .name == "app")] | length > 0' \
        "$state_file" >/dev/null 2>&1; then
      jq -n '{id: ""}'
      exit 0
    fi
    resp="$(curl -fsS --retry 3 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets?per_page=1000")"
    printf '%s' "$resp" | jq -c --arg n "$name" \
      '{id: ([.result.buckets[]? | select(.name == $n) | .name] | first // "")}'
  EOT
  ]
  query = {
    name = local.bucket_name
  }
}

import {
  for_each = toset(compact([data.external.adopt_app_bucket.result.id]))
  to       = cloudflare_r2_bucket.app
  id       = "${var.cloudflare_account_id}/${each.value}"
}
