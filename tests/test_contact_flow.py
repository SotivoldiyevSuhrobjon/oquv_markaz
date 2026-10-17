import datetime as dt

import pytest

from apps.academics import services
from apps.academics.models import Attendance, ParentContact, Session


def _absent(group, student, day, present=False):
    s, _ = Session.objects.get_or_create(group=group, date=day)
    Attendance.objects.update_or_create(session=s, student=student, defaults={"present": present})


@pytest.fixture
def four_misses(group, student, administrator):
    student.phone, student.parent_phone = "+998901112233", "+998907778899"
    student.save()
    services.enroll(student, group)
    for i in range(4):
        _absent(group, student, dt.date(2026, 10, 1 + i))
    return student


@pytest.mark.django_db
def test_alert_has_both_phones_and_groups(four_misses, group, administrator, api):
    r = api(administrator).get("/api/alerts/").json()
    assert len(r) == 1
    row = r[0]
    assert row["phone"] == "+998901112233" and row["parent_phone"] == "+998907778899"
    assert row["absences"] == 4 and row["groups"] == [group.name] and row["last_note"] == ""


@pytest.mark.django_db
def test_note_required(four_misses, administrator, api):
    c = api(administrator)
    assert c.post(f"/api/students/{four_misses.id}/contacts/", {"note": "  "}, format="json").status_code == 400


@pytest.mark.django_db
def test_contact_hides_then_reappears(four_misses, group, administrator, api):
    c = api(administrator)
    assert c.post(f"/api/students/{four_misses.id}/contacts/", {"note": "Kasal ekan"}, format="json").status_code == 201
    assert c.get("/api/alerts/").json() == []
    # bog'lanilgandan keyin keldi (1 marta), keyingi darsga yana kelmadi -> qayta chiqadi
    _absent(group, four_misses, dt.date(2026, 10, 8), present=True)
    assert c.get("/api/alerts/").json() == []
    _absent(group, four_misses, dt.date(2026, 10, 9))
    row = c.get("/api/alerts/").json()[0]
    assert row["absences"] == 5 and row["since_contact"] == 1 and row["last_note"] == "Kasal ekan"


@pytest.mark.django_db
def test_board_today_and_history(four_misses, group, administrator, api):
    c = api(administrator)
    _absent(group, four_misses, dt.date(2026, 10, 15))
    b = c.get("/api/contact-board/").json()
    assert [x["student"] for x in b["absent_today"]] == [four_misses.id] and b["absent_today"][0]["parent_phone"]
    c.post(f"/api/students/{four_misses.id}/contacts/", {"note": "Ertaga keladi"}, format="json")
    ParentContact.objects.update(created_at=dt.datetime(2026, 10, 15, 12, 0, tzinfo=dt.UTC))
    b = c.get("/api/contact-board/").json()
    assert b["absent_today"] == [] and b["contacts"][0]["note"] == "Ertaga keladi" and b["contacts"][0]["by"]


@pytest.mark.django_db
def test_teacher_sees_only_own_groups(four_misses, teacher2, api):
    assert api(teacher2).get("/api/alerts/").json() == []
    assert api(teacher2).get("/api/contact-board/").json()["absent_today"] == []


@pytest.mark.django_db
def test_pay_calc_and_new_month(administrator, admin, math, api):
    r = api(administrator).get(f"/api/finance/calc/?month=2026-10&days=DCJ&from=2026-10-15&subjects={math.id}&discount=100000").json()
    assert r["lessons_total"] == 13 and r["lessons_left"] == 7 and r["full"] == 500000
    assert r["amount"] == round(500000 * 7 / 13)
    assert api(administrator).get("/api/finance/calc/?month=2026-10&days=XX").status_code == 400
    c = api(admin)
    n = c.get("/api/settings/").json()["academic_months"]
    assert c.patch("/api/settings/", {"academic_months": n + 1}, format="json").status_code == 200
    assert c.patch("/api/settings/", {"academic_months": 99}, format="json").status_code == 400


