from django.contrib import admin

from . import models

for m in (models.Subject, models.Group, models.Student, models.Enrollment, models.Session, models.Attendance, models.ParentContact):
    admin.site.register(m)
