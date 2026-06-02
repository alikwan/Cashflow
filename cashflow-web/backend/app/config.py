from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# cashflow-web/.env — two levels above this file (backend/app/config.py → backend/app → backend → cashflow-web)
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ENV_FILE), extra="ignore")

    # قاعدة التطبيق (PostgreSQL)
    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_db: str = "cashflow"
    postgres_user: str = "cashflow"
    postgres_password: str = ""

    # قاعدة المحاسبة (SQL Server، قراءة فقط) — يقرأها ETL في المرحلة 1
    mssql_host: str = "mssql"
    mssql_port: int = 1433
    mssql_db: str = "AlBaytAlSaeid"
    mssql_readonly_user: str = "cashflow_ro"
    mssql_readonly_password: str = ""

    # التطبيق
    app_tz: str = "Asia/Baghdad"
    app_secret_key: str = ""
    etl_daily_at: str = "02:00"

    @property
    def postgres_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


settings = Settings()
