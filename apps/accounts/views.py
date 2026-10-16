import contextlib

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.core import audit
from apps.core.exceptions import BusinessError

from .models import Role, User
from .permissions import SectionPermission
from .serializers import LoginSerializer, MeSerializer, PasswordChangeSerializer, StaffSerializer


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request, *args, **kwargs):
        resp = super().post(request, *args, **kwargs)
        if resp.status_code == 200:
            audit.log(
                request,
                "auth.login",
                request.data.get("username", ""),
                user=User.objects.filter(username=request.data.get("username")).first(),
            )
        return resp


class LogoutView(APIView):
    def post(self, request):
        with contextlib.suppress(TokenError):
            RefreshToken(request.data.get("refresh", "")).blacklist()
        audit.log(request, "auth.logout")
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request):
        return Response(MeSerializer(request.user).data)


class PasswordChangeView(APIView):
    def post(self, request):
        s = PasswordChangeSerializer(data=request.data, context={"request": request})
        s.is_valid(raise_exception=True)
        request.user.set_password(s.validated_data["new_password"])
        request.user.must_change_password = False
        request.user.save()
        audit.log(request, "auth.password_change")
        return Response({"ok": True})


class StaffViewSet(viewsets.ModelViewSet):
    """Xodimlar. 'stf' bo'limi: ko'rish>=1, tahrir>=2. Hech kim o'zini arxivlay/o'chira olmaydi."""

    serializer_class = StaffSerializer
    permission_classes = [SectionPermission]
    section = "stf"
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = User.objects.all()
        if self.request.user.role != Role.ADMIN:
            qs = qs.exclude(role=Role.ADMIN)
        p = self.request.query_params
        if p.get("role"):
            qs = qs.filter(role=p["role"])
        if p.get("archived") != "1":
            qs = qs.filter(archived_at__isnull=True)
        return qs

    def perform_create(self, ser):
        obj = ser.save()
        audit.log(self.request, "staff.create", obj.username, obj.role)

    def perform_update(self, ser):
        obj = ser.save()
        audit.log(
            self.request,
            "staff.update",
            obj.username,
            ", ".join(k for k in ser.validated_data if k != "password") + (" +parol" if "password" in ser.validated_data else ""),
        )

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        u = self.get_object()
        if u.pk == request.user.pk:
            raise BusinessError("O'zingizni arxivlay olmaysiz")
        u.is_active, u.archived_at = False, timezone.now()
        u.save()
        audit.log(request, "staff.archive", u.username)
        return Response({"ok": True})

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        u = get_object_or_404(User, pk=pk)
        u.is_active, u.archived_at = True, None
        u.save()
        audit.log(request, "staff.restore", u.username)
        return Response({"ok": True})
