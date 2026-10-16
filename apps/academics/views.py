from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role, User
from apps.accounts.permissions import SectionPermission, is_manager
from apps.core import audit
from apps.core.audit import AuditMixin
from apps.core.exceptions import BusinessError
from apps.core.models import Setting

from . import schedule, services
from .models import Enrollment, Group, GroupTeacher, Room, Student, Subject
from .serializers import ContactSerializer, GroupSerializer, MarkSerializer, RoomSerializer, StudentSerializer, SubjectSerializer


def my_groups(user):
    """O'qituvchi/support o'z guruhlarini ko'radi."""
    return Group.objects.filter(Q(teachers=user) | Q(supports=user), is_active=True).distinct()


class SubjectViewSet(AuditMixin, viewsets.ModelViewSet):
    """Yo'nalishlar: o'qish hammaga, o'zgartirish faqat admin (Sozlamalar)."""

    queryset = Subject.objects.all()
    serializer_class = SubjectSerializer
    audit_name = "subject"

    def get_permissions(self):
        from apps.accounts.permissions import IsAdmin

        return [IsAuthenticated()] if self.action in ("list", "retrieve") else [IsAdmin()]

    def perform_destroy(self, instance):
        if instance.groups.exists():
            raise BusinessError("Guruhi bor yo'nalishni o'chirib bo'lmaydi — nofaol qiling")
        super().perform_destroy(instance)


