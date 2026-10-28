# BOOTSTRAP — a new semantic image search app from this baseline, in one landing

How to go from **nothing** to **a semantic image search app live on stage
and prod — its own Supabase project per environment with pgvector,
Hyperdrive in front of it, an R2 bucket for its images and a KV namespace for
its search cache, the schema applied, the app deployed, its sample images
indexed by Workers AI — documented**, with two provider consents and no AI
vendor key.

There is one artifact: **`repo-blueprint.yaml`**. It declares what to place,
in what order, what each phase needs first, and what to say while it runs.
`orun new` is the whole runtime — the phases below are its `--phase` names,
not separate workflows. The console card the platform renders is
**`blueprint.yaml`**; it names the build document and states the inputs, the
brokered secrets and the programme, and `testing/manifest.test.sh` holds it
to what the build document does.

Target wall-clock: **about eighteen minutes** — an estimate summed from the
phases (18 + 1) until a bootstrap measures it. The shape: the task set-up in
the background while ONE landing is placed, branded and checked in the box
(`orun validate` and `orun plan`, no runner waited for), then one convergence
per environment (stage and prod side by side until `02-docs` restores the
promotion gate) that creates the Supabase project (five to seven minutes),
the Hyperdrive config, applies the migrations, creates the bucket and the
namespace, and builds and deploys the app — whose smoke step indexes the
sample images — in that order, then a short docs landing.

## 0. What you need

- GitHub org access (repository creation) and a machine with `git`, `node`
  (≥ 22), `pnpm` (10.12.1), `python3` with PyYAML, `curl`, and the `orun`
  CLI **≥ v2.88.0** — the floor for RUNNING the bootstrap (the phase overlay,
  `githubOwner` on the doctor probe, `from: workspace`, the deploy
  credentials minted in one `secrets` reconcile per provider, the task set-up
  run in the background (`background: true`), and landings checked in the box
  before they merge (`checks: local`)). The product's own `ci.yml` pins its
  lanes separately (v2.78.4), and that pin — or anything newer, as the floor
  is — is what reads the per-edge `mode` rules the convergence order relies
  on.
- A **Cloudflare** account (the free plan is enough for one Worker with
  static assets, Hyperdrive, R2, KV and Workers AI; R2 must be enabled on the
  account once, in the dashboard) and its Account API token with the
  permission groups the console's Connect recipe lists — Workers Scripts,
  Workers KV, Hyperdrive and R2 among them. **Workers AI** describes and
  embeds the images: every account has it, nothing is provisioned, and it
  bills the account after its free daily allocation (one vision call and one
  embedding per new image, one embedding per new search). The Worker reaches
  it through an `AI` binding the deploy token uploads with the script.
- **Supabase: an organization with room for TWO more projects**,
  `<reponame>-stage` and `<reponame>-prod` — the product creates one per
  environment, and Supabase's free plan allows two active projects per
  organization, so on the free plan the organization must have none active
  already (or be on a paid plan). Connected to the workspace by OAuth
  consent (console → Integrations → Supabase) or a pasted personal access
  token. The connection is anchored on ONE organization, and that is where
  both projects are created: for an account in several organizations, the
  OAuth consent, where you pick one, is the way to be sure which.
- An Orun Cloud workspace for the product — `orunWorkspace`, or the workspace
  the build runs in (ORUN_WORKSPACE) when that is unset — with an
  **admin-role API key** for headless runs (secret writes below admin are
  masked as `not_found`).
- **The repository allow-listed in the workspace** (console → Settings → Git
  repos), unless the credential can write links. `01-product`'s `link` step
  stops and names the fix if it is not.
- **No AI vendor key.** No platform brokers one and none is needed: both
  models are Workers AI's. Upstream used OpenAI for both; there is no OpenAI
  option here, because the search and the images must be embedded by the
  same model, in the same 768-dimension column.

## 1. One command: `--resume`

The whole bootstrap, unattended. `--resume` places every phase not already
derived as done, in order, honouring each phase's barrier:

```bash
git clone --depth 1 --branch <baseline-tag> https://github.com/sourceplane/semantic-image-search
cd semantic-image-search

orun new --blueprint repo-blueprint.yaml \
  --out ~/products/acme-gallery --run-hooks --resume \
  --set reponame=acme-gallery --set productname="Acme Gallery" \
  --set githuborg=acme-inc \
  --set orunWorkspace=ws_XXXXXXXX \
  --set subdomain=<workers-dev-subdomain>
```

