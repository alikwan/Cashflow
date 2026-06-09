# Cashflow-web FastAPI backend.
#
# Runtime: applies `alembic upgrade head` then runs uvicorn (app.main:app),
# whose lifespan seeds the owner user and starts the nightly APScheduler.
#
# Networking is supplied at runtime via env (compose overrides POSTGRES_HOST=postgres
# and MSSQL_HOST=mssql so the container reaches both DBs over the Docker network).
# No secrets are baked into the image.
FROM python:3.12-slim

# - PYTHONUNBUFFERED: stream logs immediately (so `docker logs` is live).
# - PYTHONDONTWRITEBYTECODE: no .pyc clutter in the image layer.
# - PIP_NO_CACHE_DIR: smaller image.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Copy project metadata + source. The bundled PDF font lives under
# app/api/fonts/ and the Alembic migrations under app/migrations/, so copying
# app/ + alembic.ini + pyproject.toml is sufficient for both runtime and
# `alembic upgrade head` (alembic.ini: script_location=%(here)s/app/migrations,
# prepend_sys_path=. — run from /app where alembic.ini lives).
COPY pyproject.toml ./
COPY alembic.ini ./
COPY app/ ./app/
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Install the project + pinned deps. pymssql>=2.3 ships manylinux cp312 wheels,
# so no build toolchain / FreeTDS dev headers are needed (wheel-only path).
RUN pip install --no-cache-dir . \
    && chmod +x ./docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./docker-entrypoint.sh"]
