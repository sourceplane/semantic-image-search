#!/usr/bin/env bash
# TIER 2 — the product a bootstrap produces builds, migrates, deploys (dry),
# serves, indexes its sample images through its own deploy smoke and finds
# them by what they show, with no AI vendor key.
#
# placement.test.sh proves the tree a bootstrap ends with is the right tree,
# and that its own plan converges in the right order. This proves it WORKS,
# by doing to it what its own pipelines will:
#
#   1. at the 01-product landing (the commit its PR merges), install with the
#      lockfile the product ships, render the wrangler fixture (which must
#      change nothing: the render is committed), typecheck, lint, test, build.
#      The landing itself is checked in the build box with `orun validate`
#      and `orun plan` alone (`checks: local`), and its PR runs `plan` alone
#      (an `orun/BASE-*` branch), so THIS is where a product those steps
#      refuse is caught: before the tag, not after a build has merged it;
#   2. a Postgres of its own on a random port, with pgvector and Supabase's
#      roles — the database a Supabase project would be: `postgres` a login
#      role WITHOUT superuser or BYPASSRLS, `anon` and `authenticated` with
#      the Data API's default grants (testing/lib/local-postgres.sh); and a
#      stand-in for the ONE Supabase Management API endpoint the migration
#      runner calls (testing/lib/fake-supabase-api.py), connected as
#      `postgres`;
#   3. the db-migrate lane's own steps, rendered by `orun plan` for a push to
#      main and run IN THE TREE THE RUNNER STAGES for the job: install, build
#      @saas/db, apply — every migration: the pgvector extension and the
#      images table with its 768-dimension embedding column and its HNSW
#      index, and row-level security on every table in `public` — then apply
#      again, which must apply nothing, and the pull-request profile's
#      offline plan;
#   4. the web lane's own steps for stage, rendered for a pull request (the
#      verify profile carries deploy-dry-run; the deploy profile does not) and
#      run in its staged job tree: install, `verify-app-structure` (the
#      committed wrangler.jsonc must exist BEFORE the build, in a tree with no
#      build output), `build-app` — which re-renders the config from the
#      stage Hyperdrive, R2 and KV wiring documents it is handed, as the
#      deploy does — then `verify-build-output` and `deploy-dry-run`;
#   5. the built Worker under `wrangler dev`, its HYPERDRIVE binding pointed
#      at that Postgres, its R2 bucket and KV namespace wrangler's local
#      ones, with NO .dev.vars — no AI vendor key — and its AI binding
#      pointed at a deterministic stand-in for Workers AI
#      (testing/lib/fake-workers-ai.js), because Workers AI has no local mode
#      and this machine has no Cloudflare account. First the product as a
#      deploy leaves it before its smoke: the page saying the index is empty,
#      /api/health counting no image. Then the component's OWN
#      `smokeCommand` against it, verbatim — which runs the indexing pass
#      until nothing remains: the twelve samples seeded from the Worker's
#      assets into the bucket, each described by the vision model and
#      embedded. Then every route the product promises: the page under the
#      product's own name with all twelve, `/api/health`, a 404, the images
#      delivered from R2 byte for byte (and a 304 for an etag the browser
#      holds) — and searches, as the page runs them: words from one image's
#      description find that image first, words from none find nothing, and
#      a search asked again is answered from KV without embedding it again.
#      Then the pass once more, which indexes nothing and calls no model;
#   6. the Data API's view of the same database: every table in `public` has
#      row-level security, and `anon` and `authenticated` — granted everything
#      Supabase grants them — read no row of it and write none, while the app,
#      as the table's owner and nothing more, reads all twelve.
#
# WHAT IS VERIFIED ONLY OFFLINE: the models. The stand-in answers in the
# shapes Workers AI's JSON mode and its embedding model do, so the app's
# calls, its parsing, its vectors' size, the database's ranking and the
# index pass are the real ones; what Llama 4 Scout writes for an image and
# how BGE ranks a real search are not tested here (the similarity threshold
# is a judgement, lib/db/api.ts). Nor is the platform's half: create the
# repository, mint the brokered tokens, create a Supabase project, a
# Hyperdrive config, a bucket and a namespace (Terraform is validated, not
# applied, in this repository), deploy for real and probe workers.dev. That
# is a bootstrap against a workspace (BOOTSTRAP.md); everything short of it
# is here.
#
# Needs: orun, node, pnpm, python3 (+PyYAML), git, curl, psql, a PostgreSQL
# server install (initdb, pg_ctl) with pgvector, and the network for
# `pnpm install` (or a warm store). A few minutes: three installs, two builds.

set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
# shellcheck source=lib/bootstrap.sh
source "$here/lib/bootstrap.sh"
# shellcheck source=lib/local-postgres.sh
source "$here/lib/local-postgres.sh"

for bin in orun node pnpm python3 git curl psql; do
  command -v "$bin" >/dev/null || { echo "e2e.test.sh needs $bin on PATH" >&2; exit 1; }
done
pg_bin >/dev/null || { echo "e2e.test.sh needs a PostgreSQL server install (initdb, pg_ctl)" >&2; exit 1; }

