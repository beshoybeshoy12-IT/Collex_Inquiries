# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## What this is

**Collex Inquiries** — a multi-tenant Field Investigation / Field Verification
Management System. Banks and leasing companies ask an agency to verify that a
customer really lives where they say, works where they say, or runs the business they
say. The agency dispatches an investigator, who visits, photographs, fills in a form
and submits; a QC reviewer approves or returns it; a PDF report goes back to the
client.

Four independent npm packages, **no workspaces** — each has its own `package.json`
and lockfile and installs separately:

- `client/` — React 19 + Vite 6, Bootstrap 5, TanStack Query, i18next. **JavaScript
  and JSX only.**
- `server/` — NestJS 11 + Prisma 6 + PostgreSQL 16, BullMQ, Socket.IO, Puppeteer
- `mobile/` — the investigator's field app: plain React Native 0.88 (community CLI,
  **no Expo** — the owner's decision), React Navigation, TanStack Query, i18next.
  **JavaScript and JSX only**, same as `client/`.
- root — orchestration scripts only

## Hard constraints

These come from the brief and are not open for tidying:

1. **The mobile app (`mobile/`) uses the same API as everyone else.** **There is no
   `/mobile` route prefix** — an investigator calls the same routes a coordinator
   does, gated by `@AllowPrincipals` and narrowed by the service. The one
   investigator-specific route is `POST /api/v1/auth/investigator/login`. New field
   features are server routes first (tested), then app screens; the app never decides
   on its own what a case may do next — it renders `allowedTransitions`.
   **The phone is never required to close a case.** The office can hand a paper form
   in (`POST /forms/investigation/:id/office/submit`) and take the case through QC
   and completion from the web.
2. **No TypeScript in `client/` or `mobile/`.** No `.ts`, no `.tsx`, no
   `tsconfig.json`. If a file would benefit from types, use JSDoc. (`mobile/` has the
   `typescript` package as a dev dependency only because `@react-native/eslint-config`
   loads its parser.)
3. **Never trust a client-supplied `tenantId`.** It is ignored and logged as an
   injection attempt. The tenant comes from the authenticated principal.
4. **Permissions are enforced server-side.** Frontend checks hide buttons; they are
   never a control.
5. **No hard-coded secrets, ever.** Not as a fallback, not "just for dev", not in the
   seed.
6. **No hard-coded business rules.** Products, investigation types, permissions,
   roles, SLA policies, escalation thresholds and form fields are all database rows.
   A tenant that wants a new investigation type must not need a deploy.
7. **Storage is behind an interface.** S3, R2 and MinIO all work; nothing imports the
   AWS SDK outside `server/src/storage/`.
8. **Arabic and English, RTL and LTR, from the start.** Business codes are
   language-independent (`code` + `nameAr` + `nameEn`).

## Commands

```bash
npm run install-all      # root + client + server + mobile; run before anything
npm run start:local      # client 5174 + api 5100 + worker
npm start / npm stop     # the Docker stack (nginx on 8080)
npm test                 # server jest suite
```

Server (`cd server`): `npm run start:dev`, `npm run worker:dev`, `npm test`,
`npx jest <file>`, `npx jest -t "<name>"`, `npm run db:deploy`, `npm run db:seed`,
`npm run db:platform-admin`, `npm run db:inquiry-forms [-- <tenant-code>]` (publishes the
residence/work inquiry forms from `prisma/seed-data/forms.ts` into existing tenants as a
new version; idempotent).

Client (`cd client`): `npm run dev`, `npm run build`, `npm run lint`.

Mobile (`cd mobile`): `npm start` (Metro) + `npm run android` (emulator or USB
phone), `npm run lint`, `npm run check:bundle` (full release bundle — the fastest
"does it compile" check), `npm run build:apk`. **No Expo anywhere** — no `expo-*`
packages, no EAS, no Expo Go; pick plain React Native community libraries. Settings
are `API_URL` and the optional test-build `DEMO_*` in `mobile/.env` (see
`.env.example`), inlined by `react-native-dotenv` and read only in
`src/lib/env.js`; a phone needs the computer's LAN address, not `localhost`. There
is no web preview. Read `mobile/AGENTS.md` before building: on Windows the native
build needs `LongPathsEnabled=1` and the SDK's newest CMake.

### Command gotchas

