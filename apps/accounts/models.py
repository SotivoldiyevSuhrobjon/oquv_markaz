from django.contrib.auth.models import AbstractUser
from django.db import models

SECTIONS = ("dash", "att", "pay", "sal", "room", "stf", "new", "arch")
NONE, VIEW, EDIT = 0, 1, 2
EXTRA_SECTIONS = ("pay", "room", "stf", "new", "arch")

DEFAULT_PERMS = {
    "administrator": {"dash": EDIT, "att": EDIT, "pay": VIEW, "sal": NONE, "room": EDIT, "stf": VIEW, "new": EDIT, "arch": EDIT},
    "bugalter": {"dash": VIEW, "att": NONE, "pay": EDIT, "sal": EDIT, "room": NONE, "stf": NONE, "new": NONE, "arch": VIEW},
}


class Role(models.TextChoices):
    ADMIN = "admin", "Admin"
    ADMINISTRATOR = "administrator", "O'quv markaz administratori"
    BUGALTER = "bugalter", "Bugalter"
    TEACHER = "teacher", "O'qituvchi"
    SUPPORT = "support", "Support teacher"


class User(AbstractUser):
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.TEACHER)
    full_name = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    district = models.CharField("Tuman", max_length=60, blank=True)
    birth_date = models.DateField(null=True, blank=True)
    category = models.CharField("Yo'nalish (fan slug)", max_length=30, blank=True)
    rate = models.PositiveIntegerField(
        null=True, blank=True, help_text="Shaxsiy ulush: 1 soatlik dars uchun 1 o'quvchi/oyiga. Bo'sh bo'lsa umumiy ulush."
    )
    monthly_salary = models.PositiveIntegerField(default=0, help_text="Support teacher belgilangan oyligi")
    work_from = models.DateField(null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)
    description = models.TextField("Tavsif", max_length=2000, blank=True, help_text="Xodim haqida ma'lumot (tajriba, izoh)")
    perms = models.JSONField(default=dict, blank=True, help_text="Bo'lim -> 0 yo'q, 1 ko'rish, 2 tahrirlash")
    must_change_password = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["full_name", "username"]

    def __str__(self):
        return self.full_name or self.username

    @property
    def is_staff_member(self) -> bool:
        return self.role in (Role.ADMIN, Role.ADMINISTRATOR, Role.BUGALTER)

    def perm(self, section: str) -> int:
        """Foydalanuvchining bo'limdagi darajasi: 0/1/2."""
        if not self.is_active:
            return NONE
        if self.role == Role.ADMIN or self.is_superuser:
            return EDIT
        if self.role in DEFAULT_PERMS:
            base = DEFAULT_PERMS[self.role].get(section, NONE)
            return int(self.perms.get(section, base))
        if section in EXTRA_SECTIONS:  # o'qituvchi/support: admin berishi mumkin bo'lgan qo'shimcha bo'limlar
            return int(self.perms.get(section, NONE))
        return NONE

    def save(self, *args, **kwargs):
        if self.role == Role.ADMIN:
            self.is_staff = True
        super().save(*args, **kwargs)
