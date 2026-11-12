"""Application configuration loaded from environment variables.

All configuration lives here; no module should read ``os.environ`` directly.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, model_validator
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

    app_name: str = "GoFindr API"
    app_env: Literal["development", "test", "staging", "beta", "production"] = "development"
    # Cricket-only TestFlight beta: when set, only this sport is offered, other sports' APIs answer 404 and
    # profiles are read as this sport. Nothing is deleted; clear the flag to re-enable every sport.
    gofindr_beta_sport: Literal["cricket", "badminton", "pickleball"] | None = None
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
    # Must exceed a replica-set election (~10-12 s) so requests wait for the new primary instead of failing.
    mongodb_server_selection_timeout_ms: int = Field(default=15_000, ge=1_000, le=60_000)
    mongodb_max_pool_size: int = Field(default=100, ge=5, le=1_000)

    # Auth
    jwt_secret: str = _INSECURE_DEFAULT
    jwt_issuer: str = "gofindr"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 30
    otp_ttl_seconds: int = 300
    otp_max_attempts: int = 5
    otp_max_sends_per_hour: int = 5
    otp_resend_cooldown_seconds: int = 60
    login_max_failures: int = Field(default=8, description="Failed password logins per account before a lockout")
    login_lockout_minutes: int = 15
    # OTP spend budgets — enforced only for senders that cost money (see app/modules/auth/abuse.py)
    otp_allowed_prefixes: list[str] = Field(default_factory=lambda: ["+91"])
    otp_max_sends_per_day: int = 10
    otp_ip_max_sends_per_hour: int = 20
    otp_daily_budget: int = Field(
        default=1000, description="Global paid OTP sends per 24h; refuses at 100%, alerts at 80%"
    )
    session_absolute_days: int = Field(
        default=90, description="A refresh-token family older than this must log in again"
    )
    refresh_reuse_grace_seconds: int = Field(
        default=10,
        description="A rotated refresh token replayed within this window, while its successor is still unused, gets a "
        "fresh pair instead of revoking the family (page reloads and killed apps race their own rotation). "
        "Replays after the window, or after the successor was used, still revoke everything.",
    )
    rate_limiter_backend: Literal["memory", "mongo"] = "memory"  # "mongo" shares limits across API instances
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
    app_base_url: str | None = Field(default=None, description="Where the GoFindr app is served, for links in messages")

    # Ground search (GET /venues). "osm" is free and needs no account; "google" is the Maps data but is
    # billed per request and needs a key — see app/infrastructure/integrations/places.py.
    places_provider: Literal["osm", "google", "none"] = "osm"
    places_api_key: str | None = None
    places_country: str = Field(default="in", description="ISO-3166 alpha-2 filter for place suggestions; '' = world")
    places_cache_hours: int = Field(default=24, ge=0, le=720, description="How long a provider answer is reused")

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
    media_link_ttl_seconds: int = 48 * 3600  # signed media links in API responses expire after this
    max_request_bytes: int = 512 * 1024  # JSON bodies; uploads use max_upload_bytes
    cloudinary_url: str | None = None

    # Push / email
    push_provider: Literal["none", "expo", "fcm"] = "none"  # "expo" = Expo Push Service (FCM/APNs keys live in EAS)
    expo_push_access_token: str | None = None  # only if push security is enabled on the Expo account
    fcm_project_id: str | None = None
    fcm_service_account_json: str | None = None

    # AI (optional, advisory only)
    anthropic_api_key: str | None = None
    ai_model: str = "claude-opus-5-5"

    # Email codes for sign-up and password reset (app/infrastructure/integrations/email.py).
    # DEFERRED: phone OTP is the only verification in this release. Emails are collected but not verified,
    # and no email codes or links are sent, until EMAIL_OTP_ENABLED=true is set deliberately.
    email_otp_enabled: bool = False
    # Legacy invite-link sign-up (name, number, email, password, no SMS code). Off: anyone holding a shared link
    # could open an account on someone else's number. Invited players sign up with an SMS code instead and the
    # invite opens afterwards. Existing invite-link accounts keep working either way.
    invite_register_enabled: bool = False
    # console = dev adapter (nothing sent) | smtp = real delivery | none = email codes off
    email_provider: Literal["console", "smtp", "none"] = "console"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    email_from: str | None = Field(default=None, description='Sender, e.g. "GoFindr <yourname@gmail.com>"')
    email_otp_max_sends_per_hour: int = 5
    email_otp_max_sends_per_day: int = 10
    email_otp_daily_budget: int = Field(default=300, description="Global email codes per 24h (Brevo free plan size)")

    # Dev OTP adapter: return the code in the API response (dev/test only). Set false whenever the
    # dev server is reachable by others (e.g. a public tunnel); codes are then never shown or logged.
    dev_otp_in_response: bool = True
    # Friends/beta testing without SMS: NEW accounts on numbers with this prefix (use the reserved fictional
    # range "+447700900") see their sign-up code on screen and must set a password to log back in.
    # Login codes are never shown, so testers can't enter each other's accounts. Refused in production.
    tester_signup_prefix: str | None = None

    # CricHeroes team data. Only "disabled" exists: there is no public API and scraping is
    # prohibited by their terms. See app/infrastructure/integrations/cricheroes.py.
    cricheroes_source: Literal["disabled"] = "disabled"

    # Agreement
    agreement_required: bool = True

    # Legal identity shown in the Terms and Privacy Notice (DPDP Act 2023 / IT Rules 2021).
    # Required in production; placeholders are shown elsewhere so drafts are obvious.
    legal_entity_name: str | None = None  # registered company name that operates GoFindr (the Data Fiduciary)
    legal_entity_address: str | None = None  # registered office address
    grievance_officer_name: str | None = None
    grievance_email: str | None = None  # privacy and grievance requests
    legal_jurisdiction: str = "Noida, Uttar Pradesh"  # courts for disputes
    legal_effective_date: str = "9 November 2026"

    @model_validator(mode="after")
    def _blank_tester_prefix(self) -> "Settings":
        # An empty TESTER_SIGNUP_PREFIX= would otherwise match every number; treat it as "off".
        if self.tester_signup_prefix is not None and not self.tester_signup_prefix.strip():
            self.tester_signup_prefix = None
        return self

    @model_validator(mode="after")
    def _validate_production(self) -> "Settings":
        if self.app_env == "staging":  # TestFlight backend: real secrets, no debug, never shows codes
            staging: list[str] = []
            if self.jwt_secret == _INSECURE_DEFAULT or len(self.jwt_secret) < 32:
                staging.append("JWT_SECRET must be a strong secret (>=32 chars) in staging")
            if self.debug:
                staging.append("DEBUG must be false in staging")
            if staging:
                raise ValueError("; ".join(staging))
        if self.app_env in ("beta", "production"):  # beta serves real users: same guards as production
            problems: list[str] = []
            if self.jwt_secret == _INSECURE_DEFAULT or len(self.jwt_secret) < 32:
                problems.append("JWT_SECRET must be a strong secret (>=32 chars)")
            if self.whatsapp_provider == "simulator":
                problems.append("WHATSAPP_PROVIDER=simulator is not allowed in production")
            if self.otp_provider == "console":
                problems.append("OTP_PROVIDER=console is not allowed in production")
            if self.email_otp_enabled and self.email_provider == "console":
                problems.append("EMAIL_PROVIDER=console is not allowed in production (use smtp or none)")
            if self.debug:
                problems.append("DEBUG must be false in production")
            if self.tester_signup_prefix:
                problems.append(f"TESTER_SIGNUP_PREFIX must not be set in {self.app_env}")
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