- **Never write `npx prisma`.** With the CLI resolvable locally, npx still reaches the
  network, and the `latest` tag is currently an 8.0 release candidate whose command
  set has no `generate` — the failure reads as `No command registered for generate`,
  which looks like a Prisma bug and is not. Use `prisma …` in an npm script (npm puts
  `node_modules/.bin` on PATH) or `./node_modules/.bin/prisma` in a Dockerfile or
  shell script. `prisma` is in **`dependencies`**, not `devDependencies`, because the
  container entrypoint runs `migrate deploy` at boot.
- **`npm run build` is `prisma generate && nest build`** and does not touch a
  database. Schema changes go through `db:deploy` (`migrate deploy`) or `db:push` for
  scratch work. `db push` mutates whatever `DATABASE_URL` points at — never aim it at
  a populated database.
- **`db:push` runs `db:extensions` first** (`CREATE EXTENSION pg_trgm`). The search
  columns carry `gin_trgm_ops` GIN indexes, and `db push` skips migrations, so without
  it you get `operator class "gin_trgm_ops" does not exist`. `migrate deploy` creates
  the extension itself.
- **`.npmrc` sets `legacy-peer-deps=true`** — required for installs to resolve.
- **Only ONE Nest compiler may run at a time.** `start:dev` (the API) compiles the
  whole project into `dist`, worker included; `worker:dev` is `node --watch
  dist/worker.js` and must stay that way. A second `nest start --watch` racing the
  first over one `dist` kills the worker seconds after a launch that looked fine.
  `nest-cli.json` therefore sets `deleteOutDir: false`, and `npm run build` cleans
  `dist` itself so a one-off build is still clean.
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
- Tests need no database; every spec is pure or fully mocked.
- The build emits `dist/main.js` and `dist/worker.js`. Keep source inside `src/` —
  `allowJs` is on, and a stray root-level script shifts the whole tree to `dist/src/`
  and breaks both entrypoints.
- The `.env` `DATABASE_URL` is the **host** view (`localhost:5434`). compose rebuilds
  it against the service name, because inside the API container `localhost` is that
  container. Same for `REDIS_URL`. Override with `DATABASE_URL_DOCKER` /
  `REDIS_URL_DOCKER`.

### Environment