scratch="$(mktemp -d)"
pgdir="$(mktemp -d)"
dev_pid=""
api_pid=""
# wrangler dev runs under pnpm, node and two workerd processes; a TERM to the
# first does not reach the rest, and waiting on it then never returns. So each
# server is started as its own process group (setsid) and the group stopped.
stop_group() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -TERM -- "-$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 -- "-$pid" 2>/dev/null || break; sleep 0.5; done
  kill -KILL -- "-$pid" 2>/dev/null || true
}
cleanup() {
  stop_group "$dev_pid"
  stop_group "$api_pid"
  pg_down "$pgdir"
  [ -n "$pgdir" ] && [ -d "$pgdir" ] && rm -rf "$pgdir"
  [ -n "$scratch" ] && [ -d "$scratch" ] && rm -rf "$scratch"
}
trap cleanup EXIT
free_port() { python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()"; }
values="$here/fixtures/acme.json"
repo="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['reponame'])" "$values")"
export CI=1 WRANGLER_SEND_METRICS=false NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1

# The landing's own checks, step for step — what the product's Checks
# workflow ran on a pull request before the product carried ci.yml alone —
# run here at once on the whole tree.
LANDING_CHECKS=(
  "pnpm install --frozen-lockfile"
  "pnpm run wire:fixture"
  "pnpm typecheck"
  "pnpm lint"
  "pnpm test"
  "pnpm build"
)
checks() { # DIR LOG
  local dir="$1" log="$2" cmd
  for cmd in "${LANDING_CHECKS[@]}"; do
    echo "   \$ $cmd" | tee -a "$log"
    if ! (cd "$dir" && bash -c "$cmd") >> "$log" 2>&1; then
      echo "FAIL: \`$cmd\` failed in $dir" >&2; tail -40 "$log" >&2; return 1
    fi
  done
}

# One job of a plan, written out as the runner would run it: each `run:` step
# (the `use:` actions are setup-node and setup-pnpm, which this machine has)
# as a numbered script, the job's env, and the component path the steps run
# in. Steps are picked BY ID when given, else every `run:` step in order.
extract_job() { # PLAN JOB-ID OUT-DIR [STEP-ID…]
  python3 - "$@" <<'PY'
import json, pathlib, sys
plan, jid, out, *want = sys.argv[1:]
job = next((j for j in json.load(open(plan))["jobs"] if j["id"] == jid), None)
if job is None:
    sys.exit(f"the plan has no job {jid}")
out = pathlib.Path(out); out.mkdir(parents=True)
steps = [s for s in job["steps"] if s.get("run")]
if want:
    by = {s["id"]: s for s in steps}
    missing = [w for w in want if w not in by]
    if missing:
        sys.exit(f"{jid} has no step(s) {missing}")
    steps = [by[w] for w in want]
for i, s in enumerate(steps):
    (out / f"{i:02d}.sh").write_text(s["run"])
    (out / f"{i:02d}.id").write_text(s["id"])
(out / "path").write_text(job.get("path") or ".")
with (out / "env").open("w") as f:
    for k, v in (job.get("env") or {}).items():
        f.write(f"export {k}={json.dumps(v)}\n")
PY
}
run_job() { # STEPS-DIR WORK-TREE ENV LOG-PREFIX
  local steps="$1" work="$2" envname="$3" logp="$4" s id
  for s in "$steps"/[0-9][0-9].sh; do
    id="$(cat "${s%.sh}.id")"
    echo "   ▸ $id"
    if ! (cd "$work/$(cat "$steps/path")" && source "$steps/env" && export ORUN_ENVIRONMENT="$envname" \
          && bash -e "$s") > "$logp-$id.log" 2>&1; then
      echo "FAIL: the lane's $id step" >&2; tail -40 "$logp-$id.log" >&2; return 1
    fi
  done
}

echo "── the offline bootstrap (testing/lib/bootstrap.sh)"
tree="$scratch/$repo"
bootstrap_offline "$root" "$tree" "$values" "$scratch/logs" > "$scratch/bootstrap.log" 2>&1 || {
  echo "FAIL: the offline bootstrap stopped" >&2; tail -40 "$scratch/bootstrap.log" >&2; exit 1; }
echo "   2 phases placed and landed"

# ── 1. the product's own pull request ──────────────────────────────────────
echo "── 01-product's landing: install, the fixture render, typecheck, lint, test, build"
s01="$(git -C "$tree" rev-parse HEAD~1)"
at01="$scratch/at-01/$repo"
git -C "$tree" worktree add -q "$at01" "$s01"
checks "$at01" "$scratch/checks.log"
dirty="$(git -C "$at01" status --porcelain)"
[ -z "$dirty" ] || { echo "FAIL: the checks changed tracked files — the committed wrangler.jsonc is not the fixture render:" >&2; echo "$dirty" >&2; exit 1; }
echo "   the checks left the tree as committed (wire:fixture rendered the committed wrangler.jsonc)"

