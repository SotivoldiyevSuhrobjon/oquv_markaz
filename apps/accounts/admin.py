from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class StaffAdmin(UserAdmin):
    list_display = ("username", "full_name", "role", "category", "is_active")
    list_filter = ("role", "is_active")
    fieldsets = UserAdmin.fieldsets + (
        (
            "Xodim",
            {
                "fields": (
                    "role",
                    "full_name",
                    "phone",
                    "district",
                    "birth_date",
                    "category",
                    "rate",
                    "monthly_salary",
                    "work_from",
                    "perms",
                    "note",
                    "must_change_password",
                    "archived_at",
                )
            },
        ),
    )
