# End-to-end verification

What has actually been run against a live stack, and what has not. Everything marked
✅ was observed; nothing here is inferred from reading the code.

---

## Unit suite

```bash
cd server && npm test
```

**323 tests, 11 suites, all passing.** No database required — every spec is pure or
fully mocked.

| Suite | Tests | Pins |
| --- | --- | --- |
| `prisma/tenant-guard.spec.ts` | 23 | isolation, derived from the real DMMF |
| `investigations/case-status.machine.spec.ts` | 37 | who may move a case where |
| `common/guards/permissions.guard.spec.ts` | 13 | `@Public()`; investigators on shared routes |
| `investigations/sla.util.spec.ts` | 49 | business hours, weekends, settled states |
| `imports/utils/row-validator.spec.ts` | 67 | the error/warning line, dd/mm/yyyy, formula injection |
| `assignments/auto-assign.engine.spec.ts` | 37 | eligibility beats score; nobody is filtered out |
| `common/utils/phone.util.spec.ts` | 33 | duplicate detection across four written forms |
| `common/interceptors/idempotency.interceptor.spec.ts` | 21 | what is replayed, and what is not |
| `health/health.controller.spec.ts` | 8 | readiness tells the truth, and what gates it |

Three of these are worth calling out because they encode a decision rather than a
mechanism, and a future change should have to argue with the comment:

- *an investigator cannot approve their own work*
- *a coordinator cannot check in at an address*
- *a thirteen-digit national id warns; a missing customer name blocks*

---

## API, against a live database

Run with a seeded `DEMO` tenant.

### Boot and health ✅

```
GET /health     → {"success":true,"data":{"status":"ok",…}}
GET /readiness  → {"success":true,"data":{"status":"ready",
                    "checks":{"database":{"ok":true},
                              "queue":{"ok":true,"detail":"inline (no Redis configured)"}}}}
```

Both are `VERSION_NEUTRAL` — reachable without `/api/v1`.

**The queue fallback was verified by running without Redis**, and `/readiness` names
it rather than reporting a healthy queue that is not there.

### Migrations and seed ✅

`prisma migrate deploy` applied `20260905130802_init` to an empty PostgreSQL cluster
with no manual extension step — the migration creates `pg_trgm` itself. The seed then
produced: 81 permissions, 6 roles, 5 web users, 5 investigators, 10 investigation
types, 7 products, 10 media categories, 8 QC reasons, 2 SLA policies, 5 escalation
rules, 2 published form versions, 5 customers with cases, 1 mapping template.

**Without `SEED_ADMIN_PASSWORD` the seed refuses to create the tenant** and exits 1 —
verified by omitting it. It still writes the global catalogue (permissions, geography)
first, which is tenant-independent and carries no credential; what it will not do is
invent a password for an administrator account. The message says so:

> `SEED_ADMIN_PASSWORD is not set. The seeder will not invent one — a default admin
> password that ships in a repository is how systems get lost.`

### Idempotency ✅

Both properties were exercised against the running API:

| Scenario | Result |
| --- | --- |
| Same key, sequential retry | 201 + `Idempotent-Replay: true`, **same** comment id, no second row |
| Same key, 3 requests fired concurrently | all 3 returned the **same** comment id; `SELECT count(*)` = **1** |

The concurrent case is the one that matters, and it is why the key is claimed *before*
the handler runs rather than recorded after it. A record-after design passes the first
row of that table and fails the second.

### A bug this verification found ✅

Running the API with Redis switched off, `/readiness` said:

```json
{ "queue": { "ok": true, "detail": "redis" } }
```

Nothing was listening on the Redis port. The check was asking
`QueueService.isInline` — whether Redis had been **configured** — and a
configured-but-unreachable ioredis client is still a non-null object, so the
answer was always "healthy". An orchestrator would have kept routing traffic to
an instance whose jobs were going nowhere, and no probe would have said so.

This is not something a code read finds; `isInline` reads perfectly sensibly at
the call site. It took running the thing with a dependency switched off.

**Fixed** by adding `QueueService.ping()` — a real `PING` raced against a 2s
timeout, because ioredis queues commands while reconnecting and an unbounded
wait would hang the probe rather than fail it, which an orchestrator reads as
healthy-but-slow. Verified after the fix, with Redis still down:

```json
{ "status": "ready",
  "checks": { "database": { "ok": true },
              "queue": { "ok": false, "detail": "redis unreachable: timeout" } } }
```
→ HTTP **200**

Both halves matter and they pull against each other: the queue check now tells
the truth, **and** a dead queue still does not take the instance out of
rotation — reports degrade, cases keep being served. `ready` is therefore
derived from the database check alone rather than from "every check passed",
which is precisely how the original bug survived: satisfying the second rule
that way made the first impossible. `health.controller.spec.ts` pins both.

