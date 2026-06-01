from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# cashflow-web/.env — two levels above this file (backend/app/config.py → backend/app → backend → cashflow-web)
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ENV_FILE), extra="ignore")

    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_db: str = "cashflow"
    postgres_user: str = "cashflow"
    postgres_password: str = ""
    app_tz: str = "Asia/Baghdad"

    @property
    def postgres_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


settings = Settings()
