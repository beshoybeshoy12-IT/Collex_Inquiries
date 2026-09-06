# The mobile API contract

**The mobile application does not exist.** This document describes the server-side
contract that is built, tested and running, so that whoever writes the app has
something to write against — and so that nobody has to change the auth contract later
to accommodate it.

Everything below is exercised by the end-to-end smoke test. Nothing here is aspirational.

---

## There is no `/mobile` prefix, and that is the design

A field investigator calls the **same** routes a coordinator does:

```
POST /api/v1/investigations/:id/transition     ← both
GET  /api/v1/investigations/:id                ← both
POST /api/v1/gps/events                        ← both
```

`@AllowPrincipals(PrincipalType.INVESTIGATOR, …)` declares which principal types a
route admits; the **service** then narrows what each may see and do. An investigator
asking for a case they are not assigned gets a 404.

A parallel `MobileInvestigationsController` would be a second copy of the status
machine, the SLA rules and the scoping — and the second copy drifts. The brief is
explicit about not building a "separate duplicated business logic layer for mobile",
and this is what honouring it looks like in the route table.

The single investigator-specific route is the login, because investigators are a
separate table with their own credentials.

---

## Authentication

### Sign in

```http
POST /api/v1/auth/investigator/login
Content-Type: application/json

{
  "identifier":  "INV-001",          // the employee code OR the phone number
  "tenantCode":  "DEMO",             // the company code — required
  "password":    "…",

  "deviceId":       "…",             // optional, all four
  "deviceModel":    "Galaxy A54",
  "devicePlatform": "android",
  "pushToken":      "…"              // FCM/APNs
}
```

```json
{
  "success": true,
  "data": {
    "accessToken":  "eyJ…",
    "refreshToken": "opaque-random-string",
    "tokenType":    "Bearer",
    "expiresIn":    900,
    "investigator": {
      "id": "…", "employeeCode": "INV-001", "fullName": "…",
      "phone": "…", "avatarUrl": null, "status": "ACTIVE", "locale": "ar"
    }
  }
}
```

Throttled to 5 attempts per minute. The reply does not distinguish an unknown employee
code from a wrong password, and takes the same time either way.

Investigators sign in with an **employee code or a phone number, not an email**, and
must name their company. Field staff are issued a code and frequently have no work
email; requiring one would mean inventing addresses nobody reads. `tenantCode` is
required because the employee code is only unique **within** a tenant — INV-001 exists
at every company that uses the product, so without it there is no single row to
authenticate against.

Every field name matters: `whitelist + forbidNonWhitelisted` is on, so a body with
`employeeCode` instead of `identifier` is a **400**, not a login failure.

### Refresh

```http
POST /api/v1/auth/refresh
{ "refreshToken": "…" }
```

Returns a **new pair**. The old refresh token is dead the instant it is used.

Three things the client must get right, because the server will not forgive them:

1. **Refresh is single-flight.** If five requests 401 at once, issue **one** refresh
   and have the other four await it. Five parallel refreshes means four of them
   present an already-rotated token.
2. **Presenting a rotated refresh token kills the whole session family.** The server
   assumes theft and revokes everything. The user is signed out and must log in again.
   This is correct behaviour, and a client that retries a failed refresh with the same
   token will trigger it.
3. **Persist the new refresh token before using the new access token.** A crash
   between the two loses the session.

The investigator refresh token lives for `JWT_INVESTIGATOR_REFRESH_EXPIRES_IN`
(default **90 days**) rather than the web's 30 — a field investigator who is signed out
mid-visit because they were on leave for a month cannot do their job, and the phone is
in their pocket rather than on a shared desk.

### Sign out

```http
POST /api/v1/auth/logout        { "refreshToken": "…" }
POST /api/v1/auth/logout-all
```

---

## The working day

### What am I doing today

```http
GET /api/v1/assignments/my
```

Returns the investigator's current assignments with the case, the customer, the
address, the due date and the SLA state. This is the app's home screen and it is one
request — deliberately, because it is fetched on a phone on mobile data in a stairwell.

### Accept or decline

```http
POST /api/v1/assignments/:id/respond
{ "accept": true }
{ "accept": false, "reason": "…" }        ← a decline must say why
```

### Moving the case along

```http
POST /api/v1/investigations/:id/transition
{ "to": "IN_PROGRESS", "reason": "…", "lat": 30.0444, "lng": 31.2357 }
```

The permitted `to` values come from the server, not from a list hard-coded in the app:

```http
GET /api/v1/investigations/:id        → data.allowedTransitions
```

**Render the buttons from that array.** The status machine is a data table on the
server and gains statuses without an app release; an app with a compiled-in list shows
the wrong buttons the day a tenant adds one, and its users cannot proceed.