### Principal boundaries ✅

Checked directly against the running API with a real investigator token
(`identifier: INV-001`, `tenantCode: DEMO`):

| Request | Expected | Got |
| --- | --- | --- |
| `GET /assignments/my` with an investigator token | 200 | **200** |
| `GET /users` with an investigator token | 403 | **403** |
| `GET /dashboard` with an investigator token | 403 | **403** |
| `GET /assignments/my` with no token | 401 | **401** |

This is the check that matters for the `PermissionsGuard` rule that lets a non-web
principal through when it has passed `@AllowPrincipals`. The rule is necessary — without
it every shared route 403s the mobile API — and the risk is that it over-grants. It does
not: an office route carries no `@AllowPrincipals(INVESTIGATOR)`, so the investigator
never reaches the permission check at all.

A login body using `employeeCode`/`companyCode` instead of `identifier`/`tenantCode`
returns **400**, not a login failure — `forbidNonWhitelisted` is on. Both API documents
were corrected against the real DTO after this was observed.

### Permissions, on one route, by role ✅

The same URL answering differently by caller is the whole RBAC claim, so it was
checked rather than asserted:

| Route | Caller | Expected | Got |
| --- | --- | --- | --- |
| `GET /qc/queue` | `qc@demo.local` | 200 | **200** |
| `GET /qc/queue` | `coordinator@demo.local` | 403 — lacks `QC_VIEW` | **403** |
| `GET /assignments/my` | `coordinator@demo.local` | 403 — an investigator route | **403** |
| `GET /assignments/workload` | `coordinator@demo.local` | 200 | **200** |

Both directions matter. A permission layer that only ever denies is
indistinguishable from a broken route, and one that only ever allows is not a
permission layer.

Note that `GET /assignments` itself is a **404 by design** — there is no root
listing. Assignments are reached through `/my`, `/suggest`, `/workload` or
`/investigation/:id`.

### Tenant provisioning and the platform gate ✅

The console at `/platform/tenants` was driven in a real browser, and the whole
lifecycle of a company was walked through end to end.

| Step | Expected | Got |
| --- | --- | --- |
| `db:platform-admin`, then re-run | creates once, then promotes without touching the password | **as expected** |
| Operator signs in | `isSuperAdmin: true`, no role, all 81 permissions resolved | **as expected** |
| Provision `NILEBANK` from the console | company + 6 system roles + first administrator, one transaction | **6 roles: COMPANY_ADMIN, SUPERVISOR, COORDINATOR, QC_OFFICER, REPORT_USER, CLIENT_USER** |
| New administrator signs in with the shown password | 200, `COMPANY_ADMIN`, own tenant | **200** |
| New administrator lists cases | 0 — not the demo tenant's 5 | **0** |
| Change plan limits from the console | 200, list refreshes | **200** |
| Suspend from the console | list shows it, sessions end | see below |
| Reactivate | back to `ACTIVE` | **as expected** |

**The gate, checked in the direction that matters.** The refusals below are not from an
account that lacks permissions — `admin@demo.local` and `admin@nilebank.test` each hold
**all 81 permissions in the catalogue**, which is what a company administrator normally
holds. That is precisely the caller a permission-based gate would let through:

| Route | Caller | Expected | Got |
| --- | --- | --- | --- |
| `GET /tenants` | operator | 200 | **200 — 3 companies** |
| `GET /tenants` | company admin, all 81 permissions | 403 | **403** |
| `POST /tenants` | company admin, all 81 permissions | 403 | **403** |
| `PATCH /tenants/:id/limits` | company admin, all 81 permissions | 403 | **403** |
| `GET /tenants/me` | company admin | 200 — their own company | **200** |

**Suspension really ends sessions**, rather than waiting out the 15-minute access
token:

| After suspending `NILEBANK` | Got |
| --- | --- |
| that admin's existing token on `GET /auth/me` | **401 `تم إنهاء الجلسة - Session was ended`** |
| a fresh login with correct credentials | **403 `تم إيقاف حساب الشركة - Company account is suspended`** |

Every step landed in the audit log at `CRITICAL`, with the Arabic reason typed into the
dialog preserved: `TENANT_CREATED`, `TENANT_LIMITS_CHANGED`, `TENANT_STATUS_CHANGED` ×2.

**The UI gate matches the API gate.** Signed in as the new company administrator, the
"المنصة" section is absent from the sidebar, and navigating straight to
`/platform/tenants` renders the refusal state, not the console.

