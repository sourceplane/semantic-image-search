#!/usr/bin/env bash
# THE REBRAND WRITES EACH VALUE ONCE, AND WHAT IT WROTE STAYS WRITTEN.
#
# Drives the real tooling/rebrand/rebrand.mjs over one-file trees and compares
# the file. Each case is a shape this baseline's identity actually takes in the
# tree — the name seam, the worker name, the Worker's own origin, the
# placeholder domain, a secret ref, the `repo` the Supabase project is named
# after — and each runs through as many passes as a bootstrap might make, so a
# value written once must survive every later pass unchanged. Two things must
# NOT be renamed: the upstream's own identity (Vercel's
# semantic-image-search repository, which is named exactly what this
# baseline's slug is), and a migration — even one that spells the slug
# (its checksum is in the manifest and in every database it was applied to).
#
# The identity is PINNED (fixtures/baseline-identity.semantic-image-search.json) rather
# than read from .baseline/identity.json: what this tests is the engine, and
# its fixtures spell the identity out literally.
#
# Needs: node, git. No network.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
rebrand="$here/../tooling/rebrand/rebrand.mjs"
identity="$here/fixtures/baseline-identity.semantic-image-search.json"

fail=0
# check NAME VALUES-JSON FILE CONTENT WANT [PASSES]
check() {
  local name="$1" values="$2" file="$3" content="$4" want="$5" passes="${6:-1}"
  local tmp got out i
  tmp="$(mktemp -d)"
  git -C "$tmp" init -q
  mkdir -p "$tmp/$(dirname "$file")" "$tmp/.rebrand"
  printf '%s\n' "$content" > "$tmp/$file"
  printf '%s\n' "$values" > "$tmp/.rebrand/values.json"
  for ((i = 1; i <= passes; i++)); do
    git -C "$tmp" add -A
    if ! out="$(cd "$tmp" && node "$rebrand" --baseline-identity "$identity" --values .rebrand/values.json --allow-dirty 2>&1)"; then
      echo "   ✕  $name: rebrand pass $i failed:" >&2
      printf '%s\n' "$out" | sed 's/^/        /' >&2
      fail=1
      rm -rf "$tmp"
      return
    fi
  done
  got="$(cat "$tmp/$file")"
  rm -rf "$tmp"
  if [ "$got" = "$want" ]; then
    echo "   ok  $name"
  else
    echo "   ✕  $name:" >&2
    echo "        got:  $got" >&2
    echo "        want: $want" >&2
    fail=1
  fi
}

acme='{"reponame":"acme-gallery","productname":"Acme Gallery","productdomain":"acme.dev","githuborg":"acme-inc","subdomain":"acme","orunWorkspace":"ws_79BDXAZQ"}'
seam='export const SITE_NAME = "Semantic Image Search";'

echo "── rebrand: the product's own identity"
check "the name seam takes the product's name" \
  "$acme" apps/web/lib/site.ts "$seam" \
  'export const SITE_NAME = "Acme Gallery";'
check "…and stays a valid string for a name with an apostrophe and an ampersand" \
  '{"reponame":"sams-pictures","productname":"Sam'"'"'s Pictures & Finds","productdomain":"sam.dev"}' \
  apps/web/lib/site.ts "$seam" \
  'export const SITE_NAME = "Sam'"'"'s Pictures & Finds";'
check "the display name elsewhere is content, and is left alone" \
  "$acme" README.md 'The page title reads Semantic Image Search.' \
  'The page title reads Semantic Image Search.'
check "the worker name is re-prefixed, the environment suffix kept" \
  "$acme" apps/web/component.yaml 'workerName: semantic-image-search-web' \
  'workerName: acme-gallery-web'
check "the Worker's own origin: worker name and subdomain" \
  "$acme" intent.yaml \
  '    url: https://semantic-image-search-web-stage.your-workers-subdomain.workers.dev' \
  '    url: https://acme-gallery-web-stage.acme.workers.dev'
