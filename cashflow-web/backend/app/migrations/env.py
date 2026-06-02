from logging.config import fileConfig

from sqlalchemy import create_engine, pool

from alembic import context

# Alembic Config object — access to values in alembic.ini.
config = context.config

# Set up logging from alembic.ini (only when a config file is present).
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Import settings (falls back when ini URL is empty) and register all models.
from app.config import settings  # noqa: E402
from app.db.base import Base  # noqa: E402
import app.db.models  # noqa: E402, F401 — side-effect: registers all 20 tables on Base.metadata

target_metadata = Base.metadata

# Resolve the database URL:
#   - Tests override it via c.set_main_option("sqlalchemy.url", TEST_URL) before calling
#     alembic.command.*; that value wins here.
#   - Normal CLI use: ini value is empty ("") → falls back to settings.postgres_url.
url = config.get_main_option("sqlalchemy.url") or settings.postgres_url


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

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
