# API reference

**Swagger at `http://localhost:5100/api/docs` is authoritative.** It is generated from
the DTOs, so it cannot drift. This document is the orientation: the shapes, the
conventions, and the handful of behaviours that are surprising enough to be worth
stating in prose.

---

## Base path

```
/api/v1/…
```

Globally prefixed `api`, URI-versioned `v1`. A controller declared
`@Controller({ path: 'investigations', version: '1' })` lives at
`/api/v1/investigations`.

**nginx forwards `/api/` without stripping it.** The sibling Collex System V1 strips
the prefix; copying that config here turns every route into a 404.

Two routes are outside the version:

```
GET /health      liveness  — is the process alive
GET /readiness   readiness — database and queue reachable
```

`VERSION_NEUTRAL`, because a load balancer should not need to know the API's version
to ask whether it is up. Point liveness at `/health` and readiness at `/readiness` —
pointing liveness at `/readiness` turns a brief database blip into a restart storm.

---

## The envelope

Success:

```json
{ "success": true, "data": { … }, "timestamp": "2026-09-05T23:31:36.570Z" }
```

Paginated:

```json
{
  "success": true,
  "data": [ … ],
  "meta": { "page": 1, "limit": 25, "total": 137, "totalPages": 6 },
  "timestamp": "…"
}
```

`data` and `meta` stay at the top level rather than nesting under a second `data`, and
`success` is added either way so a client never has to know which shape it is looking
at to tell whether the call worked.

Error:

```json
{
  "success": false,
  "statusCode": 409,
  "message": "لا يمكن نقل الحالة - The case cannot move to that status",
  "timestamp": "…"
}
```

**Extra structured detail is forwarded, not flattened.** An import error carries
`problems` (per row and column); a QC rejection carries `reasons`; a login against
several tenants carries `tenants`. An import that cannot report per-cell errors is an
import the user cannot fix, so the exception filter passes every extra key through.

### Messages are bilingual

Formatted `"عربي - English"`. Split on `" - "` and show the half matching the user's
language. `localiseServerMessage()` in `client/src/services/api.js` does this.

### Validation

`ValidationPipe` is global with `whitelist + forbidNonWhitelisted + transform`. A body
property with no matching decorated DTO field is a **400** — new request fields require
a DTO change, deliberately.

---

## Authentication

```http
POST /api/v1/auth/login                 { email, password }
POST /api/v1/auth/investigator/login    { identifier, tenantCode, password }
POST /api/v1/auth/refresh               { refreshToken }      → a NEW pair
POST /api/v1/auth/logout                { refreshToken }
POST /api/v1/auth/logout-all
GET  /api/v1/auth/me
GET  /api/v1/auth/sessions
POST /api/v1/auth/change-password       { currentPassword, newPassword }
```

Everything else needs `Authorization: Bearer <accessToken>`.

Three behaviours worth knowing before you build a client:

1. **Refresh rotates.** The old refresh token is dead the moment it is used.
2. **Reuse kills the family.** Presenting an already-rotated refresh token revokes
   every session for that principal — the server assumes theft. A client that retries a
   failed refresh with the same token will do this to its own user.
3. **Refresh must be single-flight.** Five parallel 401s must trigger one refresh, with
   the others awaiting it. Otherwise four of them present a rotated token and trip (2).

Login does not distinguish an unknown account from a wrong password, and takes the same
time either way. It is throttled to **5 attempts per minute**.

---

## Idempotency

Send `Idempotency-Key: <opaque string>` on any `POST`/`PATCH`/`PUT`/`DELETE`:

- A retry with the same key returns the original response and sets
  `Idempotent-Replay: true`. Nothing happens twice.
- Concurrent requests with one key: one runs, the rest replay or receive **409**.
- Only 2xx is remembered — a failed request genuinely re-runs on retry.
- Keys are scoped per (tenant, principal, endpoint) and expire after 24 hours.

**Generate the key when the user acts, not when the request is sent.** A key minted per
HTTP attempt differs on the retry and buys nothing. This is the single most common way
the mechanism gets implemented uselessly.

Ignored on `GET` — caching a read under a client-chosen key is a cache-poisoning
primitive.

---

## Route map

| Base | Covers |
| --- | --- |
| `/auth` | sign-in, refresh, sessions, password |
| `/investigations` | cases: list, detail, create, transition, timeline, comments |
| `/customers` | customer 360, duplicate detection, history |
| `/assignments` | assign, reassign, the investigator's own queue |
| `/investigators` | roster, coverage, availability, live positions |
| `/forms` | templates, versions, per-case answers, draft and submit |
| `/qc` | review queue, approve, return for rework, statistics |
| `/imports` | inspect, prepare, preview, confirm, batches, mapping templates |
| `/media` | presigned upload/download, categories, confirm |
| `/gps` | position events, per-case tracks |
| `/reports` | generation requests, downloads, templates |
| `/dashboard` | KPIs and charts |
| `/notifications` | list, unread count, mark read |
| `/products`, `/investigation-types`, `/geography` | catalogues |
| `/sla` | policies and escalation rules |
| `/users`, `/roles`, `/permissions` | administration |
| `/tenants/me` | the caller's own company profile and settings |
| `/tenants`, `/tenants/:id/status`, `/tenants/:id/limits` | **platform operator only** — see below |
| `/audit` | the audit log |

