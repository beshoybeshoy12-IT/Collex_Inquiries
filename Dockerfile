# ═══════════════════════════════════════════════════════════════════════════
#  Collex Inquiries — multi-stage build
# ═══════════════════════════════════════════════════════════════════════════
#
#  Three targets:
#
#    runner — the NestJS API. `compose.yml` runs it twice from this one image:
#             once as the HTTP server, once as the BullMQ worker, chosen by the
#             ROLE environment variable. One image means the two halves cannot
#             drift; two entrypoints mean a 40-second PDF render never blocks a
#             request.
#
#    web    — nginx serving the built SPA and proxying /api and /realtime.
#
#  The API stage installs Chromium from Alpine's own package index rather than
#  letting Puppeteer download its bundled build: Puppeteer ships a glibc binary
#  that will not run on musl, and the download is 170 MB of it failing.
# ═══════════════════════════════════════════════════════════════════════════


# ─── 1. Server dependencies ────────────────────────────────────────────────
FROM node:22-alpine AS server-deps
WORKDIR /app

# Chromium comes from apk, so Puppeteer must not fetch its own.
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY server/package*.json ./
COPY .npmrc ./
RUN npm ci --no-audit --no-fund


# ─── 2. Build the server ───────────────────────────────────────────────────
FROM server-deps AS server-build
WORKDIR /app

COPY server/ ./
# `npm run build` is `prisma generate && nest build` — the build imports the
# generated client, so that order is not optional.
RUN npm run build


# ─── 3. Production server dependencies ─────────────────────────────────────
FROM node:22-alpine AS server-prod-deps
WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY server/package*.json ./
COPY .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund

# The Prisma client is generated code, not a published package — it has to be
# regenerated against the production tree.
#
# `./node_modules/.bin/prisma`, never `npx prisma`: when the CLI is not
# resolvable locally npx silently goes to the NETWORK and installs whatever is
# on the latest tag, which is currently a 8.0 release candidate whose command
# set no longer has `generate`. The build then fails with "No command
# registered for generate", which reads like a Prisma bug rather than a
# resolution problem. The prisma CLI is a runtime dependency of this image
# precisely because the entrypoint runs `migrate deploy` at boot.
COPY server/prisma ./prisma
RUN ./node_modules/.bin/prisma generate


# ─── 4. Build the client ───────────────────────────────────────────────────
FROM node:22-alpine AS client-build
WORKDIR /app

COPY client/package*.json ./
COPY .npmrc ./
RUN npm ci --no-audit --no-fund

COPY client/ ./
RUN npm run build


# ─── 5. The API / worker runtime ───────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Chromium and the fonts the Arabic PDF renderer needs. Without
# `font-noto-arabic` the report renders with the wrong face — or, worse, with
# disconnected Arabic letterforms, which is the classic failure of Arabic PDF
# generation and is only visible once somebody opens a real report.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      font-noto \
      font-noto-arabic \
      netcat-openbsd \
      tini \
    && rm -rf /var/cache/apk/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production

COPY --from=server-prod-deps /app/node_modules ./node_modules
COPY --from=server-build /app/dist ./dist
COPY server/prisma ./prisma
COPY server/package.json ./package.json
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /app/storage \
    && addgroup -S collex && adduser -S collex -G collex \
    && chown -R collex:collex /app

# Chromium must not run as root, and neither should a Node process that parses
# uploaded spreadsheets.
USER collex

EXPOSE 5100

# tini reaps the zombie processes Chromium leaves behind. Without an init, a
# container that renders a few hundred PDFs accumulates defunct processes until
# it cannot fork.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]


# ─── 6. The web tier ───────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS web

COPY --from=client-build /app/dist /usr/share/nginx/html
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/nginx-health || exit 1
