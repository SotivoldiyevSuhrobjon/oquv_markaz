from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from apps.academics.models import Student
from apps.core.utils import validate_month


class Payment(models.Model):
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="payments")
    month = models.CharField(max_length=7, validators=[validate_month], db_index=True)
    amount = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    paid_on = models.DateField()
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-paid_on", "-id"]
        indexes = [models.Index(fields=["student", "month"])]


class Discount(models.Model):
    """Chegirma (so'm). Belgilangan oydan boshlab amal qiladi; keyingi yozuv avvalgisini almashtiradi."""

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="discounts")
    from_month = models.CharField(max_length=7, validators=[validate_month])
    amount = models.PositiveIntegerField(default=0)
    set_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["from_month", "id"]
        constraints = [models.UniqueConstraint(fields=["student", "from_month"], name="uniq_discount_month")]


class MonthClosing(models.Model):
    """Oy yopilgach to'lov va chegirmani o'zgartirib bo'lmaydi; faqat admin qayta ochadi."""

    month = models.CharField(max_length=7, unique=True, validators=[validate_month])
    is_closed = models.BooleanField(default=True)
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    closed_at = models.DateTimeField(null=True, blank=True)
    reopened_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    reopened_at = models.DateTimeField(null=True, blank=True)


class CashEntry(models.Model):
    class Kind(models.TextChoices):
        IN = "kirim", "Kirim"
        OUT = "chiqim", "Chiqim"

    kind = models.CharField(max_length=6, choices=Kind.choices)
    category = models.CharField(max_length=40)
    amount = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    date = models.DateField()
    month = models.CharField(max_length=7, validators=[validate_month], db_index=True)
    staff = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    note = models.CharField(max_length=255, blank=True)
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]
