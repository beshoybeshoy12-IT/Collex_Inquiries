# Running a database locally

Three ways, in the order most people should try them.

---

## 1. Docker (the default)

```bash
docker compose up -d postgres redis
npm run db:deploy
npm run db:seed
```

PostgreSQL on **5434**, Redis on **6381**, both bound to loopback and both offset from
the sibling Collex System V1 so the two products can run at once.

---

## 2. Your own PostgreSQL

Point `DATABASE_URL` at it and run the same two commands. The schema needs the
`pg_trgm` extension; `migrate deploy` creates it, so nothing extra is required.

Redis is optional. Without it the queue runs jobs inline and `/readiness` says so:

```json
{ "queue": { "ok": true, "detail": "inline (no Redis configured)" } }
```

That is a real fallback, not a stub — imports, exports and PDF rendering all work,
they just occupy the request process instead of a worker.

---

## 3. A throwaway cluster of your own (when Docker is unavailable)

Docker Desktop can be broken, on a locked-down machine, or simply not worth 8 GB. If
PostgreSQL is installed but its server belongs to something else, `initdb` will build
a second, completely separate cluster that shares nothing with it — different data
directory, different port, its own superuser.

```bash
# 1. A password, and a cluster to put it in.
node -e "process.stdout.write(require('crypto').randomBytes(18).toString('base64url'))" > /tmp/pgpw

"/c/Program Files/PostgreSQL/18/bin/initdb.exe" \
  -D .devdb/data -U collex --pwfile=/tmp/pgpw -E UTF8 --locale=C

# 2. Loopback only, on a port nothing else uses.
cat >> .devdb/data/postgresql.conf <<'CONF'
listen_addresses = 'localhost'
port = 5435
CONF

# 3. Start it.
"/c/Program Files/PostgreSQL/18/bin/pg_ctl.exe" -D .devdb/data -l .devdb/postgres.log start

# 4. Create the database.
PGPASSWORD=$(cat /tmp/pgpw) "/c/Program Files/PostgreSQL/18/bin/psql.exe" \
  -h localhost -p 5435 -U collex -d postgres \
  -c "CREATE DATABASE collex_inquiries OWNER collex;"
```

Then point the tooling at it. `dotenv` does **not** override variables already in the
environment, so exporting the URL wins over `.env` without editing it:

```bash
export DATABASE_URL="postgresql://collex:$(cat /tmp/pgpw)@localhost:5435/collex_inquiries?schema=public"
npm run db:deploy
npm run db:seed
node dist/main.js
```

Stopping it, and removing it entirely:

```bash
"/c/Program Files/PostgreSQL/18/bin/pg_ctl.exe" -D .devdb/data stop
rm -rf .devdb
```

`.devdb/` is gitignored. It holds a real data directory — never commit it, and never
point anything but development at it.

### The port matters

`5432` is almost always a PostgreSQL that belongs to something else. `5434` is this
project's compose cluster. **5435** is chosen to collide with neither, so a throwaway
cluster can coexist with both and be deleted without a thought.

### PostgreSQL version

The project targets **PostgreSQL 16** and the compose file pins `postgres:16-alpine`.
A local 17 or 18 cluster runs the schema fine — nothing here uses a version-specific
feature beyond `pg_trgm` — but it is not what production runs, so treat a difference
in behaviour as a reason to check against 16 before concluding anything.

---

## Resetting

```bash
npm run db:deploy      # applies anything new; safe against data
npm run db:seed        # idempotent; safe to re-run
```

To start completely clean, drop and recreate the database and re-run both. Do **not**
reach for `prisma migrate reset` out of habit — it is fine against a scratch cluster
and catastrophic against anything else, and the difference is one shell variable.
