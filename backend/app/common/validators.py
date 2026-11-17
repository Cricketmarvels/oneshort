import re
from datetime import date
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AfterValidator, StringConstraints

_E164 = re.compile(r"^\+[1-9]\d{7,14}$")


def _mobile(v: str) -> str:
    v = re.sub(r"[\s-]", "", v)
    if re.fullmatch(r"[6-9]\d{9}", v):  # bare Indian mobile -> +91
        v = "+91" + v
    if not _E164.match(v):
        raise ValueError("must be a valid mobile number in international format, e.g. +919876543210")
    return v


def _tz(v: str) -> str:
    try:
        ZoneInfo(v)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("must be a valid IANA timezone, e.g. Asia/Kolkata") from exc
    return v


def _password(v: str) -> str:
    if len(v) < 8 or not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
        raise ValueError("must be at least 8 characters and include a letter and a digit")
    return v


def _strong_password(v: str) -> str:
    if len(v) < 12 or not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
        raise ValueError("must be at least 12 characters and include a letter and a digit")
    return v


def _date_of_birth(v: date) -> date:
    today = date.today()
    years = today.year - v.year - ((today.month, today.day) < (v.month, v.day))
    if years < 18:
        raise ValueError("you must be 18 or older to use OneShort")
    if years > 100:
        raise ValueError("enter a valid date of birth")
    return v


def _https_url(v: str) -> str:
    if not re.match(r"^https?://", v):
        raise ValueError("must be an http(s) URL")
    return v


MobileNumber = Annotated[str, AfterValidator(_mobile)]
Timezone = Annotated[str, AfterValidator(_tz)]
Password = Annotated[str, StringConstraints(max_length=128), AfterValidator(_password)]
StrongPassword = Annotated[str, StringConstraints(max_length=128), AfterValidator(_strong_password)]
DateOfBirth = Annotated[date, AfterValidator(_date_of_birth)]
Name = Annotated[str, StringConstraints(min_length=2, max_length=80, strip_whitespace=True)]
ShortText = Annotated[str, StringConstraints(max_length=200, strip_whitespace=True)]
#: A UPI ID (VPA) such as ``rahul@okaxis`` or ``9876543210@ybl``: where players send a match fee.
UpiId = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        max_length=100,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9.\-_]{1,99}@[A-Za-z][A-Za-z0-9.\-]{1,49}$",
    ),
]
LongText = Annotated[str, StringConstraints(max_length=2000, strip_whitespace=True)]
Url = Annotated[str, StringConstraints(max_length=500), AfterValidator(_https_url)]
Otp = Annotated[str, StringConstraints(pattern=r"^\d{6}$")]