@pytest.mark.django_db
def test_rejected_status_and_auto_activation(administrator, api):
    from apps.academics.models import Student

    c = api(administrator)
    s = Student.objects.create(full_name="Yangi Bola", started_on=dt.date(2026, 9, 1))
    r = Student.objects.create(full_name="Rad Bola", started_on=dt.date(2026, 9, 1))
    assert c.post(f"/api/students/{r.id}/archive/", {"status": "rejected", "reason": "Narx mos emas"}, format="json").status_code == 200
    r.refresh_from_db()
    assert r.status == "rejected" and r.archive_reason == "Narx mos emas"
    # keyin boshlaydi: sana kelmagan -> arxivda; sana kelgach -> avtomatik faol
    c.post(f"/api/students/{s.id}/archive/", {"status": "later", "start": "2026-10-20"}, format="json")
    assert c.get("/api/students/?archived=1").json()
    s.refresh_from_db()
    assert s.status == "later"
    Student.objects.filter(pk=s.pk).update(archive_start=dt.date(2026, 10, 15))
    c.get("/api/students/")
    s.refresh_from_db()
    assert s.status == "active" and s.started_on == dt.date(2026, 10, 15) and s.archive_start is None


@pytest.mark.django_db
def test_backup_create_list_restore(admin, administrator, teacher, tmp_path, settings, api):
    from apps.academics.models import Student

    settings.BACKUP_DIR = tmp_path
    c = api(admin)
    assert api(administrator).get("/api/backups/").status_code == 403
    Student.objects.create(full_name="Birinchi", started_on=dt.date(2026, 9, 1))
    name = c.post("/api/backups/").json()["name"]
    assert [b["name"] for b in c.get("/api/backups/").json()] == [name]
    assert c.get(f"/api/backups/{name}/").status_code == 200
    assert c.get("/api/backups/..%2Fetc/").status_code in (400, 404)
    Student.objects.create(full_name="Ikkinchi", started_on=dt.date(2026, 9, 1))
    assert c.post(f"/api/backups/{name}/restore/", {"confirm": "x"}, format="json").status_code == 400
    assert c.post(f"/api/backups/{name}/restore/", {"confirm": name}, format="json").status_code == 200
    assert list(Student.objects.values_list("full_name", flat=True)) == ["Birinchi"]
    assert any(b["safety"] for b in c.get("/api/backups/").json())


@pytest.mark.django_db
def test_impersonate_only_admin(admin, administrator, teacher, api):
    assert api(administrator).post(f"/api/auth/impersonate/{teacher.id}/").status_code == 403
    r = api(admin).post(f"/api/auth/impersonate/{teacher.id}/")
    assert r.status_code == 200 and r.json()["user"]["username"] == teacher.username and r.json()["access"]
    assert api(admin).post(f"/api/auth/impersonate/{admin.id}/").status_code == 400


@pytest.mark.django_db
def test_support_attendance(group, student, teacher, administrator, api):
    from apps.accounts.models import Role
    from tests.conftest import make_user

    sup = make_user("sup1", Role.SUPPORT, monthly_salary=3000000)
    services.enroll(student, group)
    body = {"group": group.id, "date": "2026-10-14", "records": [{"student": student.id, "present": False}]}
    # support guruhga biriktirilmagan -> 400
    assert api(administrator).post("/api/attendance/support/", body, format="json").status_code == 400
    group.supports.add(sup)
    assert api(teacher).post("/api/attendance/support/", body, format="json").status_code == 403
    r = api(sup).post("/api/attendance/support/", body, format="json")
    assert r.status_code == 200 and r.json()["has_support"] and r.json()["students"][0]["support_present"] is False
    assert r.json()["students"][0]["present"] is None
    # support kelmaganligi 3-dars hisobiga qo'shilmaydi, oylik o'zgarmaydi
    assert services.absences(student.id) == 0
    assert api(sup).post("/api/attendance/mark/", body, format="json").status_code == 403


