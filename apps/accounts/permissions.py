from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import EDIT, VIEW, Role


class IsAdmin(BasePermission):
    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.role == Role.ADMIN)


class SectionPermission(BasePermission):
    """view.section (yoki view.section_map[action]) bo'yicha: o'qish >=1, yozish >=2."""

    def has_permission(self, request, view):
        u = request.user
        if not (u and u.is_authenticated):
            return False
        getter = getattr(view, "get_section", None)
        section = getter() if getter else getattr(view, "section", None)
        if section is None:
            return False
        need = VIEW if request.method in SAFE_METHODS else EDIT
        return u.perm(section) >= need


def is_manager(user) -> bool:
    return user.is_authenticated and user.role in (Role.ADMIN, Role.ADMINISTRATOR, Role.BUGALTER)
