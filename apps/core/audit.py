from .models import AuditLog
from .utils import client_ip


def log(request, action: str, target: str = "", detail: str = "", user=None) -> AuditLog:
    """Tarixga yozuv qo'shadi. request None bo'lishi mumkin (management command)."""
    u = user or (getattr(request, "user", None) if request is not None else None)
    if u is not None and not getattr(u, "is_authenticated", False):
        u = None
    return AuditLog.objects.create(
        user=u,
        username=(u.get_username() if u else "")[:150],
        action=action[:60],
        target=str(target)[:120],
        detail=str(detail)[:2000],
        ip=client_ip(request) if request is not None else None,
    )


class AuditMixin:
    """ViewSet'larda create/update/destroy avtomatik tarixga yoziladi."""

    audit_name = ""

    def _name(self):
        return self.audit_name or self.__class__.__name__.replace("ViewSet", "").lower()

    def perform_create(self, serializer):
        obj = serializer.save()
        log(self.request, f"{self._name()}.create", obj, str(serializer.validated_data.keys()))
        return obj

    def perform_update(self, serializer):
        obj = serializer.save()
        log(self.request, f"{self._name()}.update", obj, ", ".join(serializer.validated_data.keys()))
        return obj

    def perform_destroy(self, instance):
        log(self.request, f"{self._name()}.delete", instance)
        instance.delete()
