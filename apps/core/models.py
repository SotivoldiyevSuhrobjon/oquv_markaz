from django.conf import settings
from django.db import models


class Setting(models.Model):
    """Yagona (singleton) sozlamalar qatori."""

    max_group_size = models.PositiveSmallIntegerField(default=15)
    default_rate = models.PositiveIntegerField(
        default=75000,
        help_text="1 soatlik dars uchun 1 o'quvchining oylik ulushi (so'm); 2 soatlik dars = 2 baravar. Oydagi darslar soniga bo'linadi, faqat kelgan darslar to'lanadi",
    )
    default_price = models.PositiveIntegerField(default=600000, help_text="Fan biriktirilmagan o'quvchi uchun oylik narx")
    academic_start = models.CharField(max_length=7, default="2026-09", help_text="O'quv yili boshlanishi, YYYY-MM")
    academic_months = models.PositiveSmallIntegerField(default=10)
    alert_threshold = models.PositiveSmallIntegerField(default=3, help_text="Shuncha darsdan ko'p qoldirsa ota-ona bilan bog'lanish kerak")
    auto_next_month = models.BooleanField(default=True, help_text="Oy tugagach yangi oy avtomatik ochiladi")
    auto_close_month = models.BooleanField(default=False, help_text="O'tgan oylar (davomati yakunlangan bo'lsa) avtomatik yopiladi")

    class Meta:
        verbose_name = "Sozlama"
        verbose_name_plural = "Sozlamalar"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get(cls) -> "Setting":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class AuditLog(models.Model):
    """O'zgartirilmas tarix: kim, qachon, nima qildi."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    username = models.CharField(max_length=150, blank=True)
    action = models.CharField(max_length=60, db_index=True)
    target = models.CharField(max_length=120, blank=True)
    detail = models.TextField(blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name = "Tarix yozuvi"
        verbose_name_plural = "Tarix"

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.username} {self.action}"
