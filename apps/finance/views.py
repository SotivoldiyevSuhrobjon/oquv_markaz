from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.models import Student
from apps.accounts.models import Role, User
from apps.accounts.permissions import IsAdmin, SectionPermission
from apps.core import audit
from apps.core.exceptions import BusinessError
from apps.core.models import Setting
from apps.core.utils import month_of, today, validate_month

from . import services
from .models import CashEntry, Payment
from .serializers import CashEntrySerializer, DiscountInputSerializer, PayInputSerializer, PaymentSerializer


def _month(request) -> str:
    m = request.query_params.get("month") or month_of(today())
    validate_month(m)
    return m


class PaymentViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """To'lovlar ro'yxati. Yaratish: /students/<id>/pay (FIFO) yoki shu yerdagi POST (aniq oyga)."""

    serializer_class = PaymentSerializer
    permission_classes = [SectionPermission]
    section = "pay"

    def get_queryset(self):
        qs = Payment.objects.select_related("student")
        p = self.request.query_params
        if p.get("month"):
            qs = qs.filter(month=p["month"])
        if p.get("student"):
            qs = qs.filter(student_id=p["student"])
        return qs

    def create(self, request):
        ser = PaymentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        pay = services.add_payment(d["student"], d["month"], d["amount"], request.user, d["paid_on"], d.get("note", ""))
        audit.log(request, "payment.create", f"student={pay.student_id}", f"{pay.month} {pay.amount}")
        return Response(PaymentSerializer(pay).data, status=201)

    def destroy(self, request, pk=None):
        pay = get_object_or_404(Payment, pk=pk)
        services.ensure_open(pay.month)
        audit.log(request, "payment.delete", f"student={pay.student_id}", f"{pay.month} {pay.amount}")
        pay.delete()
        return Response(status=204)


class StudentFinanceView(APIView):
    permission_classes = [SectionPermission]
    section = "pay"

    def get(self, request, pk):
        st = get_object_or_404(Student, pk=pk)
        led, months, cur = services.ledger_for(st), services.academic_months(), month_of(today())
        rows = [
            {
                "month": m,
                "base": led.base(m),
                "discount": led.discount(m),
                "due": led.due(m),
                "paid": led.paid(m),
                "owe": led.owe(m),
                "status": led.status(m),
                "closed": services.is_closed(m),
            }
            for m in months
        ]
        return Response(
            {"student": st.id, "name": st.full_name, "rows": rows, "debt": led.total_debt(months, cur), "credit": led.credit(months)}
        )


class StudentPayView(APIView):
    permission_classes = [SectionPermission]
    section = "pay"

    def post(self, request, pk):
        st = get_object_or_404(Student, pk=pk)
        ser = PayInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if d.get("month"):
            pays = [services.add_payment(st, d["month"], d["amount"], request.user, note=d["note"])]
        else:
            pays = services.pay_fifo(st, d["amount"], request.user, d["note"])
        audit.log(request, "payment.fifo", f"student={st.id}", f"{d['amount']} -> {len(pays)} oy")
        return Response(PaymentSerializer(pays, many=True).data, status=201)


class StudentDiscountView(APIView):
    permission_classes = [SectionPermission]
    section = "pay"

    def post(self, request, pk):
        st = get_object_or_404(Student, pk=pk)
        ser = DiscountInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        services.set_discount(st, d["month"], d["amount"], request.user)
        audit.log(request, "discount.set", f"student={st.id}", f"{d['month']} {d['amount']}")
        return Response({"ok": True})


class OverviewView(APIView):
    permission_classes = [SectionPermission]
    section = "pay"

    def get(self, request):
        services.rollover()
        return Response(services.month_overview(_month(request)))


class MonthRowsView(APIView):
    permission_classes = [SectionPermission]
    section = "pay"

    def get(self, request):
        services.rollover()
        m = _month(request)
        return Response({"month": m, "closed": services.is_closed(m), "rows": services.month_rows(m)})


class CalcView(APIView):
    """To'lov kalkulyatori: qaysi kundan boshlasa, oyning qolgan darslariga mos summa."""

    permission_classes = [SectionPermission]
    section = "pay"

    def get(self, request):
        import datetime as dt

        from apps.academics.models import Subject
        from apps.core.exceptions import BusinessError

        m, q = _month(request), request.query_params
        days = q.get("days", "DCJ")
        if days not in services.WEEKDAYS:
            raise BusinessError("Kunlar noto'g'ri")
        try:
            start = dt.date.fromisoformat(q.get("from") or f"{m}-01")
            discount = max(0, int(q.get("discount") or 0))
        except ValueError:
            raise BusinessError("Sana yoki chegirma noto'g'ri") from None
        ids = [int(x) for x in (q.get("subjects") or "").split(",") if x.isdigit()]
        base = max(0, sum(Subject.objects.filter(id__in=ids).values_list("price", flat=True)) - discount)
        left, total = services.lessons(days, start, m)
        return Response(
            {"month": m, "lessons_left": left, "lessons_total": total, "full": base, "amount": round(base * left / total) if total else 0}
        )


class DebtorsView(APIView):
    permission_classes = [SectionPermission]
    section = "pay"

    def get(self, request):
        return Response(services.debtors(_month(request)))


