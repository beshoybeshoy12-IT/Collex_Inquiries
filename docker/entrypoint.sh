#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════
#  Collex Inquiries — container entrypoint (api and worker share it)
# ═══════════════════════════════════════════════════════════════════════════
#
#  ROLE=worker  → wait for the database, start dist/worker.js. NO MIGRATIONS.
#  anything else → wait for the database, run `prisma migrate deploy`, start
#                  dist/main.js.
#
#  Only ONE process may migrate. Two containers running `migrate deploy`
#  against one database at the same moment is how a schema ends up half
#  applied: Prisma's advisory lock protects a single migration, not the
#  interleaving of two runners that each believe they are first. compose.yml
#  enforces the ordering (worker `depends_on` a healthy api); this file
#  enforces it again, because a `docker run` outside compose has no ordering
#  at all.
# ═══════════════════════════════════════════════════════════════════════════

set -eu

ROLE="${ROLE:-api}"

log() {
    echo "[entrypoint] $*"
}

fail() {
    echo "[entrypoint] FATAL: $*" >&2
    exit 1
}

# ── Required configuration ─────────────────────────────────────────────────
# Checked here rather than left to crash inside Nest, so a misconfigured
# deployment says which variable is missing instead of printing a stack trace
# about an undefined connection string.
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set."
[ -n "${JWT_SECRET:-}" ]   || fail "JWT_SECRET is not set."

# ── Wait for PostgreSQL ────────────────────────────────────────────────────
# Parsed out of DATABASE_URL so there is one source of truth for where the
# database is. compose.yml already gates on a healthcheck, but a plain
# `docker run` does not, and a container that dies in a restart loop for
# thirty seconds while Postgres boots looks like a broken image.
wait_for_tcp() {
    host="$1"
    port="$2"
    label="$3"
    attempt=0
    limit="${WAIT_ATTEMPTS:-60}"

    log "waiting for ${label} at ${host}:${port} ..."
    while [ "$attempt" -lt "$limit" ]; do
        if nc -z "$host" "$port" 2>/dev/null; then
            log "${label} is accepting connections."
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 1
    done

    fail "${label} at ${host}:${port} did not become reachable within ${limit}s."
}

# postgresql://user:pass@host:port/db?params  →  host, port
db_host_port=$(
    printf '%s' "$DATABASE_URL" |
        sed -e 's|^[a-zA-Z+]*://||' -e 's|^[^@]*@||' -e 's|[/?].*$||'
)
db_host="${db_host_port%%:*}"
db_port="${db_host_port##*:}"
[ "$db_port" = "$db_host" ] && db_port=5432

wait_for_tcp "$db_host" "$db_port" "PostgreSQL"

if [ -n "${REDIS_URL:-}" ]; then
    redis_host_port=$(
        printf '%s' "$REDIS_URL" |
            sed -e 's|^[a-zA-Z+]*://||' -e 's|^[^@]*@||' -e 's|[/?].*$||'
    )
    redis_host="${redis_host_port%%:*}"
    redis_port="${redis_host_port##*:}"
    [ "$redis_port" = "$redis_host" ] && redis_port=6379

    # Redis is NOT fatal. The queue falls back to running jobs inline, which is
    # slower and loses nothing; refusing to boot over a missing cache would
    # take the whole platform down for a degraded dependency.
    if nc -z "$redis_host" "$redis_port" 2>/dev/null; then
        log "Redis is reachable at ${redis_host}:${redis_port}."
    else
        log "WARNING: Redis at ${redis_host}:${redis_port} is unreachable."
        log "WARNING: queued work will run inline in the request process."
    fi
fi

# ── Branch on role ─────────────────────────────────────────────────────────
case "$ROLE" in
    worker)
        log "role=worker — skipping migrations (the api container owns them)."
        [ -f dist/worker.js ] || fail "dist/worker.js is missing from the image."
        log "starting the queue worker."
        exec node dist/worker.js
        ;;

    api | "")
        if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
            [ -x ./node_modules/.bin/prisma ] ||
                fail "the prisma CLI is missing from this image; cannot migrate."
            log "applying migrations (prisma migrate deploy) ..."
            # `migrate deploy` never resets and never generates a migration —
            # it applies what is already committed and fails on drift. It is
            # the only migration command that is safe against real data.
            # NOT `npx prisma` — see the note in the Dockerfile. npx would
            # reach the network from inside a container that may well have no
            # egress, and fetch a different major version if it did.
            ./node_modules/.bin/prisma migrate deploy ||
                fail "migrations failed; refusing to start."
            log "migrations applied."
        else
            log "RUN_MIGRATIONS=false — skipping migrations."
        fi

        [ -f dist/main.js ] || fail "dist/main.js is missing from the image."
        log "starting the API on port ${PORT:-5100}."
        exec node dist/main.js
        ;;

    *)
        fail "unknown ROLE '${ROLE}' (expected 'api' or 'worker')."
        ;;
esac