`subdomain` is the workers.dev subdomain of the Cloudflare account you deploy
into (Workers & Pages → your subdomain). A build started from the console, or
with `orun baseline new --from bst_…`, never asks for it: the platform reads
it from the workspace's Cloudflare connection, the same one the deploy tokens
mint from. Only a hand-run build like this one passes it.

**`--run-hooks` is the difference between placing files and bootstrapping a
product.** Without it `orun new` writes the tree and stops: no repository, no
landing, no convergence watch, no probe. That is deliberate — it is what
makes the offline bootstrap in `testing/` possible with no workspace and no
provider.

`--resume` is safe to re-run from anywhere, a fresh container with a fresh
`--out` included: **phase state is derived from the tree, never stored.** A
phase whose files are present but branded derives as `drifted`, and
`--resume` leaves it placed rather than reverting the product's identity.

## 1b. Or phase by phase

| phase | what it lands | verified by |
|---|---|---|
| `01-product` | the repository, created and linked; the six brokered credentials; then the whole product in one PR — intent, CI, tooling, identity, the Supabase, Hyperdrive, R2 and KV Terraform roots, the migrations (pgvector, the images table, row-level security), the app, its sample images and its tests | its commit validated and planned in the box (as the PR and as the merge), then merged; the convergence green (supabase → cloudflare-hyperdrive → db-migrate → web, with cloudflare-r2 and cloudflare-kv → web, per environment — each resolving what the apply before it published); the smoke's indexing pass run until nothing remains, and `/` and `/api/health` answering on both workers.dev URLs with images indexed |
| `02-docs` | `ai/context/deployment.md` from probed facts (each environment's index included); prod's promotion gate and dev's push lanes restored | the render's own probes, recorded; the commit checked in the box and merged |

```bash
orun new --blueprint repo-blueprint.yaml --out ~/products/acme-gallery --run-hooks \
  --phase 01-product --values ~/acme-gallery.values.yaml
# … then 02-docs
```

`02-docs` reads the identity back from `.rebrand/values.json` in the placed
tree, but the blueprint's **required** inputs — `reponame`, `productname`,
`githuborg` — are validated before anything runs, so pass them every time (a
`--values` file is easier). The domain is not one of them: the product goes live
on workers.dev, and `productdomain` defaults to empty, which brands the
reserved placeholder `<reponame>.example.com` into `BASE_DOMAIN` for an owner
to replace when they attach a domain (README, "Custom domain"). Pass
`--set productdomain=` only for a product that already has its domain.
The full guide, one page per phase: [docs/phases/README.md](docs/phases/README.md).

| flag | what it does |
|---|---|
| `--status` | derives and prints every phase's state and writes nothing. It parses the document, validates each hook against the action registry and compiles every template; it needs no credential and no network |
| `--phase <name>` | places exactly that phase; its `requires.phases` still gates |
| `--until <name>` | places every phase through that one and stops |

What lands in the product is PRODUCT-ONLY: the app, the Terraform roots, the
migrations and their runner, the tests, its CI, its tooling, its README and
its two context pages. None of this repository's machinery (`.baseline/`, the
blueprints, `tooling/rebrand`, `tooling/bootstrap`, `hooks/`, `testing/`,
`docs/phases/`, `specs/`, `tasks/`, this file) ships, and no shipped file
names any of it. That promise is a test: `testing/leak.test.sh` derives what
every phase would place and gates the set and every file's text, and
`testing/placement.test.sh` gates the same rules over a placed, branded tree.

## 2. Headless / container mode

The blueprint's source is this repository (`sources: [{kind: dir, path: .}]`),
so the container contract is a shallow clone at a pinned tag plus two
tokens:

```bash
export ORUN_TOKEN=…          # orun auth, headless
export GITHUB_TOKEN=…        # fine-grained PAT (below)

git clone --depth 1 --branch <baseline-tag> https://github.com/sourceplane/semantic-image-search
cd semantic-image-search
orun new --blueprint repo-blueprint.yaml \
  --out /work/acme-gallery --run-hooks --resume --progress json \
  --values /work/acme-gallery.values.yaml
```

| requirement | detail |
|---|---|
| `GITHUB_TOKEN` | fine-grained PAT: **read** on this repository; on the PRODUCT's repository **contents write**, **pull-requests write**, **actions read+write** (`orun.run/watch@v1` resumes runs with `gh run rerun`), **checks read**; **repository create** on the owner if `01-product` creates it (or pre-create it — supported) |
| classic token caveat | a classic PAT or gh OAuth token also needs the `workflow` scope to push `.github/workflows/` |
| pinning | the clone's `--branch <tag>` pins everything: the blueprint, its modules and its hooks' scripts all come from that one commit |

