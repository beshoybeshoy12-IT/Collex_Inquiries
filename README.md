# Collex Inquiries

A multi-tenant **Field Investigation / Field Verification Management System** — the
web platform for organisations that dispatch investigators to verify a customer's
home, workplace or business on behalf of a bank or leasing company, and return a
report.

The lifecycle it manages, end to end:

```
Case created (Excel import, API, or manually)
    → assigned to an investigator by a coordinator
    → accepted, travelled to, visited
    → dynamic form + photos + GPS captured in the field
    → submitted for quality control
    → approved or returned for rework
    → report generated (PDF, Arabic RTL)
    → delivered to the client
```

Arabic and English throughout, right-to-left and left-to-right, with the direction
genuinely flipping rather than text being swapped inside a fixed layout.

---

## Scope: web platform only

**The mobile application is not built and nothing here pretends it is.**

What *is* built is the API the mobile app will use, and it is real and tested —
investigator login, my-assignments, accept, transition, form draft and submit, media
upload, GPS — exercised end to end by the smoke test.

**There is no `/mobile` route prefix, on purpose.** A field investigator calls the
same `/api/v1/investigations/:id/transition` a coordinator does; `@AllowPrincipals`
declares which principal types a route accepts, and the service narrows what each may
see and do. A parallel mobile controller would be a second copy of the business rules
that drifts from the first — which is precisely what the brief's "do not create a
separate duplicated business logic layer for mobile" forbids. The one
investigator-specific route is `POST /api/v1/auth/investigator/login`, because
investigators are a separate table with their own credentials.

It exists now because retrofitting a second principal type into an auth system is a
rewrite; doing it up front cost a day rather than a quarter.

Two other places state their limits rather than fake them:

- **The live map has no tile provider.** A basemap means an account, an API key and
  a per-request bill with somebody's coordinates in it — a decision for whoever
  deploys this. Positions are plotted on a bounded projection of Egypt with staleness
  shown, and each pin links out to a real map. Swapping in Leaflet or MapLibre is one
  component; the data the screen already receives is what a tile map would consume.
- **Nothing here places a phone call or sends an SMS.** There is no notification
  channel beyond in-app and email.

---

## Getting started

### Requirements

- Node.js 22+
- Docker (for PostgreSQL 16 and Redis 7 — or bring your own)

### 1. Configuration

```bash
cp .env.example .env
```

Then fill in the values the file marks **REQUIRED**. Two of them have no default
and the process refuses to start without them:

| Variable | Generate with |
| --- | --- |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `JWT_REFRESH_SECRET` | same, and it must be a **different** value |

`SEED_ADMIN_PASSWORD` is required before the seed will run. There is no fallback
password anywhere in this codebase — a seeded admin with a known password is a
back door, not a convenience.

### 2. Install

```bash
npm run install-all
```

Three independent packages, no workspaces: `client/`, `server/`, and the root
(orchestration scripts only). Each has its own lockfile and installs separately.

### 3. Database

```bash
docker compose up -d postgres redis
npm run db:deploy
npm run db:seed
npm run db:platform-admin --prefix server
```

`db:deploy` runs `prisma migrate deploy`, which applies committed migrations and
fails on drift. It never resets and never invents a migration — it is the only
migration command that is safe against real data.

The seed creates a `DEMO` tenant: 81 permissions, 6 roles, 5 users, 5 investigators,
27 governorates, 7 products, 10 investigation types, 2 published form versions,
5 SLA/escalation rules and a handful of live cases. It is idempotent.

