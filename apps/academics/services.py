import datetime as dt

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from apps.core.exceptions import BusinessError
from apps.core.models import Setting
from apps.core.utils import now as now_local
from apps.core.utils import today

from .models import Attendance, Enrollment, Group, ParentContact, Room, Session, Student, SupportAttendance
from .schedule import WEEKDAYS, Slot


def slot_of(g: Group) -> Slot:
    teachers = [gt.teacher.username for gt in g.group_teachers.select_related("teacher").all()]
    supports = [u.username for u in g.supports.all()]
    return Slot(g.id, g.name, g.days, g.start_hour, g.room, g.subject.is_kids, g.kids_order, teachers, supports)


def all_slots(exclude_id=None) -> list[Slot]:
    qs = Group.objects.filter(is_active=True).select_related("subject").prefetch_related("group_teachers__teacher", "supports")
    return [slot_of(g) for g in qs if g.id != exclude_id]


def room_sort_key(r: str):
    return (0, int(r), r) if r.isdigit() else (1, 0, r)


def rooms() -> list[str]:
    """Ro'yxatdagi xonalar + guruhlarda ishlatilganlar (Excel'dan kelgan bo'lishi mumkin)."""
    known = set(Room.objects.values_list("name", flat=True))
    used = set(Group.objects.exclude(room="").values_list("room", flat=True))
    return sorted(known | used, key=room_sort_key)


@transaction.atomic
def enroll(student: Student, group: Group, on: dt.date | None = None) -> Enrollment:
    if not group.is_active:
        raise BusinessError("Guruh arxivda")
    if student.status != Student.Status.ACTIVE:
        raise BusinessError("Arxivdagi o'quvchini avval faollashtiring")
    active = group.enrollments.filter(left_on__isnull=True).count()
    if active >= Setting.get().max_group_size:
        raise BusinessError(f"Guruh to'lgan (maksimum {Setting.get().max_group_size} ta)")
    if group.enrollments.filter(student=student, left_on__isnull=True).exists():
        raise BusinessError("O'quvchi bu guruhda allaqachon bor")
    return Enrollment.objects.create(student=student, group=group, joined_on=on or today())


def unenroll(student: Student, group: Group) -> None:
    n = group.enrollments.filter(student=student, left_on__isnull=True).update(left_on=today())
    if not n:
        raise BusinessError("O'quvchi bu guruhda emas")


@transaction.atomic
def archive_student(student: Student, status: str, reason: str = "", start: dt.date | None = None) -> Student:
    if status not in {Student.Status.LEFT, Student.Status.PAUSED, Student.Status.LATER, Student.Status.REJECTED}:
        raise BusinessError("Noto'g'ri arxiv holati")
    if status == Student.Status.LATER and not start:
        raise BusinessError("'Keyin boshlaydi' uchun boshlanish sanasi kerak")
    student.enrollments.filter(left_on__isnull=True).update(left_on=today())
    student.status, student.archive_reason, student.archive_start = status, reason, start
    student.archived_at = timezone.now()
    student.save()
    return student


def activate_due_students() -> int:
    """'Keyin boshlaydi' o'quvchilar: boshlanish sanasi kelsa avtomatik faol bo'ladi (to'lov shu sanadan hisoblanadi)."""
    due = Student.objects.filter(status=Student.Status.LATER, archive_start__isnull=False, archive_start__lte=today())
    n = 0
    for s in due:
        s.started_on, s.status, s.archive_reason, s.archive_start, s.archived_at = s.archive_start, Student.Status.ACTIVE, "", None, None
        s.save()
        n += 1
    return n


def restore_student(student: Student, group: Group | None = None) -> Student:
    student.status, student.archive_reason, student.archive_start, student.archived_at = Student.Status.ACTIVE, "", None, None
    student.save()
    if group:
        enroll(student, group)
    return student


# ---- Davomat ----
def absences(student_id: int) -> int:
    return Attendance.objects.filter(student_id=student_id, present=False).count()


def group_students(group: Group):
    return Student.objects.filter(enrollments__group=group, enrollments__left_on__isnull=True, status=Student.Status.ACTIVE).distinct()


def sheet(group: Group, date: dt.date) -> dict:
    session = Session.objects.filter(group=group, date=date).first()
    marks = {r.student_id: r.present for r in session.records.all()} if session else {}
    counts = dict(
        Attendance.objects.filter(student__in=group_students(group), present=False).values_list("student_id").annotate(n=Count("id"))
    )
    smarks = {r.student_id: r.present for r in session.support_records.all()} if session else {}
    rows = [
        {
            "student": s.id,
            "name": s.full_name,
            "present": marks.get(s.id),
            "absences": counts.get(s.id, 0),
            "support_present": smarks.get(s.id),
        }
        for s in group_students(group)
    ]
    return {
        "group": group.id,
        "date": date,
        "finalized": bool(session and session.finalized),
        "has_support": group.supports.exists(),
        "supports": [str(u) for u in group.supports.all()],
        "students": rows,
    }