# ── 2. a database, and the one API the migration runner calls ──────────────
echo "── a local Postgres and the Supabase Management API stand-in"
pgurl="$(pg_up "$pgdir" "$(free_port)" vector)" || { echo "FAIL: Postgres did not start" >&2; exit 1; }
api_port="$(free_port)"
ref="localproject"
setsid python3 "$here/lib/fake-supabase-api.py" "$api_port" "$pgurl" --ref "$ref" > "$scratch/api.log" 2>&1 < /dev/null &
api_pid=$!
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$api_port/" && break; sleep 0.3; done
echo "   $pgurl; the API on :$api_port"

# The two plans the lanes below run from, each in the product's own tree: a
# push to main at the 01-product commit (the db-migrate lane's APPLY profile),
# and a pull request over the finished product against an empty base (the web
# lane's VERIFY profile, which carries deploy-dry-run, and db-migrate's PLAN).
(cd "$at01" && orun plan --intent intent.yaml --trigger github-push-main --env stage --output "$scratch/plan-main.json") > "$scratch/plan-main.log" 2>&1 \
  || { echo "FAIL: orun plan (push to main)" >&2; tail -15 "$scratch/plan-main.log" >&2; exit 1; }
git -C "$tree" worktree remove --force "$at01"
mkdir -p "$scratch/pr"
git clone -q "$tree" "$scratch/pr/$repo"
prtree="$scratch/pr/$repo"
git -C "$prtree" checkout -q --orphan empty
git -C "$prtree" rm -rqf .
git -C "$prtree" -c user.email=t@example.invalid -c user.name=t commit -qm empty --allow-empty
git -C "$prtree" checkout -q main
(cd "$prtree" && orun plan --intent intent.yaml --trigger github-pull-request --base empty --head HEAD --env stage \
   --output "$scratch/plan-pr.json") > "$scratch/plan-pr.log" 2>&1 \
  || { echo "FAIL: orun plan (pull request)" >&2; tail -15 "$scratch/plan-pr.log" >&2; exit 1; }
# This tier runs the bootstrap floor, newer than the orun the product's CI
# pins, and both read the per-edge `modeRules`: on a pull request — which
# applies and deploys nothing — the infrastructure edges that order a push to
# main are advisory, so no lane waits on another. (placement.test.sh checks
# the push to main's order.)
python3 - "$scratch/plan-pr.json" <<'PY'
import json, sys
jobs = {j["component"]: j for j in json.load(open(sys.argv[1]))["jobs"] if j["environment"] == "stage"}
chain = ["supabase", "cloudflare-hyperdrive", "db-migrate", "web"]
for a, b in list(zip(chain, chain[1:])) + [("cloudflare-r2", "web"), ("cloudflare-kv", "web")]:
    ja, jb = jobs[a], jobs[b]
    if ja["id"] in (jb.get("dependsOn") or []) or ja["id"] not in (jb.get("advisoryDependsOn") or []):
        sys.exit(f"FAIL: on a pull request {b}@stage must name {a}@stage as advisory, not wait on it")
print("   pull request: " + " → ".join(chain) + ", and the R2 bucket and KV namespace → web, every edge advisory")
PY

# ── 3. the db-migrate lane, in its staged job tree ─────────────────────────
echo "── the stage db-migrate lane: install, build @saas/db, apply — then apply again, and the PR's plan"
extract_job "$scratch/plan-main.json" db-migrate.stage.migrate "$scratch/steps-migrate" \
  install-dependencies build-db-package "Migration Apply"
extract_job "$scratch/plan-main.json" db-migrate.stage.migrate "$scratch/steps-migrate-again" "Migration Apply"
extract_job "$scratch/plan-pr.json" db-migrate.stage.migrate "$scratch/steps-migrate-plan" "Migration Plan"
# Staged from the fresh clone (a CI checkout: no build output, no
# node_modules); its migrations are the 01-product commit's, byte for byte.
mwork="$prtree/.orun/runs/e2e/db-migrate.stage.migrate/work"
python3 "$here/lib/stage-job.py" "$prtree" "$mwork"
# The component's secretEnv, as the lane resolves it: the supabase apply's
# published credentials and the brokered access token. SUPABASE_API_URL is
# the one value no lane has — it points the runner at the stand-in.
export SUPABASE_ACCESS_TOKEN=e2e-token SUPABASE_PROJECT_REF="$ref" SUPABASE_DB_PASSWORD=postgres \
       SUPABASE_DB_URL="$pgurl" SUPABASE_API_URL="http://127.0.0.1:$api_port"
run_job "$scratch/steps-migrate" "$mwork" stage "$scratch/migrate"
applied() { python3 -c "import json,sys;t=open(sys.argv[1]).read();print(' '.join(json.loads(t[t.index('{'):t.rindex('}')+1])['applied']))" "$1"; }
want="000_control_baseline 010_images 020_row_level_security"
[ "$(applied "$scratch/migrate-Migration Apply.log")" = "$want" ] \
  || { echo "FAIL: the first apply applied '$(applied "$scratch/migrate-Migration Apply.log")', not '$want'" >&2; exit 1; }