## 3. After the product is live

- **Nothing to connect.** The product searches its twelve sample images on
  Workers AI from its first deploy. Try it: search for "tasty food".
- **Your own images** (optional): put them in the environment's R2 bucket
  under `images/` and run the indexing pass (redeploy, or `curl -X POST
  <url>/api/index` until it answers `"remaining":0`); to drop the samples,
  empty `apps/web/lib/samples.ts` and the bucket's copies (the product's
  README, "The images, and the index").
- **Custom domain**: attach it to the Worker in Cloudflare, then set
  `SITE_URL` under that environment's `env:` in the product's `intent.yaml`
  (its README, "Custom domain") — the page's Open Graph image link is
  absolute. There is no domain phase: attaching a domain needs zone permissions the brokered
  `workers-deploy` token does not carry.
- **Refresh the record**: re-run `--phase 02-docs`; it is idempotent, and it
  records how many images each environment has indexed.

## 4. Testing this baseline

`.github/workflows/baseline.yml` runs three tiers on every pull request, and
each runs locally the same way:

```bash
for t in manifest phases coverage rebrand retouch bootstrap-defer; do bash testing/$t.test.sh; done
bash testing/leak.test.sh        # needs orun
bash testing/placement.test.sh   # needs orun, node, pnpm: the offline bootstrap and the product's own plans
bash testing/e2e.test.sh         # + network for pnpm, psql and a PostgreSQL server install with pgvector
```

The offline bootstrap (`testing/lib/bootstrap.sh`) places both phases in
order and finishes each with the blueprint's OWN `run:` hooks — read out of
`repo-blueprint.yaml`, not transcribed — so the retouch marker, the rebrand,
the re-tenant, the deferrals and their restore and the deployment record
all run exactly as a real bootstrap runs them. Only the platform's typed
actions (task, repo, reconcile, land, watch, probe) and the `link` step are
stood in for, a landing becoming a commit.