Measured in the browser rather than eyeballed: in both languages the table fits without
a horizontal scrollbar, the body does not scroll sideways, and exactly one Bootstrap
build is live — `bootstrap.rtl.min.css` with `dir="rtl"`, `bootstrap.min.css` with
`dir="ltr"`.

### Earlier full pass

An earlier run of the complete scripted pass — **78 assertions, 0 failures** — covered:

- login, refresh **rotation**, and **reuse detection killing the session family**
- catalogue reads, duplicate customer detection
- case creation, **illegal transitions refused with 409**
- **a client-supplied `tenantId` rejected**
- assignment, reassignment, history
- investigator login and the field routes; GPS; form submission validation
- **tenant isolation returning 404 rather than 403**
- permission enforcement, dashboard, imports, audit, timeline, Customer 360
- logout; login throttling; **no account enumeration**

---

## Web client, in a real browser

Signed in as `coordinator@demo.local` against the live API.

### Rendering and data ✅

| Screen | Observed |
| --- | --- |
| Login | Arabic RTL, language toggle present |
| Dashboard | KPI cards, daily-volume chart, status breakdown, all from seeded rows |
| Investigations list | 5 seeded cases; filters; status, priority and investigator columns |
| Case detail | tabs Overview/Customer/Investigation/Photos/GPS/Timeline/QC/Report/Audit |
| Timeline | real status history with actor and timestamps |
| Import wizard | 4-step flow, dropzone, template download |
| SLA settings | 2 policies and 5 escalation rules, **every threshold from the database** |
| NotFound | renders correctly for an unknown route |
| Live map | 4/4 investigators plotted; renders at 427px (mobile) as well as desktop |
| Assign modal | the ranking engine, live — see below |

**No console errors on any screen. Every `/api/v1/*` request returned 200.**

### Two things the screenshots prove that a code read cannot

**SLA is derived, not stored.** The case header showed `On track 23h`, and the
turnaround row showed `1h` to assignment, `30m` to acceptance, and `—` for field work
and QC review — the stages that had not happened. A stored state would have needed a
sweep to produce that, and an unfinished stage rendered as `0` rather than `—` is the
bug the null-per-stage rule exists to prevent.

**The ranking engine is real, and it shows its reasoning.** Opening the assign modal
on an unassigned case returned four candidates ordered by score — 68.7, 62.9, 60.4,
57.9 — each with its coverage note and open-case count, under the heading "ranked by
coverage, qualifications, load and quality. **The decision is yours.**"

One candidate carried **"Outside coverage area"** in red and stayed *in the list*
rather than being filtered out. That is the property `auto-assign.engine.spec.ts`
spends most of its assertions on: "why isn't Ahmed on this list?" is a question a
coordinator will ask, and a filtered list cannot answer it.

**Direction genuinely flips.** Measured on the same case-detail screen:

| | `dir` | `lang` | sidebar x-range (1280px viewport) |
| --- | --- | --- | --- |
| Arabic | `rtl` | `ar` | **1005 → 1265** (right) |
| English | `ltr` | `en` | **0 → 260** (left) |

The sidebar physically moves. Tabs reverse, panels swap sides, the back arrow turns
round. This is the claim most easily faked by translating strings inside a fixed
layout, so it is measured rather than eyeballed.

### Production build ✅

```
26 route chunks; chart.js in its own chunk and NOT on the critical path
```

---

## What has not been verified end to end

Stated rather than glossed:

- **PDF report generation** has not been run against a real Chromium in this
  environment. The template, the queue job and the Handlebars rendering exist; the
  Arabic shaping depends on `font-noto-arabic` being installed, which the Dockerfile
  does explicitly. **Verify a rendered Arabic report before going live** — disconnected
  letterforms are invisible to a reviewer who cannot read Arabic and glaring to
  everyone who can.
- **S3 storage** has been exercised against the driver interface, not against a real
  bucket. Presigned upload/download needs a live endpoint to confirm CORS.
- **Email** is unconfigured; nothing has been sent.
- **The Docker image build** completed through the client, dependency and Chromium
  layers but has not produced a running container in this environment — the machine's
  Docker daemon failed mid-build when its disk filled. The Dockerfile, entrypoint and
  nginx config are written and syntax-checked; **`docker compose up --build` is
  unproven and should be run once before it is relied on.**
- **Multi-replica behaviour** — the Socket.IO Redis adapter is not configured, and
  above one replica it is required. See `docs/deployment.md`.

---

## Reproducing

```bash
cp .env.example .env          # then fill in the REQUIRED values
npm run install-all
docker compose up -d postgres redis    # or see docs/local-database.md
npm run db:deploy && npm run db:seed
npm run start:local
cd server && npm test
```