echo "   applied $want"
run_job "$scratch/steps-migrate-again" "$mwork" stage "$scratch/migrate-again"
[ -z "$(applied "$scratch/migrate-again-Migration Apply.log")" ] \
  || { echo "FAIL: a second apply applied '$(applied "$scratch/migrate-again-Migration Apply.log")'" >&2; exit 1; }
echo "   a second apply applied nothing (the ledger holds $(psql "$pgurl" -XAtc 'select count(*) from _migrations.applied') migrations)"
rows="$(psql "$pgurl" -XAtc "select count(*) from images")"
dims="$(psql "$pgurl" -XAtc "select format_type(atttypid, atttypmod) from pg_attribute where attrelid = 'images'::regclass and attname = 'embedding'")"
hnsw="$(psql "$pgurl" -XAtc "select am.amname || ' ' || pg_get_indexdef(i.indexrelid) from pg_index i join pg_class c on c.oid = i.indexrelid join pg_am am on am.oid = c.relam where i.indrelid = 'images'::regclass and c.relname = 'embeddingIndex'")"
[ "$rows" = 0 ] && [ "$dims" = "vector(768)" ] && [[ "$hnsw" == "hnsw "*"vector_cosine_ops"* ]] \
  || { echo "FAIL: after the apply images holds '$rows' rows, its embedding is '$dims', its index '$hnsw'" >&2; exit 1; }
echo "   images is empty, its embedding a vector(768), its embeddingIndex HNSW over cosine distance"
run_job "$scratch/steps-migrate-plan" "$mwork" stage "$scratch/migrate-plan"
[ "$(applied "$scratch/migrate-plan-Migration Plan.log")" = "$want" ] \
  || { echo "FAIL: the pull request's offline plan did not verify every migration" >&2; exit 1; }
echo "   the pull request's plan step verifies every migration's checksum offline"
unset SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD SUPABASE_DB_URL SUPABASE_API_URL
rm -rf "$mwork"

# ── 4. the web lane's steps, for stage ─────────────────────────────────────
echo "── the stage web lane: install, verify-app-structure, build-app, verify-build-output, deploy-dry-run"
extract_job "$scratch/plan-pr.json" web.stage.verify-deploy "$scratch/steps-web" \
  install-workspace-dependencies verify-app-structure build-app verify-build-output deploy-dry-run
work="$prtree/.orun/runs/e2e/web.stage.verify-deploy/work"
# The job's private tree, staged as orun stages it — no build output, no
# node_modules: under stack-tectonic 0.19.0 the job installs inside it.
python3 "$here/lib/stage-job.py" "$prtree" "$work"
[ ! -e "$work/apps/web/.open-next" ] && [ -f "$work/apps/web/wrangler.jsonc" ] \
  || { echo "FAIL: the staged tree is not a fresh checkout with the committed wrangler.jsonc" >&2; exit 1; }
echo "   staged: $(realpath --relative-to="$prtree" "$work") — no build output, the committed wrangler.jsonc"
# The stage wiring documents, as the Hyperdrive, R2 and KV applies publish
# them and the lane resolves them (secretEnv WIRING_CLOUDFLARE_*_STAGE).
hd_id="e2e0000000000000000000000000c0de"
bucket="stg-$repo-e2e"
kv_id="e2e000000000000000000000000000cb"
export WIRING_CLOUDFLARE_HYPERDRIVE_STAGE="{\"hyperdrive_id\":\"$hd_id\",\"hyperdrive_name\":\"stg-$repo-stage\"}"
export WIRING_CLOUDFLARE_R2_STAGE="{\"r2_bucket_name\":\"$bucket\"}"
export WIRING_CLOUDFLARE_KV_STAGE="{\"app_kv_id\":\"$kv_id\",\"app_kv_title\":\"stg-$repo-stage-app\"}"
run_job "$scratch/steps-web" "$work" stage "$scratch/web"
unset WIRING_CLOUDFLARE_HYPERDRIVE_STAGE WIRING_CLOUDFLARE_R2_STAGE WIRING_CLOUDFLARE_KV_STAGE
build_log="$(ls "$scratch"/web-build-app.log)"
grep -q '(Turbopack)' "$build_log" \
  || { echo "FAIL: the staged build did not run on Turbopack" >&2; grep -m3 'Next.js' "$build_log" >&2; exit 1; }
grep -q "\"id\": \"$hd_id\"" "$work/apps/web/wrangler.jsonc" \
  && grep -q "\"bucket_name\": \"$bucket\"" "$work/apps/web/wrangler.jsonc" \
  && grep -q "\"id\": \"$kv_id\"" "$work/apps/web/wrangler.jsonc" \
  || { echo "FAIL: build-app did not re-render wrangler.jsonc from the stage wiring documents" >&2; exit 1; }
[ "$(node -e 'const fs=require("fs");process.stdout.write(String(fs.readdirSync(process.argv[1]).length))' "$work/node_modules")" -gt 0 ] && [ ! -L "$work/node_modules" ] \
  || { echo "FAIL: the job's install did not land inside its own tree" >&2; exit 1; }
echo "   the staged build ran on Turbopack, inside its own tree, bound to the stage Hyperdrive id, bucket and namespace it was handed"




