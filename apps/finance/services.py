"""To'lov hisob-kitobi (demo mantig'i bilan bir xil).

- Oylik narx: o'quvchi faol guruhlari fanlari narxlarining yig'indisi (guruhsiz bo'lsa Setting.default_price).
- Boshlagan oyida: dars kunlariga proporsional, 1000 so'mga yaxlitlanadi.
- Chegirma so'mda; belgilangan oydan boshlab amal qiladi.
- Oldingi oylar qarzi saqlanadi; to'lov FIFO: eng eski qarzdan boshlab yopiladi.
- Yopilgan oyga to'lov/chegirma kiritib bo'lmaydi.
"""

import calendar
import datetime as dt
from collections import defaultdict

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.academics.models import Enrollment, Group, Session, Student
from apps.academics.schedule import WEEKDAYS
from apps.accounts.models import Role, User
from apps.core.exceptions import BusinessError
from apps.core.models import Setting
from apps.core.utils import month_of, month_range, today

from .models import CashEntry, Discount, MonthClosing, Payment


def lessons(days: str, from_date: dt.date, ym: str) -> tuple[int, int]:
    """(qolgan, jami) dars soni shu oyda."""
    y, m = map(int, ym.split("-"))
    wd = WEEKDAYS.get(days, WEEKDAYS["DCJ"])
    total = left = 0
    for d in range(1, calendar.monthrange(y, m)[1] + 1):
        date = dt.date(y, m, d)
        if date.weekday() in wd:
            total += 1
            if date >= from_date:
                left += 1
    return left, total


def academic_months() -> list[str]:
    s = Setting.get()
    return month_range(s.academic_start, s.academic_months)


def is_closed(month: str) -> bool:
    return MonthClosing.objects.filter(month=month, is_closed=True).exists()


def ensure_open(month: str) -> None:
    if is_closed(month):
        raise BusinessError(f"{month} oyi yopilgan — o'zgartirib bo'lmaydi (admin qayta ochadi)")


class Ledger:
    """Bitta o'quvchining hisob-kitobi. Ma'lumotlar bir marta yuklanadi (N+1 bo'lmasin uchun prefetch bilan ishlaydi)."""

    def __init__(self, student: Student, prices: list[tuple[int, str]], payments: dict[str, int], discounts: list[tuple[str, int]]):
        self.s, self.prices, self.payments, self.discounts = student, prices, payments, sorted(discounts)

    def _start_month(self) -> str:
        return month_of(self.s.started_on)

    def discount(self, m: str) -> int:
        cur = 0
        for fm, amt in self.discounts:
            if fm <= m:
                cur = amt
        return cur

    def base(self, m: str) -> int:
        if m < self._start_month():
            return 0
        default = Setting.get().default_price
        total = sum(p for p, _ in self.prices) or default
        if m == self._start_month():
            days = self.prices[0][1] if self.prices else "DCJ"
            left, tot = lessons(days, self.s.started_on, m)
            total = round(total * (left / tot if tot else 1) / 1000) * 1000
        return total

    def due(self, m: str) -> int:
        b = self.base(m)
        return max(0, b - self.discount(m)) if b else 0

    def paid(self, m: str) -> int:
        return self.payments.get(m, 0)

    def owe(self, m: str) -> int:
        return max(0, self.due(m) - self.paid(m))

    def prev_debt(self, m: str, months: list[str]) -> int:
        return sum(self.owe(x) for x in months if x < m)

    def total_debt(self, months: list[str], upto: str) -> int:
        return sum(self.owe(x) for x in months if x <= upto)

    def credit(self, months: list[str]) -> int:
        return sum(max(0, self.paid(m) - self.due(m)) for m in months)

    def status(self, m: str) -> str:
        d, p = self.due(m), self.paid(m)
        return "paid" if d > 0 and p >= d else "partial" if p > 0 else "unpaid"


def build_ledgers(students) -> dict[int, Ledger]:
    ids = [s.id for s in students]
    pays: dict[int, dict[str, int]] = defaultdict(dict)
    for sid, m, a in Payment.objects.filter(student_id__in=ids).values_list("student_id", "month").annotate(a=Sum("amount")):
        pays[sid][m] = a
    discs: dict[int, list] = defaultdict(list)
    for d in Discount.objects.filter(student_id__in=ids):
        discs[d.student_id].append((d.from_month, d.amount))
    prices: dict[int, list] = defaultdict(list)
    seen = set()
    for e in (
        Enrollment.objects.filter(student_id__in=ids, left_on__isnull=True, group__is_active=True)
        .select_related("group__subject")
        .order_by("id")
    ):
        if (e.student_id, e.group_id) not in seen:
            seen.add((e.student_id, e.group_id))
            prices[e.student_id].append((e.group.subject.price, e.group.days or "DCJ"))
    return {s.id: Ledger(s, prices[s.id], pays[s.id], discs[s.id]) for s in students}


