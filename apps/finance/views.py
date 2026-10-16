from django.db.models import Sum
from django.shortcuts import get_object_or_404
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.models import Student
from apps.accounts.models import Role, User
from apps.accounts.permissions import IsAdmin, SectionPermission
from apps.core import audit
from apps.core.exceptions import BusinessError
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
        return Response(services.month_overview(_month(request)))


class MonthRowsView(APIView):
    permission_classes = [SectionPermission]
    section = "pay"

    def get(self, request):
        m = _month(request)
        return Response({"month": m, "closed": services.is_closed(m), "rows": services.month_rows(m)})


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
        e = services.pay_salary(u, m, request.user)
        audit.log(request, "salary.pay", f"user={u.id}", f"{m} {e.amount}")
        return Response({"paid": e.amount}, status=201)


class MySalaryView(APIView):
    def get(self, request):
        if request.user.role not in (Role.TEACHER, Role.SUPPORT):
            raise BusinessError("Faqat o'qituvchi/support uchun")
        return Response(services.salary_of(request.user, _month(request)))
