#!/bin/sh
# Container entrypoint for the cashflow-web FastAPI backend.
#
# 1. Apply Alembic migrations (Postgres must be reachable — compose orders this
#    after `postgres` is healthy via depends_on, but we add a short retry loop in
#    case the DB accepts the healthcheck a beat before it accepts our connection).
# 2. Hand off to uvicorn (PID 1 via exec) which runs the FastAPI app; the app
#    lifespan seeds the owner user and starts the nightly APScheduler.
set -eu

echo "[entrypoint] applying database migrations (alembic upgrade head)..."

attempt=1
max_attempts=10
until alembic upgrade head; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "[entrypoint] alembic upgrade failed after ${max_attempts} attempts — aborting." >&2
    exit 1
  fi
  echo "[entrypoint] alembic upgrade failed (attempt ${attempt}/${max_attempts}); retrying in 3s..." >&2
  attempt=$((attempt + 1))
  sleep 3
done

echo "[entrypoint] migrations applied. starting uvicorn on 0.0.0.0:8000..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