def ledger_for(student: Student) -> Ledger:
    return build_ledgers([student])[student.id]


@transaction.atomic
def add_payment(student: Student, month: str, amount: int, user, paid_on: dt.date | None = None, note: str = "") -> Payment:
    if amount <= 0:
        raise BusinessError("Summa musbat bo'lishi kerak")
    ensure_open(month)
    return Payment.objects.create(student=student, month=month, amount=amount, paid_on=paid_on or today(), received_by=user, note=note)


@transaction.atomic
def pay_fifo(student: Student, amount: int, user, note: str = "") -> list[Payment]:
    """Eng eski qarzdan boshlab yopadi; ortiqcha joriy oyga avans bo'ladi."""
    if amount <= 0:
        raise BusinessError("Summa musbat bo'lishi kerak")
    led, cur, rest, out = ledger_for(student), month_of(today()), amount, []
    for m in [x for x in academic_months() if x <= cur and not is_closed(x)]:
        part = min(led.owe(m), rest)
        if part > 0:
            out.append(Payment.objects.create(student=student, month=m, amount=part, paid_on=today(), received_by=user, note=note))
            rest -= part
    if rest > 0:
        ensure_open(cur)
        out.append(Payment.objects.create(student=student, month=cur, amount=rest, paid_on=today(), received_by=user, note=note or "avans"))
    return out


@transaction.atomic
def set_discount(student: Student, month: str, amount: int, user) -> Discount:
    if amount < 0:
        raise BusinessError("Chegirma manfiy bo'lmaydi")
    ensure_open(month)
    d, _ = Discount.objects.update_or_create(student=student, from_month=month, defaults={"amount": amount, "set_by": user})
    return d


def month_overview(month: str) -> dict:
    students = list(Student.objects.filter(status=Student.Status.ACTIVE))
    leds, months = build_ledgers(students), academic_months()
    plan = paid = prev = 0
    for s in students:
        ld = leds[s.id]
        d = ld.due(month)
        if d:
            plan += d
            paid += min(ld.paid(month), d)
            prev += ld.prev_debt(month, months)
    return {"month": month, "plan": plan, "paid": paid, "debt": plan - paid, "prev_debt": prev, "closed": is_closed(month)}


def debtors(month: str) -> dict:
    students = list(Student.objects.filter(status=Student.Status.ACTIVE))
    leds, months, cur = build_ledgers(students), academic_months(), month_of(today())
    debt, credit = [], []
    for s in students:
        ld = leds[s.id]
        td, cr = ld.total_debt(months, min(cur, month)), ld.credit(months)
        if td > 0:
            debt.append({"student": s.id, "name": s.full_name, "debt": td})
        if cr > 0:
            credit.append({"student": s.id, "name": s.full_name, "credit": cr})
    return {"debtors": sorted(debt, key=lambda x: -x["debt"]), "creditors": sorted(credit, key=lambda x: -x["credit"])}


@transaction.atomic
def close_month(month: str, user) -> MonthClosing:
    if month > month_of(today()):
        raise BusinessError("Kelajak oyini yopib bo'lmaydi")
    unfinal = Session.objects.filter(date__startswith=month, finalized=False).count()
    if unfinal:
        raise BusinessError(f"{unfinal} ta dars davomati yakunlanmagan — avval yakunlang")
    obj, _ = MonthClosing.objects.update_or_create(
        month=month, defaults={"is_closed": True, "closed_by": user, "closed_at": timezone.now(), "reopened_by": None, "reopened_at": None}
    )
    return obj


def reopen_month(month: str, user) -> MonthClosing:
    obj = MonthClosing.objects.filter(month=month, is_closed=True).first()
    if not obj:
        raise BusinessError("Bu oy yopilmagan")
    obj.is_closed, obj.reopened_by, obj.reopened_at = False, user, timezone.now()
    obj.save()
    return obj


# ---- Oylik ----
def teacher_breakdown(teacher: User, month: str) -> list[dict]:
    """Guruhlar bo'yicha oylik: 1 o'quvchi uchun oylik ulush ÷ shu oydagi darslar soni = 1 dars narxi.

    O'qituvchi faqat kelgan o'quvchining darsi uchun oladi.
    Stavka (rate) = 1 SOATLIK dars uchun 1 o'quvchining oylik ulushi (standart 75 000).
    Math/English: 2 soat dars = 2 x 75 000 = 150 000. Kids: o'qituvchi har guruhga 1 soatdan kiradi = 75 000."""
    s = Setting.get()
    rate = teacher.rate if teacher.rate is not None else s.default_rate
    out = []
    for g in Group.objects.filter(teachers=teacher).select_related("subject"):
        hours = 1 if g.subject.is_kids else 2  # o'qituvchining shu guruhdagi haftalik dars soati (bir darsda)
        _, total = lessons(g.days, dt.date(int(month[:4]), int(month[5:7]), 1), month)
        recs = Session.objects.filter(group=g, date__startswith=month)  # davomat saqlanishi bilan darrov hisoblanadi
        present = recs.filter(records__present=True).count()
        absent = recs.filter(records__present=False).count()
        per = rate * hours / total if total else 0
        out.append(
            {
                "group": g.name,
                "hours": hours,
                "lessons": total,
                "per_lesson": round(per),
                "present": present,
                "absent": absent,
                "earned": round(present * per),
            }
        )
    return out