`server/.env`, loaded via `dotenv`. Hard-required — the process will not boot without
them: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`. `SEED_ADMIN_PASSWORD` is
required before the seed will run, and **there is no fallback password anywhere.**

Also read: `PORT` (5100), `REDIS_URL`, `CORS_ORIGINS`, `CLIENT_URL`, `TRUST_PROXY`,
`STORAGE_DRIVER` + the `S3_*` block, `PUSH_DRIVER` + the `FCM_*` block, `EMAIL_*`,
`JWT_*_EXPIRES_IN`, `AUTH_MAX_FAILED_LOGINS`, `AUTH_LOCKOUT_MINUTES`, `SLA_SWEEP_CRON`,
the `*_RETENTION_DAYS` knobs, `LOG_LEVEL`.

**No Expo, and no Expo cloud services.** Push goes straight to Firebase Cloud Messaging
(`server/src/push/drivers/fcm.driver.ts`, HTTP v1 signed with `node:crypto`, no
`firebase-admin`); the app will register its raw FCM token (not wired yet: it needs the company's
`google-services.json` in `mobile/android/app/`).
`PUSH_DRIVER=fcm` with missing credentials refuses to boot.

Client reads `VITE_API_URL`, plus `VITE_GOOGLE_MAPS_API_KEY` / `VITE_GOOGLE_MAPS_MAP_ID`
for the live map (`client/.env.example`). The Maps key is a browser key — restrict it
by referrer in Google Cloud; without it the map falls back to a key-less view.

## Architecture

### Request path and the response envelope

```
browser → /api/v1/… → nginx (prod) or the Vite proxy (dev) → Nest
```

nginx forwards `/api/` **without stripping the prefix** — the API is globally
prefixed `api` and URI-versioned `v1`, so `@Controller('investigations')` lives at
`/api/v1/investigations`. **The sibling Collex System V1 strips `/api/` and this one
must not.** Copying that config across turns every route into a 404.

`/health` and `/readiness` are `@Controller({ version: VERSION_NEUTRAL })`. Note it is
on the *controller*, not `@Version()` on the method — the latter is a type error.

`ResponseInterceptor` wraps successes as `{ success, data, timestamp }`, adding `meta`
for paginated payloads. `HttpExceptionFilter` returns
`{ success: false, statusCode, message, timestamp }` **plus every extra key the thrown
object carried** — `problems`, `reasons`, `tenants`. Do not flatten those: an import
that cannot report per-cell errors is an import the user cannot fix.

`ValidationPipe` is global with `whitelist + forbidNonWhitelisted + transform`, so a
body property with no matching DTO field is a 400. New request fields need a DTO
change.

### Multi-tenancy — the part to be most careful with

`server/src/prisma/tenant-guard.ts` is a **Prisma client extension** that merges the
current tenant into every operation on every tenant-scoped model.

The model list is derived from `Prisma.dmmf` by looking for a scalar field named
exactly `tenantId`. It is not hand-maintained: **name the column `tenantId` and the
table is protected the moment it is migrated.** Name it anything else and it is not.

Three behaviours, each with tests in `tenant-guard.spec.ts`:

- No context on a scoped model → **throws** `MissingTenantContextError`. Never
  "returns everything".
- A client-supplied `tenantId` in `where` or `data` is **overwritten and logged**.
- Crossing tenants requires `runAsSystem()`, which is greppable. Login uses it (it
  must find a user before it knows their tenant); so does the seed.

> **`runAsSystem` / `runAsTenant` are `async` and `await` inside `storage.run()`.**
> Prisma promises are lazy. A synchronous wrapper returns an unexecuted promise, the
> `AsyncLocalStorage` scope closes, and the query then runs with **no tenant context
> at all** — which surfaces as `TENANT_CONTEXT_MISSING` from somewhere unrelated.
> This is not stylistic. Do not unwrap it.

Context is established in **middleware**, not an interceptor, so it exists before
guards run.

Cross-tenant reads return **404, not 403**. A 403 confirms the row exists.

Anything that writes outside a request — the audit logger, cron sweeps, queue jobs —
must wrap its work in `runAsTenant(tenantId, …)`. `AuditService.log` does; a new
background writer must too, or it throws on its first insert.

### Auth

`WEB_USER` and `INVESTIGATOR` are separate tables sharing one token pipeline.
`@AllowPrincipals(...)` declares which a route accepts.

Access JWT 15m; refresh token opaque, random, **stored only as a SHA-256 hash**, and
rotated on use. Presenting an already-rotated refresh token **kills the whole session
family** — the assumption is theft, and signing the real user out is the correct
outcome.

Login gives the same answer and takes the same time for "no such account" and "wrong
password".

### RBAC

`Permission` (global catalogue) → `Role` + `RolePermission` (**per tenant**) →
`UserPermissionOverride` (per user, grant or deny; **deny wins**). No role names are
compiled in.

`PermissionsGuard` has two rules that look redundant and are not:

1. **It re-checks `PUBLIC_KEY`.** Global guards do not short-circuit one another, so
   `@Public()` routes still reach it. A comment here once claimed they did not; that
   was wrong, and `permissions.guard.spec.ts` now pins it.
2. **A non-`WEB_USER` principal that passed `@AllowPrincipals` returns `true`.**
   Investigators hold no permission rows; their access is bounded by service-level
   scoping ("your own cases"). Remove this and every shared route 403s the entire
   mobile API.

### The platform operator — the one thing that is not a permission

`User.isSuperAdmin` gates `GET/POST /tenants` and `PATCH /tenants/:id/{status,limits}`
— creating companies, changing their status, changing their plan limits — and it is
checked **in `TenantsController`, in code**, not with `@RequirePermission`.

That is not an oversight to tidy up. `PermissionsGuard` returns true for a super admin
on every permission it is asked about, and the seeded `COMPANY_ADMIN` role holds all 81
permissions, so a `tenants.manage` permission would be satisfied by every customer's own
administrator. One customer would be able to list, suspend and re-price the others.
`tenants.controller.spec.ts` pins exactly that case.

**`isSuperAdmin` has no write path.** No DTO exposes it and no service sets it. It is
granted by `prisma/seed-platform-admin.ts` (`npm run db:platform-admin`), which needs
database access — that is the intended bar. The operator lives in its own `PLATFORM`
tenant so `onDelete: Cascade` on the demo tenant cannot remove it.

The console is `client/src/modules/platform/TenantList.jsx` at `/platform/tenants`.
Its route uses `<ProtectedRoute superAdmin>` and its nav entry is marked
`superAdminOnly` — both because `can()` cannot tell an operator from a fully-permissioned
administrator. Frontend gates remain conveniences; the controller is the control.

### Domain rules that live in data, not code

- **Case status** — `investigations/case-status.machine.ts` is a `TRANSITIONS` table:
  per transition, the permitted actors, the timestamp stamped, whether a reason is
  required. Adding a status is a row plus a translation key.
- **SLA/TAT** — derived on read in `investigations/sla.util.ts`, never stored. Business
  hours are real (Sunday–Thursday by policy, not by assumption). A completed case
  settles to `MET`/`BREACHED` and never wears `RED` again — `RED` means "act now".
- **Escalation** — every threshold is an `EscalationRule` row. Deduplication is a
  **unique constraint** on `EscalationEvent`, not check-then-insert; two workers
  sweeping simultaneously would both pass a check.
- **Forms** — `FormVersion` rows are immutable once published, and a case pins the
  `formVersionId` it was created under. Editing a form must never change what an
  already-submitted case was asked.
- **Paper forms** — the office types in a paper form through
  `PATCH /forms/investigation/:id/office` (`investigations.edit`, which QC lacks on
  purpose). It writes a DRAFT only, only from ASSIGNED to REWORK, and never moves the
  case. `client/src/modules/forms/InquirySheet.jsx` draws any schema as the paper sheet
  (edit / read / blank) and `/print/...` routes print it; print CSS is tuned so both
  seeded forms fit one A4 page — re-measure if you add fields.
- **Who may submit** — `TransitionRule.formOnly` marks actors who may make a move
  only by submitting the form (`assertTransition(..., { viaForm: true })`), never
  from the status bar; `allowedNextStatuses` leaves those moves out. The office uses
  it to hand in a paper form from ASSIGNED…IN_PROGRESS/REWORK straight to SUBMITTED,
  then QC_PENDING (no GPS check expected for paper; the other automatic checks are
  recorded for QC but do not bounce the case). The investigator's own path is
  unchanged: IN_PROGRESS → SUBMITTED from the app, with the automatic checks.
- **Choosing a case's form** — a case defaults to its type's form, but the office can
  put it on any published form (`PUT /forms/investigation/:id/form`) until the first
  submission; it is stored as the case's `formVersionId`. Assignment therefore pins
  **only when the case has no form yet** — reassignment and rework keep the existing
  pin. Switching discards an unsubmitted draft only with `discardDraft: true`.

### Imports

`inspect → prepare (stage + validate) → preview → confirm`. Nothing is written before
confirmation. Header auto-mapping is a bilingual alias catalogue in
`imports/utils/field-catalog.ts` — supporting a new bank is usually aliases, not code.

**The error/warning split is a product decision, not a style.** A missing customer
name blocks the row; a national id that is not fourteen digits only warns. Errors that
should be warnings make the tool hated; warnings that should be errors route work to
the wrong client. `row-validator.spec.ts` states each choice in words — if you change
one, change the test's reasoning too.

**Uploads start inside a client** ("الجهات", `ClientAccount`, `/clients`). Each client
keeps its own template (`templateFields`: its file's columns, in order, each linked to an
import field or kept as a client-only field). Its template is the mapping, every case the
upload creates gets `clientAccountId`, client-only values ride on the case in
`additionalData.clientFields` (label kept with the value), and the client's logo heads the
printed inquiry sheet. Application-number duplicates are checked within one client only.

Cells starting `=`, `+`, `-`, `@` are prefixed with `'`. This is not paranoia: an
exported name of `=cmd|'/c calc'!A1` is code execution for whoever opens the file.

