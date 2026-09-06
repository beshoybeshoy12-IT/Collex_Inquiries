# Deployment

What has to be true before this system holds real customer data — national ids, home
addresses, photographs of people's houses. Everything on the checklist is there
because getting it wrong has a consequence named next to it.

---

## 1. Secrets

Generate each of these fresh. Never reuse a value between environments, and never
commit one.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

| Variable | Notes |
| --- | --- |
| `JWT_SECRET` | signs access tokens |
| `JWT_REFRESH_SECRET` | **must differ from `JWT_SECRET`** |
| `POSTGRES_PASSWORD` | |
| `S3_SECRET_ACCESS_KEY` | from the object-store provider |
| `SEED_ADMIN_PASSWORD` | only needed when seeding; unset it afterwards |
| `PLATFORM_ADMIN_PASSWORD` | the platform operator; unset it after the first sign-in |

The API refuses to boot without `DATABASE_URL`, `JWT_SECRET` and
`JWT_REFRESH_SECRET`. That is deliberate: a system that starts with a default signing
key is a system where every token is forgeable, and it will start quietly.

**Rotating `JWT_SECRET` invalidates every access token immediately.** Refresh tokens
survive (they are opaque and stored hashed, not signed), so users get a new access
token on their next refresh rather than being logged out. Rotating
`JWT_REFRESH_SECRET` does log everybody out.

## 2. Database

```bash
npm run db:deploy                          # prisma migrate deploy
npm run db:platform-admin --prefix server  # the platform operator
```

**The second command is not optional and is not development-only.** Without it no
account has `isSuperAdmin`, so `POST /tenants` is unreachable and there is no way to
create the first customer company — the API answers 403 to everybody, correctly and
unhelpfully. It is idempotent, it invents no password, and it puts the operator in its
own `PLATFORM` tenant so that removing the demo tenant below cannot cascade it away.

Never `migrate dev`, `db push` or `migrate reset` against production. `migrate deploy`
applies committed migrations and fails on drift; the other three will rewrite or drop
data to reach the schema they want.

- Give the application role no more than `SELECT, INSERT, UPDATE, DELETE` on the
  application schema. It does not need `DROP`.
- `max_connections` must exceed `DB_CONNECTION_LIMIT × replicas` with headroom for
  the migration job and your own psql session.
- Set up point-in-time recovery, and **restore from a backup once before you need
  to**. An untested backup is a hypothesis.

## 3. Storage

Set `STORAGE_DRIVER=s3` and the `S3_*` block. AWS S3, Cloudflare R2 and MinIO all
work through the same driver.

- **The bucket must not be public.** Every object is reached through a presigned URL;
  a public bucket makes `t/<tenantId>/…` a guessable path to another tenant's
  photographs.
- Block public ACLs at the bucket level, not just in the application.
- Enable server-side encryption and versioning.
- Set a lifecycle rule for `exports/` matching `EXPORT_RETENTION_DAYS`.
- `S3_PRESIGN_TTL` defaults to 900s. Longer means a leaked URL stays live longer;
  shorter breaks large uploads on slow connections.

## 4. Redis

```
maxmemory-policy noeviction
```

Not optional. Under any `allkeys-*` policy Redis may drop a BullMQ job hash while the
job is queued; the visible symptom is an export or report stuck in `PENDING` forever
with nothing left to retry it, and no error anywhere. `compose.yml` sets this; a
managed Redis needs it set in the provider's console.

Persistence is off on purpose — a lost queue is recoverable from the database rows
that triggered the jobs. Requeue on boot rather than trusting an AOF.

## 5. TLS and the proxy

Terminate TLS at the load balancer or in front of nginx. Then:

- `TRUST_PROXY` = the number of proxy hops. **Too high is a security bug**: the client
  IP used for rate limiting and audit comes from `X-Forwarded-For`, and trusting more
  hops than exist lets a caller spoof it and bypass the login throttle.
- `CORS_ORIGINS` = the exact web origins, comma-separated. No wildcard.
- HSTS at the TLS terminator.

### Content-Security-Policy

`docker/nginx/default.conf` deliberately sets **no CSP**, because a meaningful policy
has to name your storage and realtime origins and a permissive placeholder reads as
protection that is not there. Add this once those are known:

```nginx
add_header Content-Security-Policy "\
default-src 'self'; \
script-src 'self'; \
style-src 'self' 'unsafe-inline'; \
img-src 'self' data: blob: https://<your-storage-host>; \
font-src 'self' data:; \
connect-src 'self' https://<your-storage-host> wss://<your-api-host>; \
frame-ancestors 'none'; \
base-uri 'self'; \
form-action 'self'" always;
```

`style-src 'unsafe-inline'` is required by Bootstrap. `connect-src` must include the
storage host (presigned uploads go direct from the browser) and the WebSocket origin.
Deploy it in `Content-Security-Policy-Report-Only` first and read the reports — a CSP
that blocks your own uploads is discovered by users, not by tests.

## 6. Scaling

The API is stateless and scales horizontally. Two things to know:

- **Socket.IO needs a Redis adapter above one replica**, or a client connected to
  replica A never receives an event emitted from replica B. The symptom is a
  notification bell that works for some users and not others, which reads as flaky
  rather than as misconfigured.
- **Only one process may migrate.** `docker/entrypoint.sh` runs `migrate deploy` only
  when `ROLE` is not `worker`, and `compose.yml` makes the worker wait for a healthy
  API. On Kubernetes, use an init container or a Job — not every replica.

Workers scale independently, and should: PDF rendering is the CPU-heavy path, and each
Puppeteer instance wants ~1 CPU and ~512 MB.

## 7. Health checks

| Path | Use for |
| --- | --- |
| `/health` | liveness — is the process alive |
| `/readiness` | readiness — database and queue reachable |

Both are `VERSION_NEUTRAL`; a load balancer should not need to know the API version.

Point liveness at `/health` and readiness at `/readiness`. Pointing liveness at
`/readiness` means a brief database blip restarts every container, turning a recovery
into an outage.

**`/readiness` returns 200 with `checks.queue.ok: false` when Redis is down.** That is
deliberate, not a bug: a dead queue degrades report generation and does not stop the
API serving cases, so the instance stays in rotation. Only the database gates the
status code. **This means you must alert on the body, not the status code** — a queue
that has been unreachable for an hour will never show up as a failing probe.

## 8. Observability

`LOG_LEVEL=info` in production. Logs are JSON on stdout.

Alert on: `/readiness` failing **or returning `checks.queue.ok: false`** (see above —
a dead queue does not fail the probe), queue depth growing monotonically, 5xx rate, login
throttle rejections spiking (credential stuffing), `TENANT_CONTEXT_MISSING` at any
rate at all (it means a code path is missing its context wrapper), and — the one that
matters commercially — SLA breach count by tenant.

## 9. Retention

| Variable | Default | Covers |
| --- | --- | --- |
| `NOTIFICATION_RETENTION_DAYS` | 90 | in-app notifications |
| `AUDIT_RETENTION_DAYS` | 730 | audit log |
| `EXPORT_RETENTION_DAYS` | 7 | generated files |

Check the audit window against the contract with your clients and against local law
before lowering it. Media assets are **not** swept: a photograph is evidence for a
report a bank may re-examine years later, and deleting it on a timer is a decision for
whoever owns that relationship, not a default.

## 10. Before you open it to users

- [ ] Every secret generated fresh, none committed
- [ ] `SEED_ADMIN_PASSWORD` unset after seeding, and the seeded admin's password
      changed on first login
- [ ] Platform operator created (`db:platform-admin`), signed in once, and
      `PLATFORM_ADMIN_PASSWORD` unset afterwards
- [ ] Exactly the operator accounts you meant to have: `SELECT email FROM users WHERE
      "isSuperAdmin"` — each one can read and re-price every customer
- [ ] Demo tenant and demo users removed, or the seed never run in this environment
- [ ] TLS in front, HSTS on, `TRUST_PROXY` matching the real hop count
- [ ] `CORS_ORIGINS` exact
- [ ] Bucket private, encrypted, versioned
- [ ] Redis `noeviction`
- [ ] Backups running **and a restore tested**
- [ ] CSP deployed report-only, reports read, then enforced
- [ ] Alerts wired
- [ ] Rate limits reviewed against your real traffic
- [ ] A pass through the audit log confirming actor, tenant and diff look right

## Upgrading

1. Back up, and confirm the backup restores.
2. Deploy the new image with `RUN_MIGRATIONS=false` on every replica but one.
3. Let the migrating instance apply and become healthy.
4. Roll the rest.

Migrations here are additive by convention. A destructive migration (dropping a
column, narrowing a type) needs a two-deploy dance: stop writing the column, deploy,
then drop it.