def teacher_student_days(teacher: User, month: str) -> float:
    """Saqlangan davomatdagi kelgan o'quvchilar soni; Kidsda ikki o'qituvchi teng bo'lishadi."""
    return sum(r["present"] for r in teacher_breakdown(teacher, month))


def salary_of(user: User, month: str) -> dict:
    s = Setting.get()
    breakdown = None
    if user.role == Role.SUPPORT:
        accrued, days, rate = user.monthly_salary, None, None
    else:
        breakdown = teacher_breakdown(user, month)
        days = sum(r["present"] for r in breakdown)
        rate = user.rate if user.rate is not None else s.default_rate
        accrued = sum(r["earned"] for r in breakdown)
    paid = CashEntry.objects.filter(kind="chiqim", category="oylik", staff=user, month=month).aggregate(t=Sum("amount"))["t"] or 0
    return {
        "staff": user.id,
        "name": str(user),
        "role": user.role,
        "student_days": days,
        "rate": rate,
        "breakdown": breakdown,
        "accrued": accrued,
        "paid": paid,
        "left": accrued - paid,  # manfiy bo'lsa — avans oylikdan ko'p berilgan
    }


@transaction.atomic
def pay_salary(user: User, month: str, by: User, amount: int | None = None, note: str = "") -> CashEntry:
    """amount berilmasa qolgan oylikning hammasi to'lanadi; berilsa — avans/qisman to'lov (oylik hisoblanmasdan oldin ham mumkin)."""
    row = salary_of(user, month)
    if amount is None:
        if row["left"] <= 0:
            raise BusinessError("Oylik to'liq to'langan")
        amount, note = row["left"], note or "Oylik"
    else:
        if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0:
            raise BusinessError("Summa musbat butun son bo'lsin")
        if amount > 100_000_000:
            raise BusinessError("Summa juda katta")
        note = note or ("Avans" if amount < row["left"] or row["accrued"] == 0 else "Oylik")
    return CashEntry.objects.create(
        kind="chiqim", category="oylik", amount=amount, date=today(), month=month, staff=user, note=note[:255], by=by
    )


def salary_payments(user: User, month: str) -> list[dict]:
    qs = CashEntry.objects.filter(kind="chiqim", category="oylik", staff=user, month=month).order_by("-date", "-id")
    return [{"id": c.id, "date": c.date, "amount": c.amount, "note": c.note} for c in qs]


def rollover() -> dict:
    """Oy avtomatik o'tishi: yangi oyni ochadi va o'tgan oylarni (davomati yakunlangan bo'lsa) yopadi. Sozlamalarga bog'liq."""
    s = Setting.get()
    cur, out = month_of(today()), {"extended": 0, "closed": []}
    if s.auto_next_month:
        sy, sm = map(int, s.academic_start.split("-"))
        cy, cm = map(int, cur.split("-"))
        need = min(24, (cy - sy) * 12 + (cm - sm) + 1)
        if need > s.academic_months:
            out["extended"] = need - s.academic_months
            s.academic_months = need
            s.save()
    if s.auto_close_month:
        for m in academic_months():
            if m >= cur or is_closed(m):
                continue
            if Session.objects.filter(date__startswith=m, finalized=False).exists():
                continue
            MonthClosing.objects.update_or_create(month=m, defaults={"is_closed": True, "closed_by": None, "closed_at": timezone.now()})
            out["closed"].append(m)
    return out


def month_rows(month: str) -> list[dict]:
    """To'lov jadvali uchun: har bir faol o'quvchining shu oydagi holati (bitta so'rovda)."""
    from apps.academics.services import activate_due_students

    activate_due_students()
    students = list(Student.objects.filter(status=Student.Status.ACTIVE).prefetch_related("enrollments__group"))
    leds, months = build_ledgers(students), academic_months()
    rows = []
    for s in students:
        ld = leds[s.id]
        rows.append(
            {
                "student": s.id,
                "name": s.full_name,
                "phone": s.phone,
                "groups": [e.group.name for e in s.enrollments.all() if e.left_on is None],
                "base": ld.base(month),
                "discount": ld.discount(month),
                "due": ld.due(month),
                "paid": ld.paid(month),
                "owe": ld.owe(month),
                "prev_debt": ld.prev_debt(month, months),
                "status": ld.status(month),
            }
        )
    return rows