check "the site URL the build bakes in (the Open Graph link): worker name and subdomain" \
  "$acme" apps/web/component.yaml \
  'buildCommand: NEXT_PUBLIC_SITE_URL="${SITE_URL:-https://semantic-image-search-web-${ORUN_ENVIRONMENT}.your-workers-subdomain.workers.dev}" pnpm build' \
  'buildCommand: NEXT_PUBLIC_SITE_URL="${SITE_URL:-https://acme-gallery-web-${ORUN_ENVIRONMENT}.acme.workers.dev}" pnpm build'
check "the placeholder domain is the product's domain, not a renamed slug" \
  "$acme" intent.yaml '      BASE_DOMAIN: semantic-image-search.example.com' \
  '      BASE_DOMAIN: acme.dev'
check "no domain given: the reserved placeholder, for an owner to replace later" \
  '{"reponame":"acme-gallery","productname":"Acme Gallery","githuborg":"acme-inc","subdomain":"acme"}' \
  intent.yaml '      BASE_DOMAIN: semantic-image-search.example.com' \
  '      BASE_DOMAIN: acme-gallery.example.com'
check "an empty domain is no domain" \
  '{"reponame":"acme-gallery","productname":"Acme Gallery","productdomain":""}' \
  intent.yaml '      BASE_DOMAIN: semantic-image-search.example.com' \
  '      BASE_DOMAIN: acme-gallery.example.com'
check "the repo slug" \
  "$acme" package.json '  "name": "semantic-image-search",' \
  '  "name": "acme-gallery",'
check "the repo Terraform names the Supabase project and Hyperdrive config after" \
  "$acme" intent.yaml '        repo: semantic-image-search' \
  '        repo: acme-gallery'
check "the fixture's Hyperdrive name follows it" \
  "$acme" apps/web/wiring.fixture.json '    "hyperdrive_name": "stg-semantic-image-search-stage"' \
  '    "hyperdrive_name": "stg-acme-gallery-stage"'
check "a secret ref names the product's workspace and project" \
  "$acme" infra/db-migrate/component.yaml \
  '    SUPABASE_ACCESS_TOKEN: "secret://semantic-image-search/semantic-image-search/{{ .environment }}/SUPABASE_ACCESS_TOKEN"' \
  '    SUPABASE_ACCESS_TOKEN: "secret://ws_79BDXAZQ/acme-gallery/{{ .environment }}/SUPABASE_ACCESS_TOKEN"'
check "this repository's source link names the product's owner and repository" \
  "$acme" README.md 'See https://github.com/sourceplane/semantic-image-search.' \
  'See https://github.com/acme-inc/acme-gallery.'
check "org-owned identity is not renamed" \
  "$acme" intent.yaml 'apiVersion: sourceplane.io/v1 # mail ops@sourceplane.ai' \
  'apiVersion: sourceplane.io/v1 # mail ops@sourceplane.ai'

echo "── rebrand: what spells the slug and is not this baseline's"
check "the upstream template's repository is upstream's, though it is named the slug" \
  "$acme" apps/web/README.md 'Clone https://github.com/vercel-labs/semantic-image-search to start.' \
  'Clone https://github.com/vercel-labs/semantic-image-search to start.'
check "…and so are its page in Vercel's gallery and its demo" \
  "$acme" README.md 'See https://vercel.com/templates/next.js/semantic-image-search and https://semantic-image-search.vercel.app.' \
  'See https://vercel.com/templates/next.js/semantic-image-search and https://semantic-image-search.vercel.app.'
check "…but only those exact strings: the slug beside them is still renamed" \
  "$acme" README.md 'Fork vercel-labs/semantic-image-search into semantic-image-search.' \
  'Fork vercel-labs/semantic-image-search into acme-gallery.'
check "…and so is its name, which is not this product's seam" \
  "$acme" apps/web/README.md '# Semantic Image Search' \
  '# Semantic Image Search'
check "a migration is never rewritten (its checksum is in the manifest)" \
  "$acme" packages/db/src/migrations/030_x/up.sql '-- semantic-image-search: a comment the checksum covers' \
  '-- semantic-image-search: a comment the checksum covers'
check "nor is the images table's (010), whatever it says" \
  "$acme" packages/db/src/migrations/010_images/up.sql '-- the semantic-image-search images, 768 wide' \
  '-- the semantic-image-search images, 768 wide'