@pytest.mark.django_db
def test_student_birth_date(administrator, api):
    c = api(administrator)
    r = c.post("/api/students/", {"full_name": "Tug'ilgan", "started_on": "2026-09-01", "birth_date": "2014-05-03"}, format="json")
    assert r.status_code == 201 and r.json()["birth_date"] == "2014-05-03"


@pytest.mark.django_db
def test_alert_threshold_setting(four_misses, administrator, admin, api):
    assert len(api(administrator).get("/api/alerts/").json()) == 1  # 4 > 3
    assert api(admin).patch("/api/settings/", {"alert_threshold": 5}, format="json").status_code == 200
    assert api(administrator).get("/api/alerts/").json() == []  # 4 > 5 emas
    assert api(admin).patch("/api/settings/", {"alert_threshold": 0}, format="json").status_code == 400


@pytest.mark.django_db
def test_salary_advance(admin, teacher, api):
    c = api(admin)
    r = c.post(f"/api/salary/{teacher.id}/pay/", {"month": "2026-10", "amount": 200000}, format="json")
    assert r.status_code == 201 and r.json()["paid"] == 200000
    d = c.get(f"/api/salary/{teacher.id}/?month=2026-10").json()
    assert d["salary"]["paid"] == 200000 and d["payments"][0]["note"] == "Avans"
    assert c.post(f"/api/salary/{teacher.id}/pay/", {"month": "2026-10", "amount": -5}, format="json").status_code == 400


@pytest.mark.django_db
def test_rollover_extends_and_closes(admin, api):
    from apps.core.models import Setting
    from apps.finance import services as fs
    from apps.finance.models import MonthClosing

    Setting.objects.update_or_create(pk=1, defaults={"academic_start": "2026-01", "academic_months": 3, "auto_close_month": True})
    out = fs.rollover()  # bugun 2026-10-15: yanvar..mart -> oktyabrgacha cho'ziladi
    assert Setting.get().academic_months == 10 and out["extended"] == 7
    assert set(out["closed"]) == {f"2026-0{i}" for i in range(1, 10)}
    assert MonthClosing.objects.filter(month="2026-10").count() == 0


@pytest.mark.django_db
def test_teacher_extra_permission(admin, teacher, api):
    assert api(teacher).get("/api/finance/overview/").status_code == 403
    assert api(admin).patch(f"/api/staff/{teacher.id}/", {"perms": {"pay": 1}}, format="json").status_code == 200
    teacher.refresh_from_db()
    assert api(teacher).get("/api/finance/overview/").status_code == 200
    assert api(teacher).post("/api/students/", {"full_name": "x", "started_on": "2026-09-01"}, format="json").status_code == 403


def test_support_plan_endpoint_and_support_conflict(admin, api, math):
    import datetime as dt

    from apps.academics.models import Group
    from apps.accounts.models import Role, User

    s1 = User.objects.create_user(username="sup1", password="x", role=Role.SUPPORT)
    g1 = Group.objects.create(name="M1", subject=math, room="101", days="DCJ", start_time=dt.time(8, 0))
    g2 = Group.objects.create(name="M2", subject=math, room="102", days="DCJ", start_time=dt.time(8, 0))
    c = api(admin)
    assert c.post(f"/api/groups/{g1.id}/supports/", {"supports": [s1.id]}, format="json").status_code == 200
    r = c.post(f"/api/groups/{g2.id}/supports/", {"supports": [s1.id]}, format="json")
    assert r.status_code == 400 and r.json()["schedule"]
    plan = c.get("/api/groups/support-plan/").json()
    assert plan == [{"group": g1.id, "name": "M1", "days": "DCJ", "hour": 10, "room": "101", "own_room": True}]
