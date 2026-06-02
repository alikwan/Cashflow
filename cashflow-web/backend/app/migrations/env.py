from logging.config import fileConfig

from sqlalchemy import create_engine, pool

from alembic import context

# Alembic Config object — access to values in alembic.ini.
config = context.config

# Set up logging from alembic.ini (only when a config file is present).
# disable_existing_loggers=False: env.py is re-executed on every alembic command
# (the test suite calls upgrade/downgrade many times); the default True would
# silently mute any logger not listed in alembic.ini mid-session.
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# Import settings (falls back when ini URL is empty) and register all models.
from app.config import settings  # noqa: E402
from app.db.base import Base  # noqa: E402
import app.db.models  # noqa: E402, F401 — side-effect: registers all 20 tables on Base.metadata

target_metadata = Base.metadata

# Resolve the database URL (in priority order):
#   - Tests inject it via c.attributes["sqlalchemy.url"] = TEST_URL before calling
#     alembic.command.* — passed through config.attributes (NOT configparser), so a
#     password containing '%' can't trip BasicInterpolation.
#   - An explicit ini value (we leave it empty).
#   - Normal CLI use: falls back to settings.postgres_url (read directly, no interpolation).
url = (
    config.attributes.get("sqlalchemy.url")
    or config.get_main_option("sqlalchemy.url")
    or settings.postgres_url
)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL to stdout, no live DB needed)."""
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode (connects to the live DB)."""
    # Build the engine directly from `url` so we're not dependent on
    # engine_from_config reading an ini key that may be empty.
    connectable = create_engine(url, poolclass=pool.NullPool, future=True)

    try:
        with connectable.connect() as connection:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
            )
            with context.begin_transaction():
                context.run_migrations()
    finally:
        connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
