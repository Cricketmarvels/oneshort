"""Domain exceptions mapped to a consistent JSON error envelope."""

from typing import Any


class AppError(Exception):
    status_code = 400
    code = "BAD_REQUEST"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        details: list[dict[str, Any]] | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        self.details = details or []


class ValidationFailed(AppError):
    status_code = 422
    code = "VALIDATION_ERROR"


class Unauthorized(AppError):
    status_code = 401
    code = "UNAUTHORIZED"


class Forbidden(AppError):
    status_code = 403
    code = "FORBIDDEN"


class NotFound(AppError):
    status_code = 404
    code = "NOT_FOUND"


class Conflict(AppError):
    status_code = 409
    code = "CONFLICT"


class BusinessRuleViolation(AppError):
    status_code = 422
    code = "BUSINESS_RULE_VIOLATION"


class RateLimited(AppError):
    status_code = 429
    code = "RATE_LIMITED"


class IntegrationUnavailable(AppError):
    status_code = 503
    code = "INTEGRATION_NOT_CONFIGURED"


class AgreementRequired(AppError):
    status_code = 403
    code = "AGREEMENT_REQUIRED"