An illegal transition is a **409** with a bilingual message, not a 400 — the request
was well formed, the case was simply not in a state that permits it.

### Position

```http
POST /api/v1/gps/events
{ "investigationId": "…", "type": "CHECK_IN", "lat": …, "lng": …, "accuracy": 12.5, "capturedAt": "…" }

POST /api/v1/investigators/me/location
{ "lat": …, "lng": …, "accuracy": … }
```

`capturedAt` is the client's timestamp, sent so a fix queued offline records **when it
was taken**, not when it was uploaded. The server stores both and trusts its own clock
for ordering.

### Availability

```http
PATCH /api/v1/investigators/me/availability
{ "availability": "ON_VISIT" }
```

---

## The form

```http
GET   /api/v1/forms/investigation/:investigationId          ← the pinned version + any draft
PATCH /api/v1/forms/investigation/:investigationId/draft    ← save partial answers
POST  /api/v1/forms/investigation/:investigationId/submit   ← submit for QC
```

The case pins the `formVersionId` it was created under, and that is what comes back.
A form edited in the office **does not** change what an in-flight case is asked —
which is the difference between an audit trail and a rewrite of history.

**Render the form from the schema.** Field types, labels (`labelAr`/`labelEn`),
options, validation rules and conditional visibility all arrive in the response. A
hard-coded form is wrong for every tenant but the one it was written for.

The draft endpoint accepts partial, invalid answers on purpose — it is a save, not a
submission. Validation happens at submit, and a rejected submit returns per-field
problems keyed by field id so the app can mark the offending inputs.

---

## Photographs

Two requests plus a direct upload, so file bytes never pass through the API:

```http
POST /api/v1/media/request-upload
{ "investigationId": "…", "categoryId": "…", "filename": "front-door.jpg", "contentType": "image/jpeg", "sizeBytes": 2481233 }
   → { "uploadUrl": "https://…", "assetId": "…", "expiresIn": 900 }

PUT <uploadUrl>                                  ← direct to storage
Content-Type: image/jpeg

POST /api/v1/media/:assetId/confirm
{ "lat": …, "lng": …, "capturedAt": "…" }
```

The presigned URL expires in `S3_PRESIGN_TTL` (900s default). **An asset is not part
of the case until it is confirmed** — an upload that fails halfway leaves an
unconfirmed row a sweep can clean, rather than a case that appears to have evidence it
does not.

`POST /api/v1/media/upload` (multipart, through the API) also exists, for the web
client's small uploads. The mobile client should use the presigned pair: a phone on a
weak connection retrying a 4 MB multipart POST through the API is the worst version of
this.

---

## Building the offline half

The server does not implement offline sync, and the app should not expect it to. What
the server does provide is enough for the app to build it:

- **`capturedAt` on every field event**, so a queue drained hours later is still
  chronologically honest.
- **`Idempotency-Key` header support on mutations.** A retried submit with the same key
  returns the original result instead of a duplicate. Generate the key when the user
  acts, not when the request is sent — that is the whole point.
- **Server-derived `allowedTransitions`**, so a queued action can be re-validated when
  it finally reaches the server rather than being assumed valid at queue time.
- **409 for "the case moved on"**, distinguishable from a network failure. A queued
  transition that is no longer legal must surface to the user, not retry forever.

The one thing the app must not do is decide the outcome itself. If a submit is queued
and QC has meanwhile returned the case for rework, the server says so and the app shows
it. An app that reconciles by overwriting will lose a reviewer's decision.

---

## Conventions

- **Response envelope**: `{ success, data, timestamp }`, plus `meta` when paginated.
  Errors are `{ success: false, statusCode, message, timestamp }` with any extra
  structured detail alongside.
- **Messages are bilingual**, formatted `"عربي - English"`. Split on `" - "` and show
  the half matching the device language.
- **Enums are language-independent codes** (`IN_PROGRESS`, `URGENT`). Never parse or
  display a display name as an identifier; every catalogue row carries `code`,
  `nameAr` and `nameEn`.
- **Money is a decimal string**, not a float. Parse it as a decimal.
- **Timestamps are ISO 8601 UTC.** Convert for display only.
- **Never send a `tenantId`.** The server derives it from the token and treats a
  supplied one as an injection attempt.

## Realtime

Socket.IO at `/realtime`, authenticated with the access token.

Events are **signals, not data**: `{ type: 'assignment.created', investigationId }`.
Refetch over REST on receipt. A payload pushed down the socket would bypass the
permission checks the REST layer applies, and the socket layer would then have to
re-implement all of them correctly, forever.

## Swagger

`http://localhost:5100/api/docs` is authoritative and generated from the DTOs. Where
this document and Swagger disagree, Swagger is right and this document is stale.
