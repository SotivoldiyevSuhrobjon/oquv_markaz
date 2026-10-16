from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("subjects", views.SubjectViewSet, basename="subject")
router.register("groups", views.GroupViewSet, basename="group")
router.register("students", views.StudentViewSet, basename="student")

urlpatterns = router.urls + [
    path("attendance/", views.AttendanceView.as_view()),
    path("attendance/<str:op>/", views.AttendanceView.as_view()),
    path("alerts/", views.AlertsView.as_view()),
]