class RoomViewSet(AuditMixin, mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Xonalar: ko'rish hammaga, qo'shish/o'chirish 'room' bo'limida (o'zgartirish huquqi bilan)."""

    queryset = Room.objects.all()
    serializer_class = RoomSerializer
    audit_name = "room"
    pagination_class = None

    def get_permissions(self):
        return [IsAuthenticated()] if self.action == "list" else [SectionPermission()]

    def get_section(self):
        return "room"

    def list(self, request, *args, **kwargs):
        rooms = sorted(self.get_queryset(), key=lambda r: services.room_sort_key(r.name))
        return Response(self.get_serializer(rooms, many=True).data)

    def perform_destroy(self, instance):
        if Group.objects.filter(room=instance.name, is_active=True).exists():
            raise BusinessError(f"Xona {instance.name} da guruhlar bor — avval ularni boshqa xonaga ko'chiring")
        super().perform_destroy(instance)


class GroupViewSet(AuditMixin, viewsets.ModelViewSet):
    serializer_class = GroupSerializer
    permission_classes = [SectionPermission]
    audit_name = "group"
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_section(self):
        return {
            "create": "new",
            "partial_update": "room",
            "destroy": "room",
            "set_teachers": "stf",
            "set_supports": "stf",
            "suggest": "room",
        }.get(self.action, "dash")

    def get_permissions(self):
        u = self.request.user
        if u.is_authenticated and u.role in (Role.TEACHER, Role.SUPPORT) and self.action in ("list", "retrieve"):
            return [IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        qs = (
            Group.objects.select_related("subject")
            .prefetch_related("group_teachers__teacher", "supports")
            .annotate(student_count=Count("enrollments", filter=Q(enrollments__left_on__isnull=True), distinct=True))
        )
        u = self.request.user
        if u.role in (Role.TEACHER, Role.SUPPORT):
            qs = qs.filter(Q(teachers=u) | Q(supports=u)).distinct()
        subj = self.request.query_params.get("subject")
        if subj:
            qs = qs.filter(subject__slug=subj)
        if self.request.query_params.get("free") == "1":
            qs = qs.filter(student_count__lt=Setting.get().max_group_size)
        return qs

    def perform_destroy(self, instance):
        if instance.enrollments.filter(left_on__isnull=True).exists():
            raise BusinessError("Guruhda o'quvchilar bor — avval ularni ko'chiring yoki arxivlang")
        audit.log(self.request, "group.delete", instance)
        instance.delete()

    @action(detail=False, methods=["get"])
    def conflicts(self, request):
        """Hozirgi barcha ustma-ust tushishlar (Excel'dan kelganlari ham)."""
        slots = services.all_slots()
        seen, out = set(), []
        for s in slots:
            for c in schedule.conflicts_of(s, slots):
                pair = tuple(sorted([s.name, c["with"]])) + (c["kind"],)
                if pair not in seen:
                    seen.add(pair)
                    out.append({"group": s.name, **c})
        return Response(out)

    @action(detail=True, methods=["get"])
    def suggest(self, request, pk=None):
        g = self.get_object()
        cand = services.slot_of(g)
        return Response(schedule.suggestions(cand, services.all_slots(exclude_id=g.id), services.rooms()))

    @action(detail=True, methods=["post"], url_path="teachers")
    @transaction.atomic
    def set_teachers(self, request, pk=None):
        """Body: {"teachers": [user_id, ...]} — tartib muhim (Kidsda 0=English, 1=Math). Yangi to'qnashuvga ruxsat yo'q."""
        g = self.get_object()
        ids = request.data.get("teachers", [])
        if not isinstance(ids, list) or len(ids) != len(set(ids)) or len(ids) > (2 if g.subject.is_kids else 1):
            raise BusinessError("Noto'g'ri o'qituvchilar ro'yxati (Kids: 2 tagacha, boshqalar: 1 ta)")
        users = {u.id: u for u in User.objects.filter(id__in=ids, role=Role.TEACHER, is_active=True)}
        if len(users) != len(ids):
            raise BusinessError("O'qituvchi topilmadi yoki faol emas")
        before = services.slot_of(g)
        after = schedule.Slot(g.id, g.name, g.days, g.start_hour, g.room, g.subject.is_kids, g.kids_order, [users[i].username for i in ids])
        bad = schedule.new_conflicts(before, after, services.all_slots(exclude_id=g.id))
        if bad:
            return Response({"schedule": [c["message"] for c in bad]}, status=status.HTTP_400_BAD_REQUEST)
        GroupTeacher.objects.filter(group=g).delete()
        GroupTeacher.objects.bulk_create(GroupTeacher(group=g, teacher=users[i], position=p) for p, i in enumerate(ids))
        audit.log(request, "group.teachers", g, str([users[i].username for i in ids]))
        return Response(self.get_serializer(self.get_queryset().get(pk=g.pk)).data)

    @action(detail=True, methods=["post"], url_path="supports")
    def set_supports(self, request, pk=None):
        g = self.get_object()
        ids = request.data.get("supports", [])
        users = User.objects.filter(id__in=ids, role=Role.SUPPORT, is_active=True)
        if users.count() != len(set(ids)):
            raise BusinessError("Support teacher topilmadi")
        g.supports.set(users)
        audit.log(request, "group.supports", g, str(list(users.values_list("username", flat=True))))
        return Response(self.get_serializer(self.get_queryset().get(pk=g.pk)).data)

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Asosiy sahifa: yo'nalishlar bo'yicha guruh va o'quvchi soni."""
        out = []
        for s in Subject.objects.filter(is_active=True):
            qs = Group.objects.filter(subject=s, is_active=True)
            n = Student.objects.filter(enrollments__group__in=qs, enrollments__left_on__isnull=True).distinct().count()
            out.append({"subject": s.slug, "name": s.name, "groups": qs.count(), "students": n})
        totals = {
            "teachers": User.objects.filter(role=Role.TEACHER, is_active=True).count(),
            "supports": User.objects.filter(role=Role.SUPPORT, is_active=True).count(),
            "groups": Group.objects.filter(is_active=True).count(),
            "students": Student.objects.filter(status=Student.Status.ACTIVE).count(),
            "rooms": len(services.rooms()),
        }
        size = Setting.get().max_group_size
        counts = Group.objects.filter(is_active=True).annotate(n=Count("enrollments", filter=Q(enrollments__left_on__isnull=True)))
        totals["free_places"] = sum(max(0, size - g.n) for g in counts)
        totals["nogroup"] = (
            Student.objects.filter(status=Student.Status.ACTIVE)
            .exclude(id__in=Enrollment.objects.filter(left_on__isnull=True).values("student_id"))
            .count()
        )
        return Response(
            {
                "totals": totals,
                "subjects": out,
                "max_group_size": Setting.get().max_group_size,
                "conflicts": len(self.conflicts(request).data),
            }
        )


class StudentViewSet(AuditMixin, viewsets.ModelViewSet):
    serializer_class = StudentSerializer
    permission_classes = [SectionPermission]
    audit_name = "student"
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_section(self):
        return {
            "create": "new",
            "partial_update": "new",
            "destroy": "arch",
            "archive": "arch",
            "restore": "arch",
            "enroll": "new",
            "unenroll": "new",
            "contacts": "att",
        }.get(self.action, "dash")

    def get_permissions(self):
        u = self.request.user
        if u.is_authenticated and u.role in (Role.TEACHER, Role.SUPPORT) and self.action in ("list", "retrieve"):
            return [IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        qs = Student.objects.prefetch_related("enrollments__group").annotate(
            absences=Count("attendance", filter=Q(attendance__present=False), distinct=True)
        )
        u = self.request.user
        if u.role in (Role.TEACHER, Role.SUPPORT):
            qs = qs.filter(enrollments__group__in=my_groups(u), enrollments__left_on__isnull=True).distinct()
        p = self.request.query_params
        archived = p.get("archived") == "1"
        qs = qs.exclude(status="active") if archived else qs.filter(status="active")
        if p.get("group"):
            qs = qs.filter(enrollments__group_id=p["group"], enrollments__left_on__isnull=True)
        if p.get("q"):
            q = p["q"].strip()
            qs = qs.filter(Q(full_name__icontains=q) | Q(phone__icontains=q))
        if p.get("subject"):
            qs = qs.filter(enrollments__group__subject__slug=p["subject"], enrollments__left_on__isnull=True)
        if p.get("nogroup") == "1":
            qs = qs.exclude(id__in=Enrollment.objects.filter(left_on__isnull=True).values("student_id"))
        return qs.distinct()

    def perform_destroy(self, instance):
        if instance.payments.exists():
            raise BusinessError("To'lovlari bor o'quvchini o'chirib bo'lmaydi — arxivga o'tkazing")
        super().perform_destroy(instance)

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        s = self.get_object()
        d = request.data
        services.archive_student(s, d.get("status", ""), d.get("reason", ""), d.get("start") or None)
        audit.log(request, "student.archive", s, d.get("status", ""))
        return Response(StudentSerializer(s).data)

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        s = get_object_or_404(Student, pk=pk)
        g = Group.objects.filter(pk=request.data.get("group")).first() if request.data.get("group") else None
        services.restore_student(s, g)
        audit.log(request, "student.restore", s)
        return Response(StudentSerializer(s).data)

    @action(detail=True, methods=["post"])
    def enroll(self, request, pk=None):
        s, g = self.get_object(), get_object_or_404(Group, pk=request.data.get("group"))
        services.enroll(s, g)
        audit.log(request, "student.enroll", s, g.name)
        return Response(StudentSerializer(s).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def unenroll(self, request, pk=None):
        s, g = self.get_object(), get_object_or_404(Group, pk=request.data.get("group"))
        services.unenroll(s, g)
        audit.log(request, "student.unenroll", s, g.name)
        return Response(StudentSerializer(s).data)

    @action(detail=True, methods=["get", "post"])
    def contacts(self, request, pk=None):
        s = get_object_or_404(Student, pk=pk)
        if request.method == "POST":
            c = services.add_contact(s, request.data.get("note"), request.user)
            audit.log(request, "student.contact", s, c.note[:200])
            return Response(ContactSerializer(c).data, status=status.HTTP_201_CREATED)
        return Response(ContactSerializer(s.contacts.all(), many=True).data)


def _can_mark(user, group) -> bool:
    if is_manager(user):
        return user.perm("att") >= 2
    return user.role == Role.TEACHER and group.group_teachers.filter(teacher=user).exists()


class AttendanceView(APIView):
    """GET sheet; POST mark / finalize / reopen. O'qituvchi faqat o'z guruhida, administrator att=2 bilan."""

    def get(self, request):
        g = get_object_or_404(Group, pk=request.query_params.get("group"))
        if not (is_manager(request.user) and request.user.perm("att") >= 1) and not my_groups(request.user).filter(pk=g.pk).exists():
            return Response(status=status.HTTP_403_FORBIDDEN)
        import datetime as dt

        from apps.core.utils import today

        try:
            d = dt.date.fromisoformat(request.query_params.get("date") or today().isoformat())
        except ValueError:
            raise BusinessError("Sana YYYY-MM-DD ko'rinishida bo'lsin") from None
        return Response(services.sheet(g, d))

    def post(self, request, op):
        s = MarkSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        g, d = s.validated_data["group"], s.validated_data["date"]
        if not _can_mark(request.user, g):
            return Response({"detail": "Ruxsat yo'q"}, status=status.HTTP_403_FORBIDDEN)
        if op == "mark":
            recs = s.validated_data.get("records", [])
            if s.validated_data["all_present"]:
                recs = [{"student": sid, "present": True} for sid in services.group_students(g).values_list("id", flat=True)]
            services.mark(g, d, recs, request.user)
        elif op == "finalize":
            services.finalize(g, d, request.user)
        elif op == "reopen":
            if not is_manager(request.user):
                return Response({"detail": "Faqat administrator qayta ocha oladi"}, status=status.HTTP_403_FORBIDDEN)
            services.reopen(g, d)
        audit.log(request, f"attendance.{op}", g, str(d))
        return Response(services.sheet(g, d))


class AlertsView(APIView):
    def get(self, request):
        u = request.user
        if is_manager(u):
            if u.perm("att") < 1:
                return Response(status=status.HTTP_403_FORBIDDEN)
            students = services.alerts()
        else:
            students = services.alerts(groups=my_groups(u))
        return Response([{"student": s.id, "name": s.full_name, "phone": s.phone, "absences": s.miss} for s in students])


__all__ = ["SubjectViewSet", "RoomViewSet", "GroupViewSet", "StudentViewSet", "AttendanceView", "AlertsView", "mixins"]
