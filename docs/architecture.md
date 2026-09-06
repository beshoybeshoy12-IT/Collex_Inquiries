# Architecture

The decisions, and why each one is the way it is. Where a choice was close, the
rejected option is named — a decision record that only lists the winner is a summary,
not a record.

---

## 1. Tenancy: one enforcement point, derived from the schema

Every tenant-scoped table carries a column named exactly `tenantId`. A **Prisma client
extension** (`server/src/prisma/tenant-guard.ts`) intercepts every operation on every
such model and merges the current tenant into the `where` and the `data`.

The list of scoped models is not written down. It is derived at startup:

```ts
Prisma.dmmf.datamodel.models
  .filter((m) => m.fields.some((f) => f.name === 'tenantId' && f.kind === 'scalar'))
```

**This is the whole design.** A hand-maintained list is a list somebody forgets to
update, and the failure mode of forgetting is a silent cross-tenant read that nothing
alerts on. Deriving it means a new table is protected the moment it is migrated, and a
table that *should* be scoped and is not becomes a schema-review question — visible, in
a diff — rather than an invisible hole.

### Three properties, each with tests

1. **No context on a scoped model throws.** `MissingTenantContextError`, not "returns
   everything". The difference between a loud 500 in staging and a data breach in
   production is which of those two a missing wrapper produces.
2. **A client-supplied `tenantId` is overwritten and logged.** Not honoured, not
   rejected with a 400 that tells an attacker what to try next — overwritten, and the
   attempt recorded.
3. **Crossing tenants requires `runAsSystem()`**, which is one greppable identifier.
   Login uses it (it must find a user before it knows their tenant); so does the seed.
   There is no other way, and there is no way to reach it from an HTTP handler.

### Rejected: Postgres row-level security

RLS is stronger — it survives an ORM bypass, which this does not. It was rejected
because it needs a per-request `SET LOCAL` on a pooled connection, and a pooler that
hands the connection on without resetting the setting produces exactly the leak RLS
was adopted to prevent. That is a subtle failure with a catastrophic outcome. The
extension fails loudly instead, and everything already goes through Prisma.

If this ever runs somewhere the ORM can be bypassed, add RLS **as well**.

### The lazy-promise trap

`runAsSystem` and `runAsTenant` are `async` and `await` **inside** `storage.run()`:

```ts
async runAsTenant<T>(tenantId, fn) {
  return storage.run(ctx, async () => await fn());
}
```

Prisma promises are lazy — building one does not execute it. A synchronous wrapper
returns the unexecuted promise, the `AsyncLocalStorage` scope closes, and the query
then runs with **no context at all**. It surfaces as `TENANT_CONTEXT_MISSING` thrown
from somewhere unrelated to the code that caused it. This cost half a day; the
`await` is load-bearing.

Context is opened in **middleware**, not an interceptor, because guards run before
interceptors and the guards need it.

### 404, not 403

Asking for another tenant's case returns 404. A 403 confirms the row exists, which is
an enumeration oracle.

---

## 2. Two principal types, one token pipeline

`WEB_USER` and `INVESTIGATOR` are separate tables. Office staff have emails, roles and
permission grids; field investigators have an employee code, a company code, a phone
and a coverage area, and frequently no work email at all.

They share the token machinery and the route table. `@AllowPrincipals(...)` declares
which types a route admits.

### Rejected: one `User` table with a discriminator

It would have meant a table where half the columns are null for half the rows, a
`role` enum doing two unrelated jobs, and permission logic branching on type
everywhere. Two tables cost one extra `if` in token minting.

### Rejected: a separate mobile API

The brief forbids a "separate duplicated business logic layer for mobile", and the
reason is not tidiness. A `MobileInvestigationsController` is a second copy of the
status machine, the SLA rules and the scoping — and the second copy drifts. A bug
fixed in one is live in the other for a year.

So a field investigator posts to the **same**
`/api/v1/investigations/:id/transition` a coordinator does. The status machine
decides who may perform which transition; the service decides what each may see.

### Tokens

- **Access**: JWT, 15 minutes.
- **Refresh**: opaque, random, **stored only as a SHA-256 hash**, rotated on every use.

A refresh token is a bearer credential for a month. Storing it in a form the database
can hand back turns a read-only SQL injection into a full account takeover. Hashing
costs nothing.

**Reuse detection**: presenting an already-rotated refresh token revokes the entire
session family. If a token was stolen, both parties hold one and one of them will
present a stale token; killing everything is the only response that ends the intrusion.
The legitimate user logs in again. The alternative is the attacker keeping a valid
session indefinitely, which is not a trade worth making.

This is why the client's refresh must be **single-flight** — five parallel 401s must
share one refresh, or four of them present an already-rotated token and trip the
detector on the user's own device.

---

## 3. Authorization: three tables, no compiled-in roles

```
Permission                  global catalogue of codes
Role → RolePermission       per tenant
UserPermissionOverride      per user, grant or deny — deny wins
```

The brief says permissions must be configurable. A `Role` enum in code means a tenant
that wants "QC Officer who may also reassign" needs a deploy. Here it needs a row.

