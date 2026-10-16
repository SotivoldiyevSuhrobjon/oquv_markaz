import re

from django.core.exceptions import ValidationError


class ComplexityValidator:
    """Parol katta va kichik harf hamda raqamdan iborat bo'lishi shart."""

    def validate(self, password, user=None):
        if not (re.search(r"[A-Z]", password) and re.search(r"[a-z]", password) and re.search(r"\d", password)):
            raise ValidationError("Parolda katta harf, kichik harf va raqam bo'lishi shart.", code="weak_password")

    def get_help_text(self):
        return "Parol kamida 8 belgi: katta va kichik harf hamda raqam."