# ── 5. serve it with no AI vendor key, Workers AI stood in for ─────────────
echo "── wrangler dev over the built Worker: HYPERDRIVE on the local Postgres, R2 and KV local, AI on the Workers AI stand-in"
[ ! -e "$work/apps/web/.dev.vars" ] || { echo "FAIL: the staged tree carries a .dev.vars" >&2; exit 1; }
# The stand-in, as a second Worker in the same `wrangler dev`
# (testing/lib/fake-workers-ai.js says what it answers, and why). What it
# says of each sample is testing/fixtures/sample-descriptions.json, keyed by
# the sha256 of the image's bytes — the samples the product ships.
fake="$scratch/fake-workers-ai"
mkdir -p "$fake"
cp "$here/lib/fake-workers-ai.js" "$fake/index.js"
python3 - "$here/fixtures/sample-descriptions.json" "$work/apps/web/public/samples" "$fake/descriptions.json" <<'PY' \
  || { echo "FAIL: could not key the sample descriptions by the samples' bytes" >&2; exit 1; }
import hashlib, json, pathlib, sys
fixture, samples, out = json.load(open(sys.argv[1])), pathlib.Path(sys.argv[2]), sys.argv[3]
shipped = sorted(p.name for p in samples.glob("*.jpg"))
if shipped != sorted(fixture):
    sys.exit(f"the samples shipped are {shipped}, the fixture describes {sorted(fixture)}")
table = {hashlib.sha256((samples / name).read_bytes()).hexdigest(): {"name": name, **meta} for name, meta in fixture.items()}
json.dump(table, open(out, "w"), indent=2)
PY
printf '{ "name": "fake-workers-ai", "main": "index.js", "compatibility_date": "2026-10-01" }\n' > "$fake/wrangler.jsonc"
# The config the build used, with ONE change: its `ai` binding becomes a
# service binding named AI to the stand-in, whose `run()` the Worker reaches
# over RPC as it would reach Workers AI's. Everything else — the Hyperdrive
# binding, the R2 bucket and the KV namespace (wrangler's local ones), the
# assets, the flags — is the built config, under the Worker name the stage
# deploy gives it. Written beside it, in the throwaway tree.
python3 - "$work/apps/web/wrangler.jsonc" "$work/apps/web/wrangler.e2e.json" "$repo-web-stage" <<'PY' \
  || { echo "FAIL: could not derive the dev config from the built one" >&2; exit 1; }
import json, sys
src, out, name = sys.argv[1:]
cfg = json.loads("\n".join(l for l in open(src).read().splitlines() if not l.lstrip().startswith("//")))
if cfg.pop("ai", None) != {"binding": "AI"}:
    sys.exit("the built Worker's wrangler.jsonc does not bind Workers AI as AI")
if [b["binding"] for b in cfg.get("r2_buckets", [])] != ["IMAGES"] or [b["binding"] for b in cfg.get("kv_namespaces", [])] != ["CACHE"]:
    sys.exit("the built Worker's wrangler.jsonc does not bind the bucket as IMAGES and the namespace as CACHE")
