#!/bin/sh
# Step 5 of DEPLOYMENT.md: create a bot's own Access service token for
# Lockkeeper and put both halves on the Worker, without the secret ever being
# shown. Engineering (the defaults), then Security:
#
#   cd coworkers && direnv exec .. sh scripts/lockkeeper-service-token.sh
#   cd coworkers && direnv exec .. sh scripts/lockkeeper-service-token.sh coworkers-security coworkers SECURITY_
#
# Needs CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (Wrangler's deploy token)
# and CLOUDFLARE_ACCESS_API_TOKEN (Access: Service Tokens Write) from the
# workspace .envrc. Run the VAPID commands of step 6 first, so the Worker
# exists and Wrangler asks nothing here: the secret is returned once, and an
# aborted put would lose it. Prints the token's id and client id, never the
# secret; the id goes into the Lockkeeper Access application's policy.
set -eu
: "${CLOUDFLARE_ACCOUNT_ID:?set by the workspace .envrc}"
: "${CLOUDFLARE_ACCESS_API_TOKEN:?an API token with Access: Service Tokens Write}"
NAME=${1:-coworkers-engineering}
WORKER=${2:-coworkers}
# The secrets' prefix: empty for Engineering, SECURITY_ for Security.
PREFIX=${3:-}
case "$PREFIX" in ''|SECURITY_) ;; *) echo "unknown prefix $PREFIX" >&2; exit 1 ;; esac
WRANGLER="pnpm dlx wrangler@4.95.0"

RESP=$(curl -sS -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/service_tokens" \
  -H "Authorization: Bearer $CLOUDFLARE_ACCESS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "{\"name\":\"$NAME\",\"duration\":\"8760h\"}")
if [ "$(printf '%s' "$RESP" | jq -r .success)" != true ]; then
  printf '%s\n' "$RESP" | jq '.errors' >&2
  exit 1
fi
printf '%s' "$RESP" | jq -r .result.client_id | $WRANGLER secret put "${PREFIX}LOCKKEEPER_ACCESS_CLIENT_ID" --name "$WORKER"
printf '%s' "$RESP" | jq -r .result.client_secret | $WRANGLER secret put "${PREFIX}LOCKKEEPER_ACCESS_CLIENT_SECRET" --name "$WORKER"
printf '\nservice token %s created for one year\n  id        %s\n  client id %s\nGive the id to the session: it goes into the Lockkeeper Access application.\n' \
  "$NAME" "$(printf '%s' "$RESP" | jq -r .result.id)" "$(printf '%s' "$RESP" | jq -r .result.client_id)"
