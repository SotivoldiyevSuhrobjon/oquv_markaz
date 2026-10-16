from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.exceptions import ValidationError
from rest_framework.views import exception_handler


class BusinessError(Exception):
    """Biznes qoidasi buzilganda (masalan, yopilgan oyga to'lov)."""

    def __init__(self, message: str, code: str = "business_error"):
        super().__init__(message)
        self.message, self.code = message, code


def api_exception_handler(exc, context):
    if isinstance(exc, BusinessError):
        exc = ValidationError({"detail": exc.message}, code=exc.code)
    elif isinstance(exc, DjangoValidationError):
        exc = ValidationError(exc.message_dict if hasattr(exc, "error_dict") else {"detail": exc.messages})
    return exception_handler(exc, context)
