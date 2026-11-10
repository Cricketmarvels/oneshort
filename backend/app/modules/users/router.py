from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.dependencies import ContainerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.modules.users.registration import complete_registration
from app.modules.users.schemas import CompleteRegistrationIn, DeleteAccountIn, DeviceIn, UpdateMeIn, UserOut
from app.modules.users.service import UserService

router = APIRouter(prefix="/users", tags=["Users"], responses=ERROR_RESPONSES)


def service(c: ContainerDep) -> UserService:
    return UserService(c)


Svc = Annotated[UserService, Depends(service)]


@router.get("/me", response_model=Envelope[UserOut], summary="Current user")
async def get_me(user: UserDep, svc: Svc) -> Envelope[UserOut]:
    return ok(await svc.to_out(user.doc))


@router.put("/me", response_model=Envelope[UserOut], summary="Update current user")
async def update_me(data: UpdateMeIn, user: UserDep, svc: Svc) -> Envelope[UserOut]:
    return ok(await svc.update_me(user, data))


@router.post(
    "/me/registration",
    response_model=Envelope[UserOut],
    summary="Finish sign-up (name, email, Player or Captain) once the mobile number is verified",
)
async def finish_registration(
    data: CompleteRegistrationIn, user: UserDep, svc: Svc, c: ContainerDep
) -> Envelope[UserOut]:
    return ok(await svc.to_out(await complete_registration(c, user, data)))


class WhatsAppTestOut(BaseModel):
    status: str = Field(description="sent | failed | not_configured | opted_out | no_number")


@router.post(
    "/me/whatsapp-test", response_model=Envelope[WhatsAppTestOut], summary="Send myself a test WhatsApp message"
)
async def whatsapp_test(user: UserDep, c: ContainerDep) -> Envelope[WhatsAppTestOut]:
    doc = user.doc
    if not (doc.get("notification_prefs") or {}).get("whatsapp"):
        return ok(WhatsAppTestOut(status="opted_out"))
    if not doc.get("mobile_number"):
        return ok(WhatsAppTestOut(status="no_number"))
    if not c.whatsapp.configured:
        return ok(WhatsAppTestOut(status="not_configured"))
    first = user.full_name.split()[0]
    title, body = "WhatsApp is connected", f"Hi {first}, you'll get GoFindr match updates here."
    link = c.settings.app_base_url or c.settings.web_base_url
    status = await c.whatsapp.send(doc["mobile_number"], f"GoFindr · {title}\n{body}", [title, body, link], "notify")
    return ok(WhatsAppTestOut(status=status))


@router.post("/me/devices", status_code=204, summary="Register a push notification device token")
async def register_device(data: DeviceIn, user: UserDep, svc: Svc) -> None:
    await svc.register_device(user, data)


@router.delete("/me/devices/{push_token:path}", status_code=204, summary="Forget this device's push token (logout)")
async def unregister_device(push_token: str, user: UserDep, svc: Svc) -> None:
    await svc.unregister_device(user, push_token)


@router.get("/me/export", response_model=Envelope[dict[str, Any]], summary="Export my data (privacy)")
async def export_me(user: UserDep, svc: Svc) -> Envelope[dict[str, Any]]:
    return ok(await svc.export_data(user))


@router.delete("/me", status_code=204, summary="Delete my account (anonymises personal data)")
async def delete_me(data: DeleteAccountIn, user: UserDep, svc: Svc) -> None:
    await svc.delete_account(user, data.reason)
