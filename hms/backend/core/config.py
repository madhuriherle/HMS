from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "HMS MMA Backend"
    API_V1_STR: str = "/api/v1"
    # development | production — production enforces a strong SECRET_KEY
    ENVIRONMENT: str = "development"

    # Database
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/hms_mma"

    # JWT
    SECRET_KEY: str = "CHANGE_THIS_TO_A_VERY_LONG_RANDOM_SECRET_KEY"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS — comma separated list of origins, or "*" for any origin
    CORS_ORIGINS: str = "*"

    # File Upload
    UPLOAD_DIR: str = "uploads"
    MAX_FILE_SIZE_MB: int = 10

    # Bootstrap admin — created on first start when the users table is empty
    BOOTSTRAP_ADMIN_USERNAME: str = "admin"
    BOOTSTRAP_ADMIN_PASSWORD: Optional[str] = None
    BOOTSTRAP_ADMIN_EMAIL: Optional[str] = None

    # WhatsApp Provider (Gupshup / Wati / Twilio)
    WHATSAPP_PROVIDER: str = "gupshup"  # gupshup | wati | twilio
    WHATSAPP_API_URL: Optional[str] = None
    WHATSAPP_API_KEY: Optional[str] = None
    WHATSAPP_FROM_NUMBER: Optional[str] = None
    # Shared secret the provider must send in X-Callback-Secret.
    # While unset, delivery callbacks are rejected.
    WHATSAPP_CALLBACK_SECRET: Optional[str] = None

    # Twilio (only used when WHATSAPP_PROVIDER=twilio)
    TWILIO_ACCOUNT_SID: Optional[str] = None
    TWILIO_AUTH_TOKEN: Optional[str] = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origins(self) -> list:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


PLACEHOLDER_SECRET = "CHANGE_THIS_TO_A_VERY_LONG_RANDOM_SECRET_KEY"

def validate_secret_key(settings: "Settings") -> None:
    """Refuse to boot with a placeholder/short JWT secret in production."""
    secret = settings.SECRET_KEY or ""
    if settings.ENVIRONMENT.lower() == "production" and (
        secret == PLACEHOLDER_SECRET or len(secret) < 32
    ):
        raise RuntimeError(
            "SECRET_KEY must be set to a random value of at least 32 characters "
            "when ENVIRONMENT=production. Generate one with: "
            "python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )

settings = Settings()
