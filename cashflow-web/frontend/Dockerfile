# Cashflow-web React/Vite frontend.
#
# Multi-stage: (1) build the static SPA with Node, (2) serve it with nginx,
# which ALSO reverse-proxies /api/* to the backend container on the internal
# Docker network. This is the same-origin production model — the browser sees
# one origin (this nginx host:port), so the HttpOnly session cookie works with
# NO CORS. The app's api client uses relative /api paths, so no API host is
# baked in at build time (do NOT set VITE_API_PROXY — that is dev-only).
#
# No secrets live in this image: the frontend is static files + cookie auth.
#
# Build context is cashflow-web/ (the parent of frontend/), so this Dockerfile
# can reach BOTH the frontend source (frontend/) and the shared nginx config
# (docker/nginx.conf). See compose.cashflow.yml:
#   build: { context: .., dockerfile: frontend/Dockerfile }

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

# Install deps from the lockfile first (cached unless package*.json changes).
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Copy the rest of the frontend source and produce the static bundle in
# /app/dist. The build needs no backend at build time.
COPY frontend/ ./
RUN npm run build

# ── Stage 2: serve ───────────────────────────────────────────────────────────
FROM nginx:alpine

# Static SPA bundle.
COPY --from=build /app/dist /usr/share/nginx/html

# nginx config: serve the SPA (with fallback) + proxy /api → backend:8000.
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