cfg.pop("$schema", None)
cfg["name"] = name
cfg["services"] = [{"binding": "AI", "service": "fake-workers-ai"}]
json.dump(cfg, open(out, "w"), indent=2)
PY
port="$(free_port)"
(cd "$work/apps/web" && CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$pgurl" \
  exec setsid pnpm exec wrangler dev --config wrangler.e2e.json --config "$fake/wrangler.jsonc" \
  --ip 127.0.0.1 --port "$port" --inspector-port "$(free_port)" \
  --show-interactive-dev-session=false) > "$scratch/dev.log" 2>&1 < /dev/null &
dev_pid=$!
url="http://127.0.0.1:$port"
for _ in $(seq 1 90); do
  curl -s -o /dev/null "$url/" && break
  kill -0 "$dev_pid" 2>/dev/null || { echo "FAIL: wrangler dev exited" >&2; tail -30 "$scratch/dev.log" >&2; exit 1; }
  sleep 1
done
curl -s -o /dev/null "$url/" || { echo "FAIL: wrangler dev never answered" >&2; tail -30 "$scratch/dev.log" >&2; exit 1; }

# A deploy before its smoke: the database migrated, the bucket empty, nothing
# indexed. The page says so — never a 500 — and the health check counts none.
echo "   ▸ before the smoke: nothing indexed"
python3 - "$url" <<'PY' || { echo "FAIL: the product with nothing indexed; wrangler dev said:" >&2; tail -30 "$scratch/dev.log" >&2; exit 1; }
import json, sys, urllib.request, urllib.error
base = sys.argv[1]
def get(path):
    try:
        with urllib.request.urlopen(base + path, timeout=120) as r:
            return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
s, home = get("/")
if s != 200 or "The index is empty" not in home:
    sys.exit(f"/ with nothing indexed answered {s}, and {'does not say' if 'The index is empty' not in home else 'says'} the index is empty")
s, body = get("/api/health")
if s != 200 or json.loads(body) != {"ok": True, "database": "reachable", "schema": "migrated", "images": 0}:
    sys.exit(f"/api/health with nothing indexed answered {s} {body}")
print("     / answers 200 and says the index is empty; /api/health counts 0 images")
PY

echo "   ▸ the component's own smokeCommand, DEPLOYED_URL=$url — it runs the indexing pass"
smoke="$(python3 -c "import yaml,sys;print(yaml.safe_load(open(sys.argv[1]))['spec']['parameters']['smokeCommand'])" "$tree/apps/web/component.yaml")"
DEPLOYED_URL="$url" bash -c "$smoke" || { echo "FAIL: the deploy's smoke refused the product" >&2; tail -20 "$scratch/dev.log" >&2; exit 1; }

echo "   ▸ every route the product promises, the images from R2, searches, and the pass again"
python3 - "$url" "$values" "$pgurl" "$work/apps/web/public/samples" "$here/fixtures/sample-descriptions.json" "$scratch/dev.log" <<'PY' \
  || { echo "FAIL: the routes; wrangler dev said:" >&2; tail -40 "$scratch/dev.log" >&2; exit 1; }
import hashlib, html, http.client, json, pathlib, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
base, values, pgurl = sys.argv[1], json.load(open(sys.argv[2])), sys.argv[3]
samples, fixture, devlog = pathlib.Path(sys.argv[4]), json.load(open(sys.argv[5])), sys.argv[6]
name = values["productname"]
problems = []
def bad(m): problems.append(m)

def req(path, data=None, headers=None, method=None):
    # A GET whose CONNECTION drops (not one that answers an error) is asked
    # again, twice at most, and says so: `wrangler dev` on a loaded machine
    # has dropped one. A POST is never repeated.
    for attempt in range(3):
        r = urllib.request.Request(base + path, data=data, headers=headers or {}, method=method)
        try:
            with urllib.request.urlopen(r, timeout=120) as resp:
                return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read()
        except urllib.error.HTTPError as e:
            return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()
        except (http.client.RemoteDisconnected, ConnectionResetError) as e:
            if data is not None or method == "POST" or attempt == 2:
                raise
            print(f"     (GET {path}: the connection dropped ({e.__class__.__name__}) — asking again)")
            time.sleep(1)

def page(path):
    s, h, body = req(path)
    return s, h, body.decode(errors="replace")

def sql(query):
    return subprocess.run(["psql", pgurl, "-XAt", "-c", query], capture_output=True, text=True, check=True).stdout.strip()

def calls():
    return [json.loads(m.group(1)) for m in re.finditer(r"fake-workers-ai (\{.*\})", open(devlog, errors="replace").read())]

def shown(body):
    # The image cards in the order the page renders them: each an <img> whose
    # src is the image's own path, its alt the title the model wrote.
    return [(html.unescape(src), html.unescape(alt)) for src, alt in
            re.findall(r'<img[^>]*?src="(/images/[^"]+)"[^>]*?alt="([^"]*)"', body)] or \
           [(html.unescape(src), html.unescape(alt)) for alt, src in
            re.findall(r'<img[^>]*?alt="([^"]*)"[^>]*?src="(/images/[^"]+)"', body)]

# ── the page, under the product's own name, with every image ─────────────
s, _, home = page("/")
if s != 200:
    bad(f"/ answered {s}")
title = re.search(r"<title>(.*?)</title>", home, re.S)
if not title or html.unescape(title.group(1)) != name:
    bad(f"the page's <title> is {title and title.group(1)!r}, not {name!r}")
if "Semantic Image Search" in home:
    bad("the page still carries the baseline's name")
h1 = re.search(r"<h1[^>]*>(.*?)</h1>", home, re.S)
if not h1 or html.unescape(re.sub(r"<[^>]+>", "", h1.group(1))).strip() != name:
    bad(f"the page's header is {h1 and h1.group(1)!r}, not {name!r}")
if 'placeholder="Search..."' not in home:
    bad("the page has no search box")
source = f'href="https://github.com/{values["githuborg"]}/{values["reponame"]}"'
if source not in home or "vercel.com/new" in home:
    bad(f"the page's source link is not {source} (or the Vercel deploy button is still there)")
want_cards = sorted((f"/images/{n}", m["title"]) for n, m in fixture.items())
if sorted(shown(home)) != want_cards or [p for p, _ in shown(home)] != sorted(p for p, _ in want_cards):
    bad(f"/ shows {shown(home)}, not the twelve samples by path under the titles the model wrote")
if "The index is empty" in home:
    bad("/ still says the index is empty after the smoke indexed it")
# The Open Graph image link is absolute, resolved against the origin the
# build was given (component.yaml's NEXT_PUBLIC_SITE_URL, rebranded): the
# product's own stage Worker — never upstream's demo on vercel.app.
og = re.search(r'<meta property="og:image" content="([^"]+)"', home)
want_origin = f"https://{values['reponame']}-web-stage.{values['subdomain']}.workers.dev/"
if not og or "vercel.app" in og.group(1) or not og.group(1).startswith(want_origin + "opengraph-image"):
    bad(f"the Open Graph image is {og and og.group(1)!r}, not on the stage origin {want_origin} the build was given")
else:
    image = urllib.parse.urlsplit(html.unescape(og.group(1)))
    s, h, png = req(image.path + (f"?{image.query}" if image.query else ""))
    if s != 200 or not h.get("content-type", "").startswith("image/png") or not png:
        bad(f"the Open Graph image's path {image.path} answered {s} {h.get('content-type')}")
s, _, _ = req("/no-such-page")
if s != 404:
    bad(f"/no-such-page answered {s}, not 404")

# ── what only the Worker answers ──────────────────────────────────────────
s, _, body = page("/api/health")
if s != 200 or json.loads(body) != {"ok": True, "database": "reachable", "schema": "migrated", "images": 12}:
    bad(f"/api/health answered {s} {body}")
rows = json.loads(sql("select coalesce(json_agg(t order by path), '[]') from (select path, title, description, model, content_hash, vector_dims(embedding) as dims from images) t"))
want_rows = [{"path": f"/images/{n}", "title": m["title"], "description": m["description"],
              "model": "@cf/meta/llama-4-scout-17b-16e-instruct",
              "content_hash": hashlib.sha256((samples / n).read_bytes()).hexdigest(), "dims": 768}
             for n, m in sorted(fixture.items())]
if rows != want_rows:
    bad(f"the images table holds {rows!r}, not the twelve samples as described, hashed and embedded")

# ── the images, from R2 ───────────────────────────────────────────────────
s, h, jpg = req("/images/pizza.jpg")
if s != 200 or jpg != (samples / "pizza.jpg").read_bytes() or h.get("content-type") != "image/jpeg" \
        or not h.get("etag") or h.get("x-content-type-options") != "nosniff":
    bad(f"/images/pizza.jpg answered {s} {h.get('content-type')} ({len(jpg)} bytes), not the sample's bytes as image/jpeg with an etag")
else:
    s, _, again = req("/images/pizza.jpg", headers={"If-None-Match": h["etag"]})
    if s != 304 or again:
        bad(f"/images/pizza.jpg with its own etag answered {s}, not 304")
for path in ("/images/no-such-image.jpg", "/images/notes.txt", "/images/%2e%2e/wrangler.json"):
    s, _, _ = req(path)
    if s != 404:
        bad(f"{path} answered {s}, not 404")

# ── searches, as the page runs them ───────────────────────────────────────
def embeds_of(text):
    return sum(1 for c in calls() if c.get("kind") == "embed" and text in c.get("texts", []))

for query, want in [("crimson brick street bicycle", "/images/bicycle.jpg"),
                    ("pepperoni slice melted cheese", "/images/pizza.jpg")]:
    before = embeds_of(query)
    s, _, body = page("/?q=" + urllib.parse.quote_plus(query))
    found = shown(body)
    # Words from the description, not a phrase in it: a semantic match only,
    # above the threshold (lib/db/api.ts), never upstream's direct one.
    scores = [float(x) for x in re.findall(r"Semantic Match: (?:<!-- -->)?([0-9.]+)", body)]
    if s != 200 or not found or found[0][0] != want or "Direct Match" in body or not scores or min(scores) <= 0.5:
        bad(f"?q={query!r} answered {s} with {found} scored {scores}, not {want} first, as a semantic match over 0.5")
    if embeds_of(query) != before + 1:
        bad(f"?q={query!r} embedded the search {embeds_of(query) - before} times, not once")
    s, _, body = page("/?q=" + urllib.parse.quote_plus(query))
    if s != 200 or not shown(body) or shown(body)[0][0] != want:
        bad(f"?q={query!r} asked again answered {s} with {shown(body)}")
    if embeds_of(query) != before + 1:
        bad(f"?q={query!r} asked again embedded the search again: the KV cache was not read")
s, _, body = page("/?q=" + urllib.parse.quote_plus("quantum xylophone zebra"))
if s != 200 or shown(body) or "No images found" not in body:
    bad(f"?q='quantum xylophone zebra' answered {s} with {shown(body)}, not 'No images found'")

# ── the pass again: nothing to do, no model called ────────────────────────
described = sum(1 for c in calls() if c.get("kind") == "describe")
s, _, body = req("/api/index", data=b"", method="POST")
result = json.loads(body)
if s != 200 or {k: result.get(k) for k in ("ok", "seeded", "indexed", "unchanged", "removed", "remaining", "images", "failures")} \
        != {"ok": True, "seeded": 0, "indexed": 0, "unchanged": 12, "removed": 0, "remaining": 0, "images": 12, "failures": []}:
    bad(f"a second indexing pass answered {s} {result}")
if sum(1 for c in calls() if c.get("kind") == "describe") != described:
    bad("a second indexing pass asked the vision model again")

if problems:
    for p in problems:
        print(f"  ✕ {p}", file=sys.stderr)
    sys.exit(1)
print(f"     / as {name!r} (its title and its header) with the twelve samples, its source link, its Open Graph image on {want_origin}, a 404; "
      "/api/health (12 images); the images table as described, hashed and embedded at 768; "
      "/images/pizza.jpg from R2 byte for byte, a 304 for its etag, 404s for a missing image, a text file and a traversal; "
      "'crimson brick street bicycle' finds the bicycle first and 'pepperoni slice melted cheese' the pizza, each embedded once and "
      "answered from KV when asked again, 'quantum xylophone zebra' finds nothing; a second pass indexes nothing and describes nothing")
PY

# What the Workers AI stand-in was asked, read back from wrangler's output:
# every sample described once, whole, in JSON mode, with upstream's prompt
# and schema, by the model lib/ai/models.ts names; and every embedding the
# title and description of one of them, or a search.
python3 - "$scratch/dev.log" "$here/fixtures/sample-descriptions.json" <<'PY' \
  || { echo "FAIL: the AI binding's calls" >&2; grep 'fake-workers-ai' "$scratch/dev.log" | tail -20 >&2; exit 1; }
import json, re, sys
calls = [json.loads(m.group(1)) for m in re.finditer(r"fake-workers-ai (\{.*\})", open(sys.argv[1]).read())]
fixture = json.load(open(sys.argv[2]))
problems = []
refused = [c for c in calls if "refused" in c]
if refused:
    problems.append(f"the stand-in refused {refused}")
described = sorted(c["name"] for c in calls if c.get("kind") == "describe")
if described != sorted(fixture):
    problems.append(f"the vision model described {described}: want each of the twelve samples once")
for c in (c for c in calls if c.get("kind") == "describe"):
    if c["prompt"] != "Describe the image in detail." or c["schema"] != ["image"] or c["roles"] != ["user"] \
            or c["contentType"] != "image/jpeg":
        problems.append(f"a vision call was not upstream's prompt and schema over one JPEG: {c}")
indexed = {m["title"] + "\n" + m["description"] for m in fixture.values()}
searched = {"crimson brick street bicycle", "pepperoni slice melted cheese", "quantum xylophone zebra"}
texts = [t for c in calls if c.get("kind") == "embed" for t in c["texts"]]
if sorted(t for t in texts if t in indexed) != sorted(indexed) or set(texts) - indexed - searched:
    problems.append(f"the embeddings were {texts}: want each sample's title and description once, and the searches")
for p in problems:
    print(f"  ✕ {p}", file=sys.stderr)
if problems:
    sys.exit(1)
print(f"   the AI binding: {len(described)} images described, {len(texts)} texts embedded, every call the model lib/ai/models.ts names")
PY

# ── 6. what Supabase's Data API would see ──────────────────────────────────
echo "── the Data API's roles (anon, authenticated) against the same database"
psql "$pgurl" -X -q -v ON_ERROR_STOP=1 -At > "$scratch/rls.out" 2> "$scratch/rls.err" <<'SQL' \
  || { echo "FAIL: the row-level security checks" >&2; cat "$scratch/rls.err" >&2; exit 1; }
SELECT 'app role: superuser=' || rolsuper || ' bypassrls=' || rolbypassrls FROM pg_roles WHERE rolname = current_user;
SELECT 'public tables without RLS: ' || count(*) FILTER (WHERE NOT c.relrowsecurity) || ' of ' || count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
SELECT 'not owned by the app: ' || count(*) FILTER (WHERE pg_get_userbyid(c.relowner) <> current_user)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
SELECT 'app sees images: ' || count(*) FROM images;
SET ROLE anon;
SELECT 'anon sees images: ' || count(*) FROM images;
RESET ROLE;
SET ROLE authenticated;
SELECT 'authenticated sees images: ' || count(*) FROM images;
RESET ROLE;
SQL
sed 's/^/   /' "$scratch/rls.out"
grep -qx "app role: superuser=false bypassrls=false" "$scratch/rls.out" \
  && grep -qx "public tables without RLS: 0 of 1" "$scratch/rls.out" \
  && grep -qx "not owned by the app: 0" "$scratch/rls.out" \
  || { echo "FAIL: the app's role, the table's owner or its row-level security is not what Supabase's would be" >&2; exit 1; }
for line in "app sees images: 12" "anon sees images: 0" "authenticated sees images: 0"; do
  grep -qx "$line" "$scratch/rls.out" || { echo "FAIL: expected '$line'" >&2; exit 1; }
done
# A write through the Data API's roles is refused by row-level security.
for role in anon authenticated; do
  if psql "$pgurl" -X -q -At -c "SET ROLE $role; INSERT INTO images (id, title, description, path, content_hash, etag, model, embedding) VALUES ('$role', 'x', 'x', '/images/$role.jpg', 'x', 'x', 'x', array_fill(0, ARRAY[768])::vector)" > "$scratch/rls-write.log" 2>&1; then
    echo "FAIL: $role wrote a row through row-level security" >&2; exit 1
  fi
  grep -q "row-level security" "$scratch/rls-write.log" \
    || { echo "FAIL: $role's write was refused for another reason:" >&2; cat "$scratch/rls-write.log" >&2; exit 1; }
done
echo "   anon and authenticated, granted what Supabase grants them, read the table as empty and write nothing; the app reads all twelve rows as its owner"

echo "e2e.test.sh: ok"
