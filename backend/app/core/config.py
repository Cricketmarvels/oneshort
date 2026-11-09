"""Application configuration loaded from environment variables.

All configuration lives here; no module should read ``os.environ`` directly.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_DEFAULT = "change-me-dev-only-secret-change-me-dev-only"


class RankingWeights(BaseSettings):
    """Weights for the deterministic player ranking engine (normalised at runtime)."""

    model_config = SettingsConfigDict(env_prefix="RANK_W_", extra="ignore")

    proximity: float = 0.25
    availability: float = 0.20
    role: float = 0.15
    rating: float = 0.12
    reliability: float = 0.13
    participation: float = 0.08
    response_rate: float = 0.07


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "CricketMarvels Play API"
    app_env: Literal["development", "test", "staging", "production"] = "development"
    debug: bool = False
    log_level: str = "INFO"
    sentry_dsn: str | None = None  # error tracking is off unless set
    sentry_release: str | None = None  # e.g. the git commit, so errors map to a deploy
    sentry_traces_sample_rate: float = Field(default=0.05, ge=0, le=1)
    api_prefix: str = "/api/v1"
    public_base_url: str = "http://localhost:8000"
    web_base_url: str = "http://localhost:5173"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"])

    # Database
    mongodb_uri: str = "mongodb://127.0.0.1:27018/?replicaSet=rs0"
    mongodb_db: str = "cricket_platform"

    # Auth
    jwt_secret: str = _INSECURE_DEFAULT
    jwt_issuer: str = "cricketmarvels-play"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 30
    otp_ttl_seconds: int = 300
    otp_max_attempts: int = 5
    otp_max_sends_per_hour: int = 5
    otp_resend_cooldown_seconds: int = 30
    login_max_failures: int = Field(default=8, description="Failed password logins per account before a lockout")
    login_lockout_minutes: int = 15
    otp_provider: Literal["console", "msg91", "twilio"] = "console"
    msg91_auth_key: str | None = None
    msg91_template_id: str | None = None
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_number: str | None = None

    # WhatsApp (match invitations). "none" sends nothing; real providers need credentials + a tested template.
    whatsapp_provider: Literal["none", "twilio", "meta", "simulator"] = "none"
    # Required to read another number's simulated inbox before login (simulator mode only)
    whatsapp_simulator_key: str | None = None
    twilio_whatsapp_from: str | None = None
    # Approved Twilio Content templates (needed outside WhatsApp's 24-hour window): {{1}}.. = message params
    twilio_content_otp_sid: str | None = None
    twilio_content_notify_sid: str | None = None
    twilio_content_invite_sid: str | None = None
    whatsapp_meta_token: str | None = None
    whatsapp_meta_phone_number_id: str | None = None
    whatsapp_meta_template: str | None = None  # match invitation template
    whatsapp_meta_notify_template: str | None = None  # notification template: {{1}} title, {{2}} body, {{3}} link
    whatsapp_meta_otp_template: str | None = None  # authentication template: {{1}} code (+ copy-code button)
    whatsapp_meta_language: str = "en"
    whatsapp_meta_api_version: str = "v25.0"  # Graph API version (v25.0 supported until July 2028)
    whatsapp_webhook_verify_token: str | None = None  # random string you also enter in Meta's webhook settings
    whatsapp_meta_app_secret: str | None = None  # App settings → Basic → App secret (verifies webhook signatures)
    whatsapp_meta_waba_id: str | None = None  # WhatsApp Business Account id — only for scripts.whatsapp_meta_setup
    app_base_url: str | None = Field(default=None, description="Where the PlayR app is served, for links in messages")

    # Rate limiting (requests per minute)
    rate_limit_auth_per_minute: int = 10
    rate_limit_default_per_minute: int = 240

    # Discovery
    discovery_candidate_cap: int = 500
    discovery_allowed_radii_km: list[int] = Field(default_factory=lambda: [5, 10, 15, 20])
    discovery_partial_overlap_min: float = 0.5
    ranking: RankingWeights = Field(default_factory=RankingWeights)

    # Invitations / matches
    invitation_ttl_hours: int = 48
    rating_window_days: int = 14
    late_withdrawal_hours: int = 24
    scheduler_enabled: bool = True
    scheduler_interval_seconds: int = 60

    # Storage
    storage_provider: Literal["local", "cloudinary"] = "local"
    local_upload_dir: str = "uploads"
    max_upload_bytes: int = 5 * 1024 * 1024
    max_request_bytes: int = 512 * 1024  # JSON bodies; uploads use max_upload_bytes
    cloudinary_url: str | None = None

    # Push / email
    push_provider: Literal["none", "fcm"] = "none"
    fcm_project_id: str | None = None
    fcm_service_account_json: str | None = None
    email_provider: Literal["console", "smtp"] = "console"

    # AI (optional, advisory only)
    anthropic_api_key: str | None = None
    ai_model: str = "claude-opus-5-5"

    # Dev OTP adapter: return the code in the API response (dev/test only). Set false whenever the
    # dev server is reachable by others (e.g. a public tunnel); codes are then never shown or logged.
    dev_otp_in_response: bool = True

    # CricHeroes team data. Only "disabled" exists: there is no public API and scraping is
    # prohibited by their terms. See app/infrastructure/integrations/cricheroes.py.
    cricheroes_source: Literal["disabled"] = "disabled"

    # Agreement
    agreement_required: bool = True

    # Legal identity shown in the Terms and Privacy Notice (DPDP Act 2023 / IT Rules 2021).
    # Required in production; placeholders are shown elsewhere so drafts are obvious.
    legal_entity_name: str | None = None  # registered company name that operates PlayR (the Data Fiduciary)
    legal_entity_address: str | None = None  # registered office address
    grievance_officer_name: str | None = None
    grievance_email: str | None = None  # privacy and grievance requests
    legal_jurisdiction: str = "Noida, Uttar Pradesh"  # courts for disputes
    legal_effective_date: str = "9 November 2026"

    @model_validator(mode="after")
    def _validate_production(self) -> "Settings":
        if self.app_env == "production":
            problems: list[str] = []
            if self.jwt_secret == _INSECURE_DEFAULT or len(self.jwt_secret) < 32:
                problems.append("JWT_SECRET must be a strong secret (>=32 chars)")
            if self.whatsapp_provider == "simulator":
                problems.append("WHATSAPP_PROVIDER=simulator is not allowed in production")
            if self.otp_provider == "console":
                problems.append("OTP_PROVIDER=console is not allowed in production")
            if self.debug:
                problems.append("DEBUG must be false in production")
            for field in ("legal_entity_name", "legal_entity_address", "grievance_officer_name", "grievance_email"):
                if not getattr(self, field):
                    problems.append(
                        f"{field.upper()} is required in production (shown in the Terms and Privacy Notice)"
                    )
            if problems:
                raise ValueError("; ".join(problems))
        return self

    @property
    def is_dev_like(self) -> bool:
        return self.app_env in ("development", "test")


@lru_cache
def get_settings() -> Settings:
    return Settings()
