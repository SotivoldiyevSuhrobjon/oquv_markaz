from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("audit", views.AuditViewSet, basename="audit")

urlpatterns = router.urls + [
    path("settings/", views.SettingView.as_view()),
    path("backups/", views.BackupView.as_view()),
    path("backups/<str:name>/", views.BackupFileView.as_view()),
    path("backups/<str:name>/restore/", views.BackupRestoreView.as_view()),
]