### Queue, storage, realtime

- **BullMQ + Redis, with an honest inline fallback.** No Redis → jobs run in-process,
  and the log says so at boot. Redis must run `maxmemory-policy noeviction`; under an
  LRU policy it can drop a queued job hash and an export sits in `PENDING` forever.
- **The worker is `dist/worker.js`**, a separate entrypoint from the same image,
  selected by `ROLE=worker` in `docker/entrypoint.sh`. Only the API container
  migrates — two processes running `migrate deploy` against one database is how a
  schema ends up half applied.
- **PDF is Puppeteer + Handlebars, not a PDF library.** Arabic needs HarfBuzz shaping;
  the Node PDF libraries produce disconnected letterforms, which is invisible to a
  reviewer who cannot read Arabic. The runtime image installs `font-noto-arabic`
  deliberately.
- **Storage is an interface** in `server/src/storage/`. Presigned upload and download,
  keys prefixed `t/<tenantId>/`. Nothing outside that folder imports the AWS SDK.
- **Internal chat** (`server/src/chat/`, `client/src/modules/chat/ChatDock.jsx`) is
  one-to-one, office ↔ office and office ↔ investigator (never investigator ↔
  investigator), one thread per pair by a unique `pairKey`. Files are accepted by their
  bytes (`attachmentType`), served opaque to participants only, every download audited;
  deleting a message leaves a visible trace. Retention is `tenant.settings.chatRetentionDays`
  (default 365, 30–3650), pruned by the nightly sweep. Same routes for the app and the web.