`db:platform-admin` is separate, and is the one step that is **not** development-only.
It creates the platform operator — the single account that can provision customer
companies at `/platform/tenants`. It reads `PLATFORM_ADMIN_EMAIL` and
`PLATFORM_ADMIN_PASSWORD`, invents neither, and is idempotent. See
[the platform operator](#the-platform-operator).

### 4. Run

```bash
npm run start:local
```

Starts three processes: the Vite dev server (**5174**), the API (**5100**) and the
queue worker. Sign in with the addresses the seed prints and the password you put in
`SEED_ADMIN_PASSWORD`.

API docs are at `http://localhost:5100/api/docs`.

### Or run the whole stack in Docker

```bash
npm start          # docker compose up --build -d
npm run logs
npm stop
```

nginx serves the built SPA on **8080** and proxies the API. Host ports throughout are
deliberately offset from the sibling Collex System V1 (5433 / 5000 / 80) so both can
run on one machine.

---

## Running it locally

```bash
npm run start:local
```

Builds the server once, then starts three processes: the Vite dev server (**5174**),
the API (**5100**) and the queue worker. On Windows there is also
`.start-local.ps1`, which does the same thing plus stops leftovers from a previous
run and checks PostgreSQL is up before starting; `-SkipBuild` skips the one-off build.

**One compiler, not two.** `nest start --watch` (the API) compiles the whole project
— `worker.ts` included — into `dist`, and the worker just runs `node --watch
dist/worker.js` against that output. Two `nest start --watch` processes sharing one
`dist` race each other, and with `deleteOutDir: true` one of them deletes the file
the other is executing. The symptom is a worker that dies seconds after a launch that
otherwise looks completely successful.

That is also why `nest-cli.json` sets `deleteOutDir: false` and `npm run build`
cleans `dist` itself: a one-off build still produces a clean tree, while a watch
rebuild never pulls the file out from under the running worker.

---

## Commands

Root:

| Command | Does |
| --- | --- |
| `npm run install-all` | installs root + client + server |
| `npm run start:local` | client + API + worker, concurrently |
| `npm start` / `npm stop` / `npm run logs` | the Docker stack |
| `npm test` | the server Jest suite |
| `npm run lint` | server then client |
| `npm run db:migrate` | `prisma migrate dev` — creates a migration |
| `npm run db:deploy` | `prisma migrate deploy` — applies them |
| `npm run db:seed` / `npm run db:studio` | seed, Prisma Studio |
| `npm run db:platform-admin --prefix server` | create/promote the platform operator |

Server (`cd server`):

```bash
npm run start:dev      # nest start --watch
npm run worker:dev     # the queue worker, watched
npm test               # jest; specs are colocated as src/**/*.spec.ts
npx jest src/prisma/tenant-guard.spec.ts     # one file
npx jest -t "cannot approve their own work"  # one test by name
npm run test:cov
```

Client (`cd client`): `npm run dev`, `npm run build`, `npm run lint`.

### Gotchas

- **Never `npx prisma`.** When the CLI is not resolvable locally, npx silently goes
  to the network and installs whatever is on the `latest` tag — currently an 8.0
  release candidate with a different command set, which fails as
  `No command registered for generate`. Every script here calls the local binary,
  and `prisma` is a **runtime** dependency because the container entrypoint runs
  `migrate deploy` at boot.
- **`db:push` runs `db:extensions` first.** The `Customer` and `Investigation`
  search columns carry `gin_trgm_ops` GIN indexes; `db push` skips migrations, so
  without `CREATE EXTENSION pg_trgm` it fails with
  `operator class "gin_trgm_ops" does not exist`. `migrate deploy` creates the
  extension itself.
- **`.npmrc` sets `legacy-peer-deps=true`** — required for installs to resolve.
- **`vite build` failing with "The service was stopped"** means the esbuild binary is
  not the binary npm installed. Check its size:
  `ls -l client/node_modules/@esbuild/*/esbuild.exe` — it must be ~10.6 MB.

  A **534,016-byte** file there is not a partial download. That is the payload size of
  `Virus:Win32/Grenam.VA!MSR`, a parasitic file infector that overwrites executables,
  and it was found live on the original development machine (running from
  `%APPDATA%Ground.exe`, re-adding itself to Startup, with Defender real-time
  protection switched off). Reinstalling the package makes the build work again for a
  few minutes and then it comes back, because the infector is still running.

  If you see that size, **do not just reinstall** — the machine needs cleaning first,
  and no binary built on it in the meantime should be trusted or shipped. On a healthy
  machine the same symptom really is a bad download, and
  `rm -rf client/node_modules/@esbuild && npm install --prefix client` fixes it for
  good.
- Tests need no database. Every spec is a pure unit test over exported functions or
  a `Test.createTestingModule` with mocked providers.
- The `DATABASE_URL` in `.env` is the **host** view (`localhost:5434`). Inside
  `docker compose` the API rebuilds it against the service name, because there
  `localhost` is the API container itself. Override with `DATABASE_URL_DOCKER`.

---

## Architecture

### Layout

```
client/    React 19 + Vite 6, JavaScript/JSX only — no TypeScript
server/    NestJS 11 + Prisma 6 + PostgreSQL 16
docker/    entrypoint.sh, nginx config
docs/      the documents listed at the bottom of this file
```

The client is **JavaScript and JSX by deliberate constraint**. There is no
`tsconfig.json`, no `.ts` and no `.tsx` under `client/`.

### The request path

```
browser → /api/v1/… → nginx (or the Vite proxy) → Nest
```

nginx forwards `/api/` **without stripping a prefix**. The API is globally prefixed
`api` and URI-versioned `v1`, so `@Controller('investigations')` is reachable at
`/api/v1/investigations`. This is the opposite of the sibling Collex system, whose
nginx strips `/api/`; copying that strip across turns every route into a 404.

`/health` and `/readiness` are `VERSION_NEUTRAL` — a load balancer should not have to
know the API's version to ask whether it is alive.

Every successful reply is `{ success, data, timestamp }`, or
`{ success, data, meta, timestamp }` when paginated. Errors are
`{ success: false, statusCode, message, timestamp }` plus any structured detail the
thrower attached (`problems`, `reasons`, `tenants`) — the exception filter forwards
those instead of flattening them, because an import error the client cannot render
per-cell is a report the user cannot act on.

### Multi-tenancy — enforced in one place

Every tenant-scoped table carries a column named exactly `tenantId`. A **Prisma
client extension** (`server/src/prisma/tenant-guard.ts`) intercepts every operation
and merges the current tenant into the `where` and the `data`.

The list of scoped models is derived from `Prisma.dmmf` at startup by looking for
that column — **not** hand-maintained. A new tenant-scoped table is protected the
moment it is migrated, and a table that should have been scoped and was not is a
schema review question rather than an invisible leak.

Three properties are load-bearing, and each has tests:

1. **A tenant-scoped query with no context throws.** Not "returns everything" —
   throws `MissingTenantContextError`. A forgotten context is a loud 500, never a
   silent cross-tenant read.
2. **A `tenantId` supplied by the client is ignored and logged.** The tenant comes
   from the authenticated principal, always.
3. **Crossing tenants is explicit.** `runAsSystem()` is the only way, it is used by
   login (which must find a user before it knows their tenant) and the seed, and it
   is greppable.

`AsyncLocalStorage` carries the context, established in **middleware** rather than an
interceptor so it is in place before guards run.

> **Prisma promises are lazy.** `runAsSystem` and `runAsTenant` are `async` and
> `await` inside `storage.run(...)` for that reason. A synchronous wrapper returns an
> unexecuted promise, the ALS scope closes, and the query then runs with no context
> at all. This cost half a day to find; do not "simplify" it back.

Cross-tenant reads return **404, not 403** — a 403 confirms the row exists.

### Authentication

Two principal types, one token machinery: `WEB_USER` and `INVESTIGATOR`, in separate
tables. `@AllowPrincipals(...)` marks which a route accepts.

- Access token: JWT, 15 minutes.
- Refresh token: **opaque, random, stored only as a SHA-256 hash**, rotated on every
  use. A refresh token is a bearer credential for a month; storing it in a form the
  database can hand back is the thing that turns a read-only SQL injection into a
  full account takeover.
- **Reuse detection.** Presenting an already-rotated refresh token kills the entire
  session family, on the assumption the token was stolen. The legitimate user is
  signed out and has to log in again — which is the correct outcome, because the
  alternative is the attacker keeping a valid session indefinitely.

Login does not distinguish "no such account" from "wrong password", and takes the
same time either way.

### Authorization

Three tables, no hard-coded roles:

- `Permission` — a global catalogue of codes (`investigation.assign`, `qc.approve`, …).
- `Role` → `RolePermission` — **per tenant**. Every tenant can define its own roles;
  none of them are compiled in.
- `UserPermissionOverride` — per user, grant *or* deny. **Deny always beats grant.**

`PermissionsGuard` enforces it server-side. Two rules in it are easy to break:

- It **re-checks `@Public()`**. Global guards do not short-circuit one another, so a
  public route still reaches this guard. (My own comment once claimed otherwise; the
  tests now pin it.)
- A **non-web principal that passed `@AllowPrincipals` returns true.** Investigators
  hold no permission rows at all; their access is bounded by service-level scoping
  ("your own cases"), which is the actual contract. Without this, every shared route
  403s the entire mobile API.

Frontend permission checks hide buttons. They are a convenience and never a control.

### The platform operator

One account sits outside all of the above: `User.isSuperAdmin`.

It is **not a permission**, and the difference is the whole design. A permission is a
row somebody can grant, and granting a company administrator every permission in the
catalogue is the normal configuration — the seeded `COMPANY_ADMIN` role holds all 81.
If "create a company", "raise a plan limit" or "suspend a tenant" were permissions,
that administrator would hold them too.

So `TenantsController` gates those routes on the column, in code, and the column has
**no write path**: no DTO exposes it, no service sets it. It is granted by
`server/prisma/seed-platform-admin.ts`, which needs access to the database.

| | Company administrator | Platform operator |
| --- | --- | --- |
| `GET /tenants/me`, `PATCH /tenants/me` | ✔ own company | ✔ |
| `GET /tenants` (every company) | ✖ 403 | ✔ |
| `POST /tenants` (provision) | ✖ 403 | ✔ |
| `PATCH /tenants/:id/status` | ✖ 403 | ✔ |
| `PATCH /tenants/:id/limits` | ✖ 403 | ✔ |

The operator lives in a tenant of its own (`PLATFORM` by default) so that deleting the
demo tenant — which `docs/deployment.md` tells you to do before real users arrive —
cannot cascade away the only account able to create replacements.

The console is `/platform/tenants`. Provisioning writes the company, its default roles
and its first administrator in **one transaction**, and returns that administrator's
generated password exactly once; only the hash is stored.

`tenants.controller.spec.ts` pins the part that matters: a principal holding every
permission in the catalogue is still refused.

### Case status

The state machine is a **data table**, not a `switch`: `case-status.machine.ts`
declares, per transition, which actor may perform it, which timestamp it stamps and
whether a reason is mandatory. Adding a status is a table row plus a translation key.

37 tests pin the rules that are business decisions rather than mechanics — among them
*an investigator cannot approve their own work* and *a coordinator cannot check in at
an address*.

### SLA and TAT — derived, never stored

`SlaState` is computed on read from the case's timestamps and its policy. A stored
state is a value something has to recompute, and the moment that something misses a
run the badge disagrees with the dates printed next to it.

Business-hours arithmetic is real: with `businessHoursOnly`, the clock runs only
during the configured workday on configured workdays. A case raised at 4pm Thursday
with an 8-hour SLA is **not** breached by Sunday morning. The suite is written against
a Sunday–Thursday week precisely because a Monday–Friday assumption is the bug most
likely to survive review.

A finished case settles to `MET` or `BREACHED` and never wears a live colour again —
`RED` means "act now", and a case closed last month cannot be acted on.

### Escalation

Zero thresholds in code. `EscalationRule` rows carry the trigger, the threshold, the
audience and the channel; the sweep reads them. Duplicate escalations are prevented by
a **unique constraint** on `EscalationEvent`, not by a check-then-insert — two workers
sweeping at the same second would both pass the check.

### Excel import

Validate-first, stage-then-confirm:

```
inspect → prepare (stage + validate every row) → preview → confirm
```

Nothing is written until the operator confirms. Headers auto-map through a bilingual
alias catalogue (`Full Name`, `اسم العميل`, `Customer Name | اسم العميل`, …), so a file
from a new bank usually means adding aliases, not parsing code.

The error/warning split is a product decision, and the tests say so in words: a
missing customer name is an **error** (the case would be unusable); a national id that
is not fourteen digits is a **warning** (usually a transcription slip, and refusing
the row would stop a real investigation over one digit). Getting this line wrong in
either direction is what makes an import tool hated.

Cells beginning `=`, `+`, `-` or `@` are prefixed with `'` before storage. A customer
name of `=cmd|'/c calc'!A1` is code execution on the machine of whoever opens the
export.

### Forms

Templates hold **immutable published versions**. A case pins the `formVersionId` it
was created under, so editing a form never changes what an already-submitted case was
asked — which is the difference between an audit trail and a rewrite of history.

### Queue and workers

BullMQ over Redis, with an **honest inline fallback**: without Redis, jobs run in the
request process. Slower, correct, and it says so at boot rather than accepting work it
will never do.

The worker is a separate entrypoint (`dist/worker.js`) from the same image. One image
means the halves cannot drift; two processes mean a 40-second PDF render never blocks
a request.

Redis runs with **`maxmemory-policy noeviction`**. BullMQ warns about anything else
and is right to: under an LRU policy Redis may drop a job hash while the job is
queued, and the visible failure is an export stuck in `PENDING` forever with nothing
left to retry it.

### PDF reports

Puppeteer renders a Handlebars template. **A browser, not a PDF library** — Arabic
requires HarfBuzz shaping to join letterforms, and the common Node PDF libraries emit
disconnected Arabic glyphs. The failure is invisible to anyone who cannot read Arabic
and obvious to everyone who can, so the runtime image installs `font-noto-arabic`
explicitly.

### Storage

An interface with an S3-compatible driver (`storage/`). AWS S3, Cloudflare R2 and
MinIO all work through it. Uploads and downloads are **presigned** — file bytes never
pass through the API — and every key is prefixed `t/<tenantId>/`, so a bucket listing
is still tenant-partitioned.

### Realtime

Socket.IO on `/realtime`, rooms per tenant and per user. It sends **signals, not
data**: "case 123 changed", and the client refetches over REST. A payload pushed down
a socket bypasses the permission checks the REST layer applies, and the socket layer
would have to re-implement them correctly forever.

### Frontend

```
client/src/modules/<domain>/<Screen>.jsx
client/src/components/     shared UI
client/src/services/api.js the single axios instance — always import this
client/src/i18n/           translations and direction
```

- **Server state is TanStack Query.** Not Redux; a cache with invalidation is what
  this application actually needs.
- **Direction genuinely flips.** `applyDirection()` sets `<html dir>` and dynamically
  imports `bootstrap.rtl.min.css` or `bootstrap.min.css`. Application CSS uses logical
  properties (`margin-inline-start`, `inset-inline-end`) throughout, so there is one
  stylesheet rather than two that drift.
- **Business codes are language-independent.** Every catalogue row has a `code` plus
  `nameAr`/`nameEn`. Nothing keys off a display name.
- **Routes are code-split** through `React.lazy`. `chart.js` is dynamically imported
  at the point of use and is not on the critical path — a static import puts 184 kB
  back on every page load.
- Token refresh is **single-flight**: five parallel 401s trigger one refresh, and the
  losers await the same promise. Without it, four of the five rotate a token that has
  already been rotated and trip the reuse detector, logging the user out.

---

## Testing

```bash
npm test        # 288 tests, 9 suites
```

| Suite | What it pins |
| --- | --- |
| `prisma/tenant-guard.spec.ts` | isolation, against the real DMMF |
| `investigations/case-status.machine.spec.ts` | who may move a case where |
| `common/guards/permissions.guard.spec.ts` | `@Public()`, and investigators on shared routes |
| `investigations/sla.util.spec.ts` | business-hours arithmetic, weekends, settled states |
| `imports/utils/row-validator.spec.ts` | the error/warning line, dd/mm/yyyy, formula injection |
| `assignments/auto-assign.engine.spec.ts` | eligibility beats score; nobody is filtered out |
| `common/utils/phone.util.spec.ts` | duplicate detection across four written forms |
| `common/interceptors/idempotency.interceptor.spec.ts` | what a retry replays, and what it must not |
| `health/health.controller.spec.ts` | readiness reports honestly; only the database gates it |

Beyond the unit suite, `docs/smoke-test.md` describes an end-to-end pass against a
running stack that covers refresh rotation and reuse detection, tenant isolation
returning 404, permission enforcement, the mobile API, imports and throttling.

---

## Security notes

- No secret is hard-coded and none is committed. `.env` is gitignored; `.env.example`
  carries names and generation commands only.
- `tenantId` from a client is ignored. Always.
- Permissions are enforced server-side. The UI hides buttons as a convenience.
- Refresh tokens are stored hashed and rotate on use; reuse kills the family.
- Presigned URLs are short-lived and tenant-prefixed.
- Uploads are validated by magic bytes, not by the client's `Content-Type`.
- Rate limits: global, with a much stricter limit on login.
- `AuditLog` is append-only and records actor, tenant, entity, action and diff.

---

## Documents

| File | Contents |
| --- | --- |
| `docs/architecture.md` | the decisions above in depth, with the reasoning |
| `docs/api.md` | endpoint reference; Swagger at `/api/docs` is authoritative |
| `docs/deployment.md` | production checklist, CSP, scaling, backups |
| `docs/mobile-api.md` | the contract the mobile app will consume |
| `docs/smoke-test.md` | the end-to-end pass and what it covers |
| `CLAUDE.md` | orientation for AI assistants working in this repo |