**Deny beats grant**, always. The reason someone adds a deny is that they specifically
want that person not to do that thing; the reason someone has a grant is usually that
they hold a broad role. If grant won, the deny would be a suggestion.

### Two guard rules that look redundant and are not

**`PermissionsGuard` re-checks `@Public()`.** Global guards do not short-circuit one
another — `JwtAuthGuard` returning early does not stop `PermissionsGuard` running. A
comment in this file once asserted otherwise, which was wrong and 403'd every public
route. Now tested.

**A non-`WEB_USER` principal that passed `@AllowPrincipals` returns true.**
Investigators hold no permission rows at all — their access is bounded by service-level
scoping ("your own cases"), which is the real contract. Without this rule every shared
route 403s the entire mobile API.

Frontend permission checks hide buttons. They are a convenience, never a control.

---

## 4. The case lifecycle is a data table

`case-status.machine.ts` declares each transition with its permitted actors, the
timestamp it stamps, and whether a reason is mandatory:

```
NEW → ASSIGNED           coordinator, supervisor        stamps assignedAt
ASSIGNED → ACCEPTED      investigator                   stamps acceptedAt
SUBMITTED → REWORK       qc_officer         reason required
```

A `switch` in a service does the same thing until the day someone adds a status, and
then it does it in four places. Adding a status here is a row plus a translation key.

Two rules are business decisions rather than mechanics, and both are tested by name:

- **An investigator cannot approve their own work.** Not a permission check — a
  transition the machine does not offer that actor. QC exists to be independent.
- **A coordinator cannot check in at an address.** They are not there.

Cancellation is derived from the non-terminal statuses rather than listed, so a new
status is cancellable by default. That is the safer direction to be wrong in: a case
that cannot be cancelled is a support ticket.

---

## 5. SLA and TAT are derived, never stored

`SlaState` is computed on read from the case's timestamps and its policy.

A stored state is a value something must recompute. The moment that something misses a
run — a worker restart, a deploy, a clock change — the badge on the screen disagrees
with the dates printed beside it, and users learn to distrust the colour. Deriving
costs arithmetic on rows already loaded.

**Business hours are real.** With `businessHoursOnly`, the clock runs only during the
configured workday on configured workdays. A case raised at 4pm Thursday with an
8-hour SLA is not breached by Sunday morning, because nobody was meant to be working.
A system that says otherwise trains its users to ignore it.

The test suite is written against a **Sunday–Thursday** week — the Egyptian working
week — precisely because a Monday–Friday assumption is the bug most likely to survive
review. Every "does it skip the weekend" test passes trivially under a Mon–Fri policy
if you only check that the numbers are non-negative.

**A finished case settles.** `MET` or `BREACHED`, forever. `RED` means "act now", and
a case closed last month cannot be acted on; leaving it red keeps it on a worklist and
makes the breach report meaningless.

**Every per-stage figure is nullable.** A stage that has not happened reports `null`,
not `0`. A zero is averaged in as "instant", and a dashboard built on that reports an
assignment time that *falls* as the backlog grows.

---

## 6. Escalation: thresholds in rows, deduplication in a constraint

`EscalationRule` carries the trigger, the threshold, the audience and the channel.
There is no number in the code. A tenant that wants supervisors paged at 90 minutes
instead of 120 edits a row.

Deduplication is a **unique constraint** on `EscalationEvent`, not a check-then-insert.
Two workers sweeping in the same second both pass a check and both send. The database
is the only thing that can arbitrate that, so it does.

---

## 7. Imports: validate first, stage, then confirm

```
inspect → prepare (stage + validate every row) → preview → confirm
```

Nothing is written until the operator confirms. A partial import is worse than a failed
one: the operator does not know which rows landed, and re-running duplicates them.

Header mapping is a **bilingual alias catalogue**, so a file from a new bank usually
needs aliases rather than parsing code. `normaliseHeader` folds Arabic orthographic
variants — `الرقم القومي` and `الرقم القومى` differ only in the final yāʾ, and a bank's
export uses whichever its operator typed.

### The error/warning line is the product

| Problem | Verdict | Why |
| --- | --- | --- |
| No customer name | **error** | the case is unusable; there is nobody to investigate |
| No product | **error** | decides which client is billed and which SLA applies |
| Unparseable date | **error** | a wrong deadline silently drives escalation |
| 13-digit national id | warning | usually a transcription slip; refusing loses a real case |
| Malformed phone | warning | the address is still visitable |
| Unknown governorate | warning | routing hint, not a requirement |
| Unknown priority | warning | falls back to the batch default |

Errors that should be warnings make the tool hated and drive people back to
spreadsheets. Warnings that should be errors route work to the wrong client. The tests
state each of these in words, so changing one means arguing with the reason.

### Formula injection

A cell beginning `=`, `+`, `-` or `@` is prefixed with `'`. A customer name of
`=cmd|'/c calc'!A1` re-exported to Excel is code execution on the machine of whoever
opens it. The value is kept — it may be a legitimate negative number — but disarmed.

---

## 8. Forms: published versions are immutable

A `FormTemplate` has many `FormVersion`s. Publishing freezes one. A case pins the
`formVersionId` it was created under.