class MonthCloseView(APIView):
    """Yopish: to'lov bo'limi tahrir huquqi. Qayta ochish: faqat admin."""

    def get_permissions(self):
        return [IsAdmin()] if self.kwargs.get("op") == "reopen" else [SectionPermission()]

    section = "pay"

    def post(self, request, month, op):
        validate_month(month)
        if op == "close":
            services.close_month(month, request.user)
        elif op == "reopen":
            services.reopen_month(month, request.user)
        else:
            raise BusinessError("Noma'lum amal")
        audit.log(request, f"month.{op}", month)
        return Response({"month": month, "closed": services.is_closed(month)})


class CashViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = CashEntrySerializer
    permission_classes = [SectionPermission]
    section = "pay"

    def get_queryset(self):
        qs = CashEntry.objects.all()
        if self.request.query_params.get("month"):
            qs = qs.filter(month=self.request.query_params["month"])
        return qs

    def perform_create(self, ser):
        d = ser.validated_data
        month = d.get("month") or month_of(d["date"])
        services.ensure_open(month)
        obj = ser.save(month=month, by=self.request.user)
        audit.log(self.request, "cash.create", obj.kind, f"{obj.category} {obj.amount}")

    def perform_destroy(self, obj):
        if obj.category == "oylik":
            raise BusinessError("Oylik yozuvini bu yerdan o'chirib bo'lmaydi")
        services.ensure_open(obj.month)
        audit.log(self.request, "cash.delete", obj.kind, f"{obj.category} {obj.amount}")
        obj.delete()

    @action(detail=False, methods=["get"])
    def summary(self, request):
        m = _month(request)
        qs = CashEntry.objects.filter(month=m)
        tot = {k: qs.filter(kind=k).aggregate(t=Sum("amount"))["t"] or 0 for k in ("kirim", "chiqim")}
        pays = Payment.objects.filter(month=m).aggregate(t=Sum("amount"))["t"] or 0
        return Response(
            {"month": m, "payments": pays, "kirim": tot["kirim"], "chiqim": tot["chiqim"], "balance": pays + tot["kirim"] - tot["chiqim"]}
        )


class SalaryView(APIView):
    """Oylik ro'yxati ('sal' bo'limi). O'qituvchi/support faqat o'zinikini ko'radi."""

    def get_permissions(self):
        return [SectionPermission()]

    def get_section(self):
        return "sal"

    def get(self, request):
        m = _month(request)
        staff = User.objects.filter(role__in=[Role.TEACHER, Role.SUPPORT], is_active=True)
        return Response([services.salary_of(u, m) for u in staff])

    def post(self, request, pk):
        u = get_object_or_404(User, pk=pk, role__in=[Role.TEACHER, Role.SUPPORT])
        m = request.data.get("month") or month_of(today())
        validate_month(m)
        services.ensure_open(m)
        raw = request.data.get("amount")
        e = services.pay_salary(
            u,
            m,
            request.user,
            int(raw) if isinstance(raw, (int, str)) and str(raw).isdigit() else None,
            str(request.data.get("note") or ""),
        )
        audit.log(request, "salary.pay", f"user={u.id}", f"{m} {e.amount}")
        return Response({"paid": e.amount}, status=201)


class SalaryDetailView(APIView):
    """Oylik bo'limidan o'qituvchi kartasi: ma'lumot, guruhlar, stavka/oylikni o'zgartirish."""

    def get_permissions(self):
        return [SectionPermission()]

    def get_section(self):
        return "sal"

    def _staff(self, pk):
        return get_object_or_404(User, pk=pk, role__in=[Role.TEACHER, Role.SUPPORT])

    def _payload(self, request, u):
        from apps.academics.models import Group
        from apps.academics.serializers import GroupSerializer

        groups = (
            Group.objects.filter(Q(teachers=u) | Q(supports=u), is_active=True)
            .distinct()
            .annotate(student_count=Count("enrollments", filter=Q(enrollments__left_on__isnull=True), distinct=True))
        )
        return {
            "id": u.id,
            "name": str(u),
            "role": u.role,
            "phone": u.phone,
            "district": u.district,
            "category": u.category,
            "description": u.description,
            "rate": u.rate,
            "monthly_salary": u.monthly_salary,
            "default_rate": Setting.get().default_rate,
            "groups": GroupSerializer(groups, many=True, context={"request": request}).data,
            "salary": services.salary_of(u, _month(request)),
            "payments": services.salary_payments(u, _month(request)),
        }

    def get(self, request, pk):
        return Response(self._payload(request, self._staff(pk)))

    def patch(self, request, pk):
        u = self._staff(pk)
        if request.user.perm("sal") < 2:
            raise PermissionDenied("Oylikni o'zgartirishga ruxsat yo'q")
        field = "monthly_salary" if u.role == Role.SUPPORT else "rate"
        raw = request.data.get(field, request.data.get("value"))
        if raw in ("", None):
            if field == "monthly_salary":
                raise BusinessError("Oylik summasini kiriting")
            u.rate = None
        else:
            try:
                val = int(raw)
            except (TypeError, ValueError):
                raise BusinessError("Summa butun son bo'lsin") from None
            if val < 0:
                raise BusinessError("Summa manfiy bo'lmasin")
            setattr(u, field, val)
        u.save(update_fields=[field])
        audit.log(request, "salary.rate", f"user={u.id}", f"{field}={getattr(u, field)}")
        return Response(self._payload(request, u))


class MySalaryView(APIView):
    def get(self, request):
        if request.user.role not in (Role.TEACHER, Role.SUPPORT):
            raise BusinessError("Faqat o'qituvchi/support uchun")
        return Response(services.salary_of(request.user, _month(request)))
