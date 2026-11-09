"""FastAPI dependencies: container access, authentication, RBAC and agreement gating."""

from dataclasses import dataclass
from typing import Annotated, Any

from bson import ObjectId
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.common.enums import AccountStatus, Role
from app.common.types import ensure_utc, utcnow
from app.core.container import Container
from app.core.exceptions import AgreementRequired, Forbidden, Unauthorized
from app.core.observability import tag_user
from app.core.security import decode_access_token

_bearer = HTTPBearer(auto_error=False)


def get_container(request: Request) -> Container:
    container: Container = request.app.state.container
    return container


ContainerDep = Annotated[Container, Depends(get_container)]


@dataclass(frozen=True)
class CurrentUser:
    id: ObjectId
    roles: list[str]
    account_status: str
    full_name: str
    doc: dict[str, Any]
    request_id: str | None = None
    session_family: str | None = None

    @property
    def is_admin(self) -> bool:
        return Role.ADMIN.value in self.roles


async def get_current_user(
    request: Request,
    c: ContainerDep,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> CurrentUser:
    if creds is None or creds.scheme.lower() != "bearer":
        raise Unauthorized("Authentication required")
    payload = decode_access_token(c.settings, creds.credentials)
    try:
        uid = ObjectId(payload["sub"])
    except Exception as exc:
        raise Unauthorized("Invalid token subject", code="TOKEN_INVALID") from exc
    user = await c.mongo["users"].find_one({"_id": uid})
    if not user or user.get("account_status") == AccountStatus.DELETED:
        raise Unauthorized("Account not found", code="ACCOUNT_NOT_FOUND")
    status = user.get("account_status", AccountStatus.ACTIVE)
    if status == AccountStatus.SUSPENDED:
        until = user.get("suspended_until")
        if until and until <= utcnow():
            await c.mongo["users"].update_one(
                {"_id": uid, "account_status": AccountStatus.SUSPENDED},
                {"$set": {"account_status": AccountStatus.ACTIVE, "suspended_until": None}},
            )
            status = AccountStatus.ACTIVE
        else:
            raise Forbidden("Your account is suspended", code="ACCOUNT_SUSPENDED")
    valid_after = user.get("sessions_valid_after")
    if valid_after is not None and int(payload.get("iat", 0)) < int(ensure_utc(valid_after).timestamp()):
        # "Sign out everywhere": access tokens minted before the cut-off die immediately, not at expiry.
        raise Unauthorized("You were signed out on this device", code="TOKEN_REVOKED")
    tag_user(str(uid))  # error reports carry the internal id only
    return CurrentUser(
        id=uid,
        roles=list(user.get("roles", [])),
        account_status=status,
        full_name=user.get("full_name", ""),
        doc=user,
        request_id=getattr(request.state, "request_id", None),
        session_family=payload.get("fam"),
    )


UserDep = Annotated[CurrentUser, Depends(get_current_user)]


async def require_admin(user: UserDep) -> CurrentUser:
    if not user.is_admin:
        raise Forbidden("Administrator access required")
    return user


AdminDep = Annotated[CurrentUser, Depends(require_admin)]


async def latest_material_version(c: Container) -> int | None:
    doc = await c.mongo["agreements"].find_one(
        {"is_material": True, "published_at": {"$lte": utcnow()}}, sort=[("version", -1)]
    )
    return int(doc["version"]) if doc else None


async def agreement_satisfied(c: Container, user_doc: dict[str, Any]) -> bool:
    required = await latest_material_version(c)
    if required is None:
        return True
    accepted = user_doc.get("agreement_version_accepted")
    return accepted is not None and int(accepted) >= required


async def require_matchmaking(user: UserDep, c: ContainerDep) -> CurrentUser:
    """Gate for every matchmaking feature: accepted agreement + not restricted."""
    if user.account_status == AccountStatus.RESTRICTED:
        raise Forbidden("Matchmaking access has been restricted on your account", code="MATCHMAKING_RESTRICTED")
    if c.settings.agreement_required and not await agreement_satisfied(c, user.doc):
        raise AgreementRequired("Please accept the Platform User Agreement to continue")
    return user


MatchmakerDep = Annotated[CurrentUser, Depends(require_matchmaking)]