Editing a form must never change what an already-submitted case was asked. That is the
difference between an audit trail and a rewrite of history — and this data ends up in
a report a bank may re-read years later.

---

## 9. Queue and workers

BullMQ over Redis. Without Redis, jobs run **inline in the request process**, and
`/readiness` says so:

```json
{ "queue": { "ok": true, "detail": "inline (no Redis configured)" } }
```

An honest degraded mode beats a queue that silently accepts work it will never do. It
is slower and it is correct.

Redis must run **`maxmemory-policy noeviction`**. Under any `allkeys-*` policy Redis is
free to drop a job hash while the job is queued; the visible symptom is an export stuck
in `PENDING` forever with no error anywhere. BullMQ warns loudly about this, and it is
right to.

The worker is `dist/worker.js` — a **separate entrypoint from the same image**. One
image means the halves cannot drift; two processes mean a 40-second PDF render never
blocks a request. Only the API container migrates.

---

## 10. PDF: a browser, not a PDF library

Puppeteer renders a Handlebars template.

Arabic requires **HarfBuzz shaping**: letters change form by position and join to their
neighbours. The common Node PDF libraries lay out glyphs individually and produce
disconnected letterforms — text that is technically present and unreadable. The failure
is invisible to a reviewer who cannot read Arabic and glaring to everyone who can, which
makes it exactly the kind of bug that ships.

A browser already solves this. The cost is ~300 MB of Chromium in the image and a CPU
core per render, which is why rendering is on the worker.

The runtime image installs `font-noto-arabic` explicitly. Without it Chromium falls
back to a face with no Arabic coverage and renders boxes.

---

## 11. Storage behind an interface

`server/src/storage/` exposes a driver interface; the S3 driver serves AWS S3,
Cloudflare R2 and MinIO. Nothing outside that folder imports the AWS SDK.

Uploads and downloads are **presigned** — file bytes never pass through the API. A
phone on a weak connection retrying a 4 MB multipart POST through Node is the worst
version of this, and it occupies a request worker for the duration.

Every key is prefixed `t/<tenantId>/`, so even a bucket listing stays
tenant-partitioned.

An asset is **not part of the case until confirmed**. An upload that fails halfway
leaves an unconfirmed row a sweep can clean, rather than a case that appears to have
evidence it does not.

---

## 12. Idempotency

`Idempotency-Key` on any mutation. The key is **claimed before the handler runs** — a
row inserted with a sentinel status, where the primary key is the lock.

Recording *after* the response protects a sequential retry and does nothing for two
requests in flight at once, which is exactly what a double-tap on a slow connection
produces. Verified: three concurrent requests with one key produced **one** row.

Only 2xx is remembered. A failure releases the claim, because replaying a 500 for a day
turns a blip into a permanent outage for that key. A claim older than five minutes can
be taken over, because the process that made it is not coming back.

If the store is unreachable the request proceeds unprotected. The worst case is the
duplicate this prevents; refusing real work is worse.

---

## 13. Realtime sends signals, not data

Socket.IO on `/realtime`, rooms per tenant and per user. An event is
`{ type: 'case.updated', investigationId }`, and the client refetches over REST.

A payload pushed down a socket bypasses every permission check the REST layer applies,
and the socket layer would then have to re-implement all of them — correctly, forever,
including the ones added next year.

---

## 14. Frontend

**JavaScript and JSX only.** No `tsconfig.json`, no `.ts`, no `.tsx`. A constraint from
the brief.

- **TanStack Query for server state.** Almost all state here is server state; a cache
  with invalidation is the actual requirement. Redux would be a second copy of the
  database with hand-written synchronisation.
- **Direction genuinely flips.** `applyDirection()` sets `<html dir>` and dynamically
  imports `bootstrap.rtl.min.css` or `bootstrap.min.css`. Application CSS uses logical
  properties throughout, so there is one stylesheet rather than two that drift.
  Measured, not assumed: the sidebar moves from x∈[1005,1265] to x∈[0,260].
- **Business codes are language-independent.** Every catalogue row carries `code`,
  `nameAr`, `nameEn`. Nothing keys off a display name.
- **Routes are code-split**; heavy libraries are imported at the point of use. chart.js
  is 184 kB and stays off the critical path — verified against the entry chunk plus
  every `modulepreload` in `dist/index.html`, not by reading the build's chunk list.

---

## What is deliberately absent

- **No mobile app.** The API is built and tested; the app is not written.
- **No map tiles.** A basemap means an account, an API key and a per-request bill with
  somebody's coordinates in it. Positions are plotted on a bounded projection with
  staleness shown, and each pin links out to a real map. Swapping in Leaflet is one
  component.
- **No SMS or voice.** No notification channel beyond in-app and email.
- **No offline sync engine.** The server provides what an offline client needs —
  `capturedAt`, idempotency keys, server-derived `allowedTransitions`, 409 for "the case
  moved on" — but the queue-and-reconcile logic belongs to the app that does not exist
  yet.

Each of these is a decision with a reason, not a gap. Building a fake version of any of
them would be worse than the absence.
