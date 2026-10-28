# web — runbook

## How it runs

Pull requests verify it; a merge to `main` deploys it to `stage`, `prod`.
CI plans what changed (`orun plan --changed`) and runs each lane with `orun run`;
the plan orders a component after everything it depends on.

## Local commands

```bash
pnpm --filter @app/web dev
pnpm --filter @app/web build
pnpm --filter @app/web typecheck
pnpm --filter @app/web lint
pnpm --filter @app/web preview
```

## Verify

After a deploy the lane runs this smoke against the environment it
deployed (`ORUN_ENVIRONMENT`); `DEPLOYED_URL` overrides the URL:

```bash
html=$(curl -sfL "${DEPLOYED_URL}/") && echo "${html}" | grep -q 'placeholder="Search..."' && i=0 && while :; do indexed=$(curl -sf -X POST "${DEPLOYED_URL}/api/index") || { echo "index: ${indexed}"; exit 1; }; echo "${indexed}" | grep -q '"ok":true' || { echo "index: ${indexed}"; exit 1; }; echo "${indexed}" | grep -q '"remaining":0' && break; i=$((i+1)); [ "$i" -lt 30 ] || { echo "index: still ${indexed}"; exit 1; }; done && health=$(curl -sf "${DEPLOYED_URL}/api/health") && echo "${health}" | grep -q '"ok":true' && ! echo "${health}" | grep -q '"images":0'
```

## Rollback

Revert the commit on `main`. The next convergence applies the previous desired
state; nothing was changed out of band, so there is nothing else to undo.

## Common failures

- **A `WIRING_*` secret is missing at deploy**: an infrastructure lane upstream
  has not applied for this environment yet. Within one convergence the plan
  runs it first; on its own, re-run that lane.
- **The smoke fails right after a first deploy**: a new workers.dev route can
  answer 4xx for a few seconds and the lane retries. A failure that persists
  is a regression in the deployed code.
