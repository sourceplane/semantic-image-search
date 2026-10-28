# cloudflare-r2 — architecture

A `terraform` root at `infra/terraform/cloudflare-r2/terraform`.

- **State** lives in the Orun Cloud HTTP state backend — no local state and
  no state bucket to manage.
- **Credentials are brokered per run** from the workspace's provider
  connections and resolved by name; none is stored in this repository.
- **Adoption** (`adopt.tf`): when state is empty but the resource already
  exists, plan-time import adopts it instead of failing.

## Resources

- `cloudflare_r2_bucket.app`

## Published outputs

Written as job-output secrets on each environment after an apply; deploy
lanes downstream resolve them by name.

| Secret                 | Terraform output |
| ---------------------- | ---------------- |
| `WIRING_CLOUDFLARE_R2` | `wiring`         |

## Resolved at run time (names only)

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `TF_VAR_cloudflare_account_id`