What no test here can do is the clouds' half: create a Supabase project,
apply the Hyperdrive config, the bucket and the namespace, mint a token,
deploy for real, call a real Workers AI model. The Terraform roots are held to `fmt`, `init
-backend=false` and `validate` (a real `plan` reads Supabase's API and the
platform's state backend); the convergence ORDER is proven on the product's
own `orun plan`; the migrations are applied by the product's own runner to a
local Postgres with pgvector through a stand-in for the one Supabase
Management API endpoint it calls (`testing/lib/fake-supabase-api.py`); and
the built Worker, under `wrangler dev` with wrangler's local bucket and
namespace, says its index is empty, is indexed by its own deploy smoke,
serves its images from the bucket and finds them by their descriptions'
words, with its `AI` binding pointed at a deterministic stand-in for Workers
AI (`testing/lib/fake-workers-ai.js`: a fixed description per sample, keyed
by the image's bytes, and word-hash embeddings). What the real models write
and how they rank a search is verified only by a bootstrap.

## 5. Cutting a baseline tag (maintainers)

Every product built from this repository resolves a `baseline-vN` tag, so the
tag is cut by a workflow rather than by hand:

```bash
gh workflow run tag.yml -f version=baseline-v1          # from main
gh workflow run tag.yml -f version=baseline-v1 -f ref=<sha>
```

It refuses a version that is not `baseline-v<N>` and a tag that already
exists: a baseline tag is never moved. Then add (or move) the registry row in
orun-cloud's `infra/baselines-registry/baselines.yaml` by pull request —
after the tag exists, because the registry's sync fetches `blueprint.yaml`
at the tag and refuses the whole catalogue if it 404s.

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `01-product` parks: `waiting for github for <org>` | the workspace's GitHub connection is to another account. Connect the App installation on `<org>` (console → Integrations → GitHub), then `--resume` |
| `01-product` parks on the `providers` probe for cloudflare or supabase | that connection is missing. Connect it (console → Integrations); the probe is a wait, not a failure |
| `01-product` stops at `link` | the repository is not linked to the workspace and the credential cannot link it. Allow-list it (console → Settings → Git repos) and re-run the phase |
| Secret WRITE fails `not_found` while listings work | the API key's role is below admin; re-mint it with the admin role |
| supabase apply: `does not support oauth access` | a supabase provider ≥ 1.6 reads billing endpoints the brokered OAuth token cannot; the root pins `~> 1.5.1` — keep it |
| supabase apply: project limit reached | the Supabase org's plan allows fewer projects than stage + prod need; free one or upgrade, then re-run `01-product` |
| hyperdrive apply: Authentication error (10000) | the Hyperdrive token lacks the permission; reconnect Cloudflare with the recipe's permission groups and re-run the phase — the reconcile re-mints only what is missing |
| hyperdrive or db-migrate: `secret resolution failed … SUPABASE_*` | the supabase apply for that environment did not publish; its lane's log says why. Both wait on it, enforced |
| web: `secret resolution failed … WIRING_CLOUDFLARE_{HYPERDRIVE,R2,KV}_*` | that root's apply published no wiring: the root lost its `secretOutputs`, or its lane was not in the plan. Re-run the phase; its retouch marker re-plans the roots |
| r2 apply: `Please enable R2 through the Cloudflare Dashboard` (10042) | R2 is not enabled on the account. Enable it once (dashboard → R2) and re-run the phase |
| r2 apply: Authentication error (10000) | the brokered `r2-data` token lacks R2's permission; reconnect Cloudflare with the recipe's permission groups and re-run the phase |
| `land` stops: `the landing's own check failed — orun plan for …` | the product's tree does not plan — the line after it is orun's own error (an unknown component type, a composition that does not resolve). Nothing was pushed. Fix the tree (or the baseline) and re-run the phase |
| `land` waits on CI after all | the product's repository requires a status check on `main` (branch protection or a ruleset), so GitHub refused the early merge; the landing waits for the check as a `checks: ci` landing would, then merges |
| db-migrate: `extension "vector" is not available` | the database has no pgvector. Every Supabase project has it; a database that is not a Supabase project's needs the extension installed |
| db-migrate: `row-level security would lock the app out of …` | migration 020 refused: `postgres` (Hyperdrive's role) neither owns the tables in `public` nor bypasses RLS. Nothing was enabled; give `postgres` the tables or BYPASSRLS and re-run `01-product` |
| web smoke: `/api/health` 503 | `database: unreachable` — the Hyperdrive config is wrong or the project is paused; `schema: missing` — db-migrate did not run for that environment (the images table or its 768-dimension embedding column is not there) |
| web smoke: `index: {"ok":false,…,"failures":[…]}` | the indexing pass could not describe or embed an image; each failure names the image and the model's error. A Workers AI error (a daily limit on the free plan, a model briefly unavailable) passes on a re-run of the phase, which re-indexes only what is missing |
| web smoke: `index: still {…"remaining":N…}` | the bucket holds more images than thirty calls of four index; run `curl -X POST <url>/api/index` until `"remaining":0`, then re-run the phase |
| web deploy refused over the `AI` binding (an authentication error naming Workers AI) | the brokered deploy token cannot attach a Workers AI binding in this account. Reconnect Cloudflare with the recipe's permission groups (adding Workers AI if the recipe lists it) and re-run the phase |
| the indexing pass or every search fails, and the Worker logs `Workers AI is not available` | the Worker has no `AI` binding — its `wrangler.jsonc` lost the `ai` block. Restore it from `wrangler.template.jsonc` (`pnpm run wire:fixture`) |
| `build-app` fails: `Symlink apps/web/node_modules/next is invalid, it points out of the filesystem root` | the product's intent pins stack-tectonic ≥ 0.20.0, whose lane-scoped install links each job's node_modules out of its tree, which Next 16's Turbopack refuses. Pin 0.19.0 (`intent.yaml` says why) |
| `verify-app-structure` fails: `test -f "wrangler.jsonc"` | the product's `apps/web/wrangler.jsonc` is not committed. It must be — the check runs before the build in a fresh checkout (`pnpm run wire:fixture` renders it) |
| Convergence failed AFTER the PR merged; re-running lands nothing | expected on its own — the files are on main. Re-run the phase (`--phase 01-product`, `--redo 01-product`, or the console's Retry): its `retouch` hook gives the landing a diff and the components re-plan; the project and the config are adopted, not recreated |
| The convergence reported green, then `verify` got 404 | a second workflow ran on the push to main and the watch took its run. Only `ci.yml` may run on a push to main |
| The product's `intent.yaml` says `workspace: ws_SET_ME` | `orunWorkspace` was empty and the build ran outside a workspace; set it and re-run `01-product` |
| A bootstrap stopped before `02-docs`; prod no longer waits on stage | the gate is deferred, not dropped: run `02-docs`, or `node tooling/bootstrap/promotion.mjs --restore --file <product>/intent.yaml` |
| `✕ input "productname" is required` | all three required inputs (`reponame`, `productname`, `githuborg`) must be set on every invocation, single-phase ones included |
| `unknown flag: --phase`, `has no parameter "checks"`, `has no parameter "secrets"` or another parse error in the blueprint | the CLI is below the v2.88.0 floor |