@transaction.atomic
def mark_support(group: Group, date: dt.date, records: list[dict], user) -> Session:
    """Support darsi davomati. Asosiy davomat yakunlangan bo'lsa ham belgilanadi (support dars keyin bo'ladi)."""
    if date > today():
        raise BusinessError("Kelajak sanasiga davomat belgilab bo'lmaydi")
    if not group.supports.exists():
        raise BusinessError("Bu guruhga support biriktirilmagan")
    session, _ = Session.objects.select_for_update().get_or_create(group=group, date=date)
    valid = set(group_students(group).values_list("id", flat=True))
    for r in records:
        if r["student"] not in valid:
            raise BusinessError("O'quvchi bu guruhda emas")
        SupportAttendance.objects.update_or_create(
            session=session, student_id=r["student"], defaults={"present": r["present"], "marked_by": user}
        )
    return session


@transaction.atomic
def mark(group: Group, date: dt.date, records: list[dict], user) -> Session:
    if date > today():
        raise BusinessError("Kelajak sanasiga davomat belgilab bo'lmaydi")
    session, _ = Session.objects.select_for_update().get_or_create(group=group, date=date)
    if session.finalized:
        raise BusinessError("Davomat yakunlangan. O'zgartirish uchun administrator qayta ochishi kerak")
    valid = set(group_students(group).values_list("id", flat=True))
    for r in records:
        if r["student"] not in valid:
            raise BusinessError("O'quvchi bu guruhda emas")
        Attendance.objects.update_or_create(session=session, student_id=r["student"], defaults={"present": r["present"], "marked_by": user})
    return session


@transaction.atomic
def finalize(group: Group, date: dt.date, user) -> Session:
    session = Session.objects.select_for_update().filter(group=group, date=date).first()
    if not session:
        raise BusinessError("Avval davomatni belgilang")
    if session.finalized:
        raise BusinessError("Allaqachon yakunlangan")
    unmarked = group_students(group).exclude(id__in=session.records.values("student_id")).count()
    if unmarked:
        raise BusinessError(f"{unmarked} ta o'quvchi belgilanmagan")
    session.finalized, session.finalized_by, session.finalized_at = True, user, timezone.now()
    session.save()
    return session


def reopen(group: Group, date: dt.date) -> Session:
    session = Session.objects.filter(group=group, date=date, finalized=True).first()
    if not session:
        raise BusinessError("Yakunlangan davomat topilmadi")
    session.finalized, session.finalized_by, session.finalized_at = False, None, None
    session.save()
    return session


def alerts(limit_absences: int | None = None, groups=None):
    """Sozlamadagi chegaradan (standart 3) ko'p dars qoldirgan va shundan keyin hali bog'lanilmagan o'quvchilar."""
    if limit_absences is None:
        from apps.core.models import Setting

        limit_absences = Setting.get().alert_threshold
    qs = Student.objects.filter(status=Student.Status.ACTIVE)
    if groups is not None:
        qs = qs.filter(enrollments__group__in=groups, enrollments__left_on__isnull=True).distinct()
    qs = qs.annotate(miss=Count("attendance", filter=Q(attendance__present=False))).filter(miss__gt=limit_absences)
    out = []
    for s in qs:
        last = s.contacts.first()
        if last is None or s.miss > last.missed_at_time:
            out.append(s)
    return out


def add_contact(student: Student, note: str, user) -> ParentContact:
    note = (note or "").strip()
    if not note:
        raise BusinessError("Ota-ona bilan gaplashgandan keyin izoh yozish majburiy")
    return ParentContact.objects.create(student=student, by=user, note=note, missed_at_time=absences(student.id))


# ---- Davomat vaqt oynasi ----
ATT_BEFORE_MIN = 10  # dars boshlanishidan oldin
ATT_AFTER_MIN = 15  # dars tugagandan keyin (kechikib saqlash uchun)


def attendance_window(group: Group, date: dt.date, support: bool = False):
    """(boshlanish, tugash) — o'qituvchi davomatni shu oraliqda belgilay/tahrirlay oladi.
    Jadval kiritilmagan guruhda None (cheklov yo'q). Support darsi asosiy dars tugagach 1 soat."""
    if group.start_time is None or group.days not in WEEKDAYS:
        return None
    if date.weekday() not in WEEKDAYS[group.days]:
        return (None, None)  # bu kun dars kuni emas
    tz = timezone.get_current_timezone()
    h = group.start_time.hour + (2 if support else 0)
    start = dt.datetime.combine(date, dt.time(h, group.start_time.minute), tzinfo=tz)
    end = start + dt.timedelta(hours=1 if support else 2)
    return start - dt.timedelta(minutes=ATT_BEFORE_MIN), end + dt.timedelta(minutes=ATT_AFTER_MIN)


def attendance_open(group: Group, date: dt.date, support: bool = False) -> bool:
    """Hozir shu guruh/sana davomatini admin bo'lmagan xodim o'zgartira oladimi."""
    w = attendance_window(group, date, support)
    if w is None:
        return True
    if w[0] is None:
        return False
    return w[0] <= now_local() <= w[1]
