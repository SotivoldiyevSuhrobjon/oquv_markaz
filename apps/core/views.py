from django.db import connection
from django.http import FileResponse, JsonResponse
from rest_framework import serializers, viewsets
from rest_framework.generics import RetrieveUpdateAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsAdmin

from . import audit, backup
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
        fields = (
            "max_group_size",
            "default_rate",
            "default_price",
            "academic_start",
            "academic_months",
            "alert_threshold",
            "auto_next_month",
            "auto_close_month",
        )

    def validate_academic_months(self, v):
        if not 1 <= v <= 24:
            raise serializers.ValidationError("1 dan 24 gacha bo'lsin")
        return v

    def validate_alert_threshold(self, v):
        if not 1 <= v <= 30:
            raise serializers.ValidationError("1 dan 30 gacha bo'lsin")
        return v

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


class BackupView(APIView):
    """Zaxiralar: ro'yxat va yangisini olish (faqat admin)."""

    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(backup.listing())

    def post(self, request):
        p = backup.make()
        audit.log(request, "backup.create", p.name)
        return Response({"name": p.name}, status=201)


class BackupFileView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request, name):
        p = backup.path_of(name)
        audit.log(request, "backup.download", name)
        return FileResponse(open(p, "rb"), as_attachment=True, filename=name)  # noqa: SIM115 - FileResponse yopadi


class BackupRestoreView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request, name):
        if request.data.get("confirm") != name:
            from .exceptions import BusinessError

            raise BusinessError("Tasdiqlash uchun zaxira nomini kiriting")
        backup.restore(name)
        audit.log(request, "backup.restore", name)
        return Response({"ok": True})
