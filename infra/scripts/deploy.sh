#!/usr/bin/env bash
# Deployment hook called by .github/workflows/deploy.yml.
#   deploy.sh <snapshot|migrate|rollout> <image-tag>
#
# The cloud target is not provisioned yet (blueprint §12 suggests AWS ECS
# Fargate + RDS + ElastiCache + S3). Until it is, every action stops with a
# clear message instead of pretending to deploy. Wire each case to the chosen
# provider (e.g. `aws ecs run-task` for the migrator, `aws ecs update-service`
# for rollout, `aws rds create-db-snapshot` for snapshot) — see
# docs/runbooks/deployment.md.
set -euo pipefail
action="${1:?action required}"
tag="${2:?image tag required}"
target="${DEPLOY_TARGET:?DEPLOY_TARGET required}"

case "$action" in
  snapshot) echo "[$target] would create a pre-migration database snapshot for $tag" ;;
  migrate)  echo "[$target] would run the migrator image ($tag): prisma migrate deploy" ;;
  rollout)  echo "[$target] would update API/web services to $tag and wait for healthy tasks" ;;
  *) echo "unknown action: $action" >&2; exit 2 ;;
esac

echo "ERROR: no deployment target is configured for '$target'. See docs/runbooks/deployment.md." >&2
exit 1
