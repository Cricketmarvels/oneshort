"""Push notification providers (Firebase Cloud Messaging)."""

from typing import Any, Protocol

from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger("push")


class PushProvider(Protocol):
    configured: bool

    async def send(self, tokens: list[str], title: str, body: str, data: dict[str, str]) -> None: ...


class NullPushProvider:
    """DEVELOPMENT ADAPTER: push disabled. In-app notifications still work."""

    configured = False

    async def send(self, tokens: list[str], title: str, body: str, data: dict[str, str]) -> None:
        if tokens:
            log.debug("push.skipped_unconfigured", count=len(tokens))


class FcmPushProvider:
    """FCM HTTP v1 adapter. UNCONFIGURED: requires FCM_PROJECT_ID and a service account.

    The OAuth access token for the service account should be minted with
    google-auth; that dependency is added when credentials are available.
    """

    configured = True

    def __init__(self, project_id: str, service_account_json: str) -> None:
        self.project_id = project_id
        self.service_account_json = service_account_json

    async def send(self, tokens: list[str], title: str, body: str, data: dict[str, str]) -> None:
        # Intentionally not claiming delivery. Implementation outline:
        # POST https://fcm.googleapis.com/v1/projects/{project_id}/messages:send per token
        # with {"message": {"token": t, "notification": {...}, "data": data}}.
        raise NotImplementedError("FCM adapter requires service-account credentials to be configured")


def build_push_provider(settings: Settings) -> PushProvider:
    if settings.push_provider == "fcm" and settings.fcm_project_id and settings.fcm_service_account_json:
        return FcmPushProvider(settings.fcm_project_id, settings.fcm_service_account_json)
    return NullPushProvider()


def stringify(data: dict[str, Any]) -> dict[str, str]:
    return {k: str(v) for k, v in data.items() if v is not None}
