from django.contrib.auth.password_validation import validate_password
from django.utils import timezone
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.settings import api_settings as jwt_settings

from .models import DEFAULT_PERMS, SECTIONS, Role, User


class LoginSerializer(TokenObtainPairSerializer):
    """Login + 'eslab qolish': remember=true bo'lsa refresh token uzoqroq yashaydi."""

    remember = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        remember = attrs.pop("remember", False)
        data = super().validate(attrs)
        if remember:
            from django.conf import settings

            refresh = self.get_token(self.user)
            refresh.set_exp(lifetime=settings.SIMPLE_JWT["REMEMBER_REFRESH_LIFETIME"])
            data["refresh"] = str(refresh)
            data["access"] = str(refresh.access_token)
        data["user"] = MeSerializer(self.user).data
        return data


class MeSerializer(serializers.ModelSerializer):
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "username", "full_name", "role", "category", "phone", "must_change_password", "permissions")

    def get_permissions(self, obj):
        return {s: obj.perm(s) for s in SECTIONS}


class PasswordChangeSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_old_password(self, v):
        if not self.context["request"].user.check_password(v):
            raise serializers.ValidationError("Joriy parol noto'g'ri")
        return v

    def validate_new_password(self, v):
        validate_password(v, self.context["request"].user)
        return v


class StaffSerializer(serializers.ModelSerializer):
    """Xodim ma'lumoti. Parol hech qachon qaytarilmaydi. Oylik/stavka faqat 'sal' ko'ra oladiganlarga."""

    password = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "full_name",
            "role",
            "category",
            "phone",
            "district",
            "birth_date",
            "work_from",
            "note",
            "rate",
            "monthly_salary",
            "perms",
            "is_active",
            "archived_at",
            "password",
        )
        read_only_fields = ("archived_at",)

    def to_representation(self, inst):
        data = super().to_representation(inst)
        req = self.context.get("request")
        if req and req.user.perm("sal") < 1:
            data.pop("rate", None)
            data.pop("monthly_salary", None)
        return data

    def validate_role(self, v):
        req = self.context["request"]
        if v == Role.ADMIN and req.user.role != Role.ADMIN:
            raise serializers.ValidationError("Admin yaratish faqat adminga mumkin")
        return v

    def validate_perms(self, v):
        bad = [k for k, x in v.items() if k not in SECTIONS or x not in (0, 1, 2)]
        if bad:
            raise serializers.ValidationError(f"Noto'g'ri bo'lim/daraja: {bad}")
        return v

    def validate(self, attrs):
        req = self.context["request"]
        touching_money = {"rate", "monthly_salary"} & set(attrs)
        if touching_money and req.user.perm("sal") < 2:
            raise serializers.ValidationError("Oylik/stavkani o'zgartirishga ruxsat yo'q")
        pw = attrs.get("password")
        if pw:
            validate_password(pw)
        return attrs

    def create(self, data):
        pw = data.pop("password", None)
        user = User(**data)
        user.set_password(pw) if pw else user.set_unusable_password()
        if not data.get("perms") and user.role in DEFAULT_PERMS:
            user.perms = dict(DEFAULT_PERMS[user.role])
        user.must_change_password = True
        user.save()
        return user

    def update(self, inst, data):
        pw = data.pop("password", None)
        for k, v in data.items():
            setattr(inst, k, v)
        if pw:
            inst.set_password(pw)
            inst.must_change_password = True
        if not inst.is_active and not inst.archived_at:
            inst.archived_at = timezone.now()
        inst.save()
        return inst


__all__ = ["LoginSerializer", "MeSerializer", "PasswordChangeSerializer", "StaffSerializer", "jwt_settings"]