- **Socket.IO sends signals, not data** — "case 123 changed", and the client refetches
  over REST so the permission checks stay in one place.

### Frontend

```
client/src/modules/<domain>/<Screen>.jsx
client/src/components/       shared UI (PageHeader, Panel, Modal, Toast, Badges…)
client/src/services/api.js   the axios instance — always import this, never raw axios
client/src/i18n/             translations + applyDirection()
```

- **Server state is TanStack Query**, not Redux.
- **Direction genuinely flips**: `applyDirection()` sets `<html dir>` and swaps the
  `href` of a **single `<link id="ci-bootstrap-css">`** between
  `bootstrap.rtl.min.css` and `bootstrap.min.css`. Application CSS uses logical
  properties (`margin-inline-start`, `inset-inline-end`) so there is one stylesheet.
  **Do not add physical-direction CSS** (`margin-left`, `left:`) — it will be wrong in
  one of the two languages, and only in one.
- **Never swap the Bootstrap build with `await import()`.** That is what this did
  first, and it fails only on the SECOND switch: a dynamic `import()` of a stylesheet
  injects it and caches the module, so ar → en → ar re-imports the RTL build, hits the
  cache, and injects nothing — while the LTR build picked up on the way through is
  still in the document and is now the last stylesheet, so it wins every conflict.
  Both builds end up live at once: `.me-2` sets margin on **both** sides and
  `.text-start` resolves to `left` under `dir="rtl"`, so Arabic labels sit against the
  wrong edge. A `<link>` is addressable and swappable; a cached module is not. It is
  **prepended** to `<head>` so `app.css` can override Bootstrap on ordinary
  specificity.
- **Routes are `React.lazy`.** Heavy libraries are dynamically imported at the point
  of use; `chart.js` must stay off the critical path. Check with the entry chunk plus
  every `modulepreload` in `dist/index.html`, not by reading the chunk list.
- **Token refresh is single-flight.** Five parallel 401s must trigger one refresh; the
  losers await the same promise. Without it four of them rotate an already-rotated
  token, trip reuse detection, and log the user out.
- User-facing strings go through `t()`. Server messages arrive bilingual as
  `"عربي - English"` and `localiseServerMessage()` picks the half to show.

## Relationship to Collex System V1

There is a separate, unrelated product — a debt-collection system — in another
directory. **Nothing here reads from or writes to it.** They share an author, a
Bootstrap version and some naming, and nothing else. Ports are deliberately offset
(this one: API 5100, client 5174, Postgres 5434, Redis 6381, web 8080) so both can run
at once.

Two of its conventions are actively **wrong here** and easy to import by muscle
memory:

- Its nginx strips `/api/`. This one must not.
- Its layout is unconditionally RTL with only text swapping. This one really flips.

## Where to look

| Question | File |
| --- | --- |
| how is a tenant enforced | `server/src/prisma/tenant-guard.ts` |
| who may move a case to X | `server/src/investigations/case-status.machine.ts` |
| why is this case red | `server/src/investigations/sla.util.ts` |
| why was my row rejected | `server/src/imports/utils/row-validator.ts` |
| why is this header not mapping | `server/src/imports/utils/field-catalog.ts` |
| why is this investigator not suggested | `server/src/assignments/auto-assign.engine.ts` |
| why did that 403 | `server/src/common/guards/permissions.guard.ts` |
| how a client's template becomes an import | `server/src/clients/clients.util.ts` |
| who can create a company | `server/src/tenants/tenants.controller.ts` |
| how is the operator account made | `server/prisma/seed-platform-admin.ts` |
| how does direction flip | `client/src/i18n/index.js` |
| why did my request retry | `client/src/services/api.js` |
