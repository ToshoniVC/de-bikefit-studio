#!/usr/bin/env bash
#
# Refresh the Neon `staging` branch so it mirrors production, then scrub PII.
#
# Requirements:
#   - neonctl installed and authenticated:  npm i -g neonctl && neonctl auth
#   - env vars (or a .env at repo root):
#       NEON_PROJECT_ID     your Neon project id
#       STAGING_DATABASE_URL  pooled connection string for the staging branch
#   - psql on PATH (for the anonymization step)
#
# Usage:  ./scripts/reset-staging.sh
#
set -euo pipefail

PARENT_BRANCH="${PARENT_BRANCH:-production}"
STAGING_BRANCH="${STAGING_BRANCH:-staging}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${NEON_PROJECT_ID:-}" ]]; then
  echo "✗ NEON_PROJECT_ID is not set." >&2
  exit 1
fi

echo "⚠️  This will RESET the '${STAGING_BRANCH}' branch from '${PARENT_BRANCH}'."
echo "    All current staging data will be replaced with a copy of production."
read -r -p "    Type 'yes' to continue: " confirm
[[ "$confirm" == "yes" ]] || { echo "Aborted."; exit 1; }

echo "→ Resetting ${STAGING_BRANCH} from ${PARENT_BRANCH}…"
neonctl branches reset "$STAGING_BRANCH" \
  --project-id "$NEON_PROJECT_ID" \
  --parent

if [[ -n "${STAGING_DATABASE_URL:-}" ]]; then
  echo "→ Anonymizing PII in staging…"
  psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/anonymize-staging.sql"
  echo "✓ Staging refreshed and anonymized."
else
  echo "⚠️  STAGING_DATABASE_URL not set — skipped anonymization."
  echo "    Run it manually: psql \"\$STAGING_DATABASE_URL\" -f scripts/anonymize-staging.sql"
fi
