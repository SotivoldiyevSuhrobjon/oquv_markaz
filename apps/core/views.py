from django.db import connection
from django.http import JsonResponse
from rest_framework import serializers, viewsets
from rest_framework.generics import RetrieveUpdateAPIView
from rest_framework.permissions import IsAuthenticated

from apps.accounts.permissions import IsAdmin

from . import audit
from .models import AuditLog, Setting


def healthz(request):
    """Docker/nginx health-check: DB ulanishini ham tekshiradi."""
    try:
        with connection.cursor() as c:
            c.execute("SELECT 1")
    except Exception:  # noqa: BLE001
        return JsonResponse({"status": "db_down"}, status=503)
    return JsonResponse({"status": "ok"})


class AuditSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = ("id", "username", "action", "target", "detail", "ip", "created_at")


class AuditViewSet(viewsets.ReadOnlyModelViewSet):
    """Tarix — faqat admin ko'radi, hech kim o'zgartira olmaydi."""

    queryset = AuditLog.objects.all()
    serializer_class = AuditSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        qs, p = super().get_queryset(), self.request.query_params
        if p.get("user"):
            qs = qs.filter(username=p["user"])
        if p.get("action"):
            qs = qs.filter(action__startswith=p["action"])
        return qs


class SettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Setting
        fields = ("max_group_size", "default_rate", "default_price", "academic_start", "academic_months")

    def validate_academic_start(self, v):
        from .utils import validate_month

        validate_month(v)
        return v


class SettingView(RetrieveUpdateAPIView):
    serializer_class = SettingSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_permissions(self):
        return [IsAuthenticated()] if self.request.method in ("GET", "HEAD", "OPTIONS") else [IsAdmin()]

    def get_object(self):
        return Setting.get()

    def perform_update(self, ser):
        ser.save()
        audit.log(self.request, "settings.update", "", ", ".join(ser.validated_data))
