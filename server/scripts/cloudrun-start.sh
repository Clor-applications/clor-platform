#!/bin/sh
# Cloud Run entrypoint for the API.
#
# Builds the four datasource URLs from ONE secret (DB_PASSWORD) plus non-secret
# settings, so Secret Manager holds a single database credential instead of four
# full URLs. Connects over the Cloud SQL unix socket that Cloud Run mounts at
# /cloudsql/<instance> when the service has the Cloud SQL connection attached.
#
# Each Prisma client has its own pool, sized to how busy that database is:
#   clor_main 4 (every accounting screen), clor_platform 2 (sign-in, membership
#   and permission lookups, which are cached in memory), payroll 1, people 1.
# 8 per instance; with max 2 instances = 16. db-f1-micro allows 25, minus 3
# reserved and ~3 used by Cloud SQL itself, so this must stay at or under ~18.
# Override per database with DB_POOL_MAIN / _PLATFORM / _PAYROLL / _PEOPLE.
#
# If DATABASE_URL is already set (local/dev), nothing is composed.
set -e

if [ -z "$DATABASE_URL" ]; then
  : "${DB_USER:?DB_USER is not set}"
  : "${DB_PASSWORD:?DB_PASSWORD is not set}"
  : "${CLOUDSQL_INSTANCE:?CLOUDSQL_INSTANCE is not set}"
  base="postgresql://${DB_USER}:${DB_PASSWORD}@localhost"
  q="host=/cloudsql/${CLOUDSQL_INSTANCE}&connection_limit"
  export DATABASE_URL="${base}/clor_main?${q}=${DB_POOL_MAIN:-4}"
  export PAYROLL_DATABASE_URL="${base}/clor_payroll?${q}=${DB_POOL_PAYROLL:-1}"
  export PEOPLE_DATABASE_URL="${base}/clor_people?${q}=${DB_POOL_PEOPLE:-1}"
  export PLATFORM_DATABASE_URL="${base}/clor_platform?${q}=${DB_POOL_PLATFORM:-2}"
fi

npm run prisma:deploy
exec node dist/index.js