### The platform-operator routes

Four routes are not permission-gated at all:

| | |
| --- | --- |
| `GET /tenants` | every company on the platform |
| `POST /tenants` | provision a company, its default roles and its first administrator, in one transaction |
| `PATCH /tenants/:id/status` | `ACTIVE` / `TRIAL` / `SUSPENDED` / `EXPIRED` |
| `PATCH /tenants/:id/limits` | `maxWebUsers`, `maxInvestigators`, `subscriptionEnd` |

They require `isSuperAdmin` on the principal, checked in the controller. **A permission
would not do**: a company administrator normally holds every permission in the
catalogue, so any permission naming these would also be held by every customer. Anyone
else gets:

```
403  هذا الإجراء متاح لمشغل المنصة فقط - This action is available to platform operators only
```

`POST /tenants` returns the first administrator's generated password **once**:

```json
{
  "tenant": { "id": "…", "code": "ACME", "status": "TRIAL" },
  "admin":  { "id": "…", "email": "admin@acme.test", "fullName": "…" },
  "temporaryPassword": "iB!eEPJRLaZtNv9H"
}
```

Only the hash is stored; there is no route that reads it back. Losing this response
means resetting the password, not looking it up.

Moving a company out of `ACTIVE`/`TRIAL` **revokes every session in it immediately** —
an existing token answers `401 تم إنهاء الجلسة - Session was ended`, and a fresh login
answers `403 تم إيقاف حساب الشركة - Company account is suspended`.

---

## Conventions

- **Pagination**: `?page=1&limit=25`. `limit` is capped server-side.
- **Sorting**: `?sortBy=createdAt&sortOrder=desc`.
- **Filtering**: named query parameters per resource; see Swagger. Unknown parameters
  are a 400.
- **Enums are language-independent codes** — `IN_PROGRESS`, `URGENT`, `QC_PENDING`.
  Every catalogue row carries `code`, `nameAr`, `nameEn`; never parse a display name.
- **Money is a decimal string.** Prisma returns `Decimal`; it is serialised as a string
  so it does not pass through a float. Parse it as a decimal.
- **Timestamps are ISO 8601 UTC.** Convert for display only.
- **Ids are UUIDs.**
- **Never send `tenantId`.** The server derives it from the token and records a
  supplied one as an injection attempt.

---

## Status codes

| Code | Means |
| --- | --- |
| 400 | malformed body, unknown property, failed validation |
| 401 | missing or expired access token — refresh and retry once |
| 403 | authenticated, but lacks the permission |
| 404 | not found **or not yours** — the two are deliberately indistinguishable |
| 409 | a conflict with current state: an illegal transition, a duplicate, an in-flight idempotency key |
| 422 | semantically invalid — e.g. a form submission failing its schema, with per-field `problems` |
| 429 | rate limited; `Retry-After` is set |

**404 covers "not yours".** A 403 on another tenant's case confirms the case exists,
which is an enumeration oracle. An illegal transition is **409**, not 400 — the request
was well formed; the case was simply not in a state that permits it.

---

## Rate limits

Global limits apply to every route, with a much stricter limit on `/auth/login` and
`/auth/refresh`. A valid-looking refresh token is worth brute-forcing.

Exceeding a limit returns **429** with `Retry-After`, a bilingual message naming the
wait, and a `retryAfterSeconds` field so a client can render a countdown without
parsing the text:

```json
{
  "success": false,
  "statusCode": 429,
  "message": "محاولات كثيرة. برجاء المحاولة بعد 60 ثانية - Too many attempts. Please try again in 60 seconds",
  "errorCode": "RATE_LIMITED",
  "retryAfterSeconds": 60
}
```

This needs `BilingualThrottlerGuard`, not the stock `ThrottlerGuard` — the latter's
message is the literal string `"ThrottlerException: Too Many Requests"`, which is a
class name, is English-only, and never says how long to wait. A user who cannot see
the end of a rate limit cannot tell it from a broken login, and keeps clicking.

---

## Realtime

Socket.IO at `/realtime`, authenticated with the access token, rooms per tenant and per
user.

Events are **signals, not data** — `{ type: 'case.updated', investigationId }` — and the
client refetches over REST. A payload pushed down the socket would bypass the
permission checks the REST layer applies.

---

## Mobile

The investigator-facing contract is the same route table, gated by `@AllowPrincipals`.
See `docs/mobile-api.md` for what a field client calls and in what order.
