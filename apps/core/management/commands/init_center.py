"""Toza boshlash: yo'nalishlar, sozlamalar va birinchi admin. Hech qanday namunaviy o'quvchi yuklanmaydi.

python manage.py init_center --username admin
"""

import getpass

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from apps.academics.models import Subject
from apps.accounts.models import Role, User
from apps.core.models import Setting

SUBJECTS = [
    {"slug": "kids", "name": "Kids", "price": 900000, "is_kids": True, "prefix": "Kids"},
    {"slug": "math", "name": "Matematika", "price": 600000, "prefix": "Mat_"},
    {"slug": "eng", "name": "English", "price": 600000, "has_levels": True, "prefix": "E"},
]


class Command(BaseCommand):
    help = "Bo'sh bazani ishga tayyorlaydi: yo'nalishlar + sozlamalar + admin"

    def add_arguments(self, p):
        p.add_argument("--username", default="admin")
        p.add_argument("--full-name", default="Administrator")
        p.add_argument("--password", default="", help="Berilmasa, so'raladi")
        p.add_argument("--excel", default="", help="Excel (Guruhlar_2026-2027) dan guruh, o'quvchi, xodimlarni ham yuklash")

    def handle(self, *a, username, full_name, password, excel="", **kw):
        for d in SUBJECTS:
            Subject.objects.get_or_create(slug=d["slug"], defaults=d)
        Setting.get()
        existing = User.objects.filter(username=username).first()
        if existing and password:
            existing.set_password(password)
            existing.role, existing.is_active, existing.is_superuser, existing.must_change_password = Role.ADMIN, True, True, False
            existing.save()
            self.stdout.write(self.style.SUCCESS(f"'{username}' paroli yangilandi."))
        elif existing:
            self.stdout.write(f"'{username}' allaqachon bor — o'zgartirilmadi.")
        else:
            if password:
                self.stdout.write(
                    self.style.WARNING(
                        "Parol buyruq orqali berildi — tekshiruvsiz qabul qilindi. Ishchi serverda kuchli parolga almashtiring."
                    )
                )
            else:
                password = getpass.getpass("Admin paroli: ")
                try:
                    validate_password(password)
                except ValidationError as e:
                    raise CommandError("; ".join(e.messages)) from e
            u = User(username=username, full_name=full_name, role=Role.ADMIN, is_superuser=True)
            u.set_password(password)
            u.save()
            self.stdout.write(self.style.SUCCESS(f"Admin yaratildi: {username}"))
        if excel:
            call_command("import_excel", excel, "--credentials", "data/xodimlar_parollari.txt")
        self.stdout.write(self.style.SUCCESS("Tayyor."))
