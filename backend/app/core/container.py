"""Composition root: builds infrastructure singletons once per process.

Services are constructed per request from the container (see app/api/dependencies.py),
so tests can swap any adapter by replacing an attribute on the container.
"""

from dataclasses import dataclass, field

from app.core.config import Settings
from app.core.middleware import InMemoryRateLimiter, MongoRateLimiter
from app.infrastructure.database.mongo import Mongo
from app.infrastructure.integrations.ai import AIAssistant, build_ai_assistant
from app.infrastructure.integrations.cricheroes import CricHeroesSource, build_cricheroes_source
from app.infrastructure.integrations.email import DisabledEmailSender, EmailSender, build_email_sender
from app.infrastructure.integrations.push import PushProvider, build_push_provider
from app.infrastructure.integrations.sms import OtpSender, build_otp_sender
from app.infrastructure.integrations.storage import StorageProvider, build_storage
from app.infrastructure.integrations.whatsapp import DisabledWhatsApp, WhatsAppSender, build_whatsapp_sender
from app.infrastructure.realtime.hub import InProcessHub, RealtimeHub
from app.modules.audit.service import AuditService
from app.modules.notifications.service import NotificationService


@dataclass
class Container:
    settings: Settings
    mongo: Mongo
    otp_sender: OtpSender
    push: PushProvider
    storage: StorageProvider
    hub: RealtimeHub
    ai: AIAssistant
    cricheroes: CricHeroesSource
    whatsapp: WhatsAppSender = field(default_factory=lambda: DisabledWhatsApp())
    email: EmailSender = field(default_factory=lambda: DisabledEmailSender())
    limiter: InMemoryRateLimiter | MongoRateLimiter = field(default_factory=InMemoryRateLimiter)

    @property
    def audit(self) -> AuditService:
        return AuditService(self.mongo)

    @property
    def notifications(self) -> NotificationService:
        link = self.settings.app_base_url or self.settings.web_base_url
        return NotificationService(self.mongo, self.hub, self.push, self.whatsapp, link)


def build_container(settings: Settings) -> Container:
    mongo = Mongo(
        settings.mongodb_uri,
        settings.mongodb_db,
        server_selection_timeout_ms=settings.mongodb_server_selection_timeout_ms,
        max_pool_size=settings.mongodb_max_pool_size,
    )
    return Container(
        settings=settings,
        mongo=mongo,
        otp_sender=build_otp_sender(settings),
        push=build_push_provider(settings),
        storage=build_storage(settings),
        hub=InProcessHub(),
        ai=build_ai_assistant(settings),
        cricheroes=build_cricheroes_source(settings),
        whatsapp=build_whatsapp_sender(settings, mongo),
        email=build_email_sender(settings),
        limiter=MongoRateLimiter(mongo) if settings.rate_limiter_backend == "mongo" else InMemoryRateLimiter(),
    )
