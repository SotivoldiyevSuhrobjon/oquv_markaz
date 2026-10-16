from django.contrib import admin

from . import models

for m in (models.Payment, models.Discount, models.MonthClosing, models.CashEntry):
    admin.site.register(m)