echo "── rebrand: a written value is not rewritten, in any later pass"
contains='{"reponame":"semantic-image-search-2","productname":"Semantic Image Search 2","productdomain":"semantic-image-search.example.com.au","githuborg":"sourceplane","subdomain":"your-workers-subdomain-2"}'
check "a repo slug containing the baseline's slug survives three passes" \
  "$contains" package.json '  "name": "semantic-image-search",' \
  '  "name": "semantic-image-search-2",' 3
check "a worker name built on it survives three passes" \
  "$contains" apps/web/component.yaml 'workerName: semantic-image-search-web' \
  'workerName: semantic-image-search-2-web' 3
check "a domain containing the baseline's domain survives three passes" \
  "$contains" intent.yaml 'BASE_DOMAIN: semantic-image-search.example.com' \
  'BASE_DOMAIN: semantic-image-search.example.com.au' 3
check "a subdomain containing the placeholder survives three passes" \
  "$contains" apps/web/component.yaml 'workersDevSubdomain: your-workers-subdomain' \
  'workersDevSubdomain: your-workers-subdomain-2' 3
check "a name containing the baseline's name survives three passes" \
  "$contains" apps/web/lib/site.ts "$seam" \
  'export const SITE_NAME = "Semantic Image Search 2";' 3

# --verify runs after every rebrand. Without the product's values it cannot
# tell the product's own identity from a leftover; with them it can. A real
# leftover must fail it either way.
verify() { # NAME VALUES FILE CONTENT WANT(pass|fail) [--values]
  local name="$1" values="$2" file="$3" content="$4" want="$5" withvalues="${6:-}" tmp got
  tmp="$(mktemp -d)"
  git -C "$tmp" init -q
  mkdir -p "$tmp/$(dirname "$file")" "$tmp/.rebrand"
  printf '%s\n' "$content" > "$tmp/$file"
  printf '%s\n' "$values" > "$tmp/.rebrand/values.json"
  git -C "$tmp" add -A
  if (cd "$tmp" && node "$rebrand" --baseline-identity "$identity" --verify ${withvalues:+--values .rebrand/values.json} >/dev/null 2>&1); then got=pass; else got=fail; fi
  rm -rf "$tmp"
  if [ "$got" = "$want" ]; then echo "   ok  $name"; else echo "   ✕  $name: --verify ${got}ed, want $want" >&2; fail=1; fi
}
echo "── rebrand --verify: the product's own identity is not residue"
verify "given the values, a slug containing the baseline's passes" \
  "$contains" package.json '"name": "semantic-image-search-2"' pass --values
verify "without them it cannot know, and fails" \
  "$contains" package.json '"name": "semantic-image-search-2"' fail
verify "given the values, a real leftover still fails" \
  "$acme" package.json '"name": "semantic-image-search"' fail --values
verify "a leftover worker name fails" \
  "$acme" apps/web/component.yaml 'workerName: semantic-image-search-web' fail --values
verify "a leftover code identifier fails (no rule renames it — so nothing may spell it)" \
  "$acme" apps/web/app/x.ts 'export class SemanticImageSearch {}' fail --values
verify "the upstream repository's link is not residue" \
  "$acme" apps/web/README.md 'https://github.com/vercel-labs/semantic-image-search' pass --values
verify "a clean product passes" \
  "$acme" package.json '"name": "acme-gallery"' pass --values

echo "── rebrand: a residue it cannot rename fails the rebrand itself"
tmp="$(mktemp -d)"; git -C "$tmp" init -q; mkdir -p "$tmp/.rebrand" "$tmp/apps/web"
printf '%s\n' "$acme" > "$tmp/.rebrand/values.json"
printf 'const x = "SEMANTIC_IMAGE_SEARCH_TOKEN"\n' > "$tmp/apps/web/x.ts"
git -C "$tmp" add -A
if (cd "$tmp" && node "$rebrand" --baseline-identity "$identity" --values .rebrand/values.json --allow-dirty >/dev/null 2>&1); then
  echo "   ✕  an unrenamable env-var prefix passed the rebrand" >&2; fail=1
else
  echo "   ok  an unrenamable env-var prefix fails the rebrand, naming the file"
fi
rm -rf "$tmp"

[ "$fail" -eq 0 ] || exit 1
echo "rebrand.test.sh: ok"
