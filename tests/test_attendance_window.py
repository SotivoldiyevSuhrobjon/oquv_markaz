import datetime as dt

import pytest

from apps.academics import services

WED = "2026-10-14"  # chorshanba: Du-Chor-Ju kuni; guruh 08:00–10:00


def body(group, student, date=WED):
    return {"group": group.id, "date": date, "records": [{"student": student.id, "present": True}]}


@pytest.fixture
def enrolled(group, student):
    services.enroll(student, group)
    return student


def test_teacher_marks_only_inside_lesson_time(group, enrolled, teacher, api, real_window):
    c = api(teacher)
    real_window(2026, 10, 14, 7, 30)  # dars boshlanishiga 30 daqiqa bor
    assert c.post("/api/attendance/mark/", body(group, enrolled), format="json").status_code == 403
    real_window(2026, 10, 14, 7, 55)  # 10 daqiqa oldin ruxsat
    assert c.post("/api/attendance/mark/", body(group, enrolled), format="json").status_code == 200
    real_window(2026, 10, 14, 9, 59)
    assert c.post("/api/attendance/mark/", body(group, enrolled), format="json").status_code == 200  # tahrirlash ham mumkin
    real_window(2026, 10, 14, 10, 14)  # 15 daqiqa kechikish ruxsati
    assert c.post("/api/attendance/mark/", body(group, enrolled), format="json").status_code == 200
    real_window(2026, 10, 14, 10, 20)
    r = c.post("/api/attendance/mark/", body(group, enrolled), format="json")
    assert r.status_code == 403 and "admin" in r.json()["detail"]


def test_after_lesson_only_admin_not_administrator(group, enrolled, admin, administrator, api, real_window):
    real_window(2026, 10, 14, 15, 0)
    assert api(administrator).post("/api/attendance/mark/", body(group, enrolled), format="json").status_code == 403
    assert api(admin).post("/api/attendance/mark/", body(group, enrolled), format="json").status_code == 200
    assert api(admin).post("/api/attendance/finalize/", {"group": group.id, "date": WED}, format="json").status_code == 200
    # qayta ochish ham faqat admin
    assert api(administrator).post("/api/attendance/reopen/", {"group": group.id, "date": WED}, format="json").status_code == 403
    assert api(admin).post("/api/attendance/reopen/", {"group": group.id, "date": WED}, format="json").status_code == 200


def test_not_a_lesson_day_is_locked_for_teacher(group, enrolled, teacher, api, real_window):
    real_window(2026, 10, 15, 9, 0)  # payshanba — Du-Chor-Ju guruhi uchun dars kuni emas
    assert api(teacher).post("/api/attendance/mark/", body(group, enrolled, "2026-10-15"), format="json").status_code == 403


def test_sheet_reports_can_edit_and_window(group, enrolled, teacher, admin, api, real_window):
    real_window(2026, 10, 14, 11, 0)
    r = api(teacher).get(f"/api/attendance/?group={group.id}&date={WED}").json()
    assert r["can_edit"] is False and r["window"] == "07:50–10:15" and r["is_admin"] is False
    assert api(admin).get(f"/api/attendance/?group={group.id}&date={WED}").json()["can_edit"] is True


def test_group_without_schedule_is_not_locked(math, teacher, student, api, real_window):
    from apps.academics.models import Group

    g = Group.objects.create(name="Mat_9", subject=math)
    g.group_teachers.create(teacher=teacher)
    services.enroll(student, g)
    real_window(2026, 10, 14, 23, 0)
    assert api(teacher).post("/api/attendance/mark/", body(g, student), format="json").status_code == 200


def test_support_window_is_the_hour_after_main_lesson(group, enrolled, api, real_window):
    from apps.accounts.models import Role, User

    s = User(username="sup", role=Role.SUPPORT)
    s.set_password("Str0ng-pass-123")
    s.save()
    group.supports.add(s)
    c = api(s)
    sbody = {"group": group.id, "date": WED, "records": [{"student": enrolled.id, "present": True}]}
    real_window(2026, 10, 14, 9, 0)  # asosiy dars vaqti — support darsi hali boshlanmagan
    assert c.post("/api/attendance/support/", sbody, format="json").status_code == 403
    real_window(2026, 10, 14, 10, 30)
    assert c.post("/api/attendance/support/", sbody, format="json").status_code == 200
    real_window(2026, 10, 14, 11, 30)
    assert c.post("/api/attendance/support/", sbody, format="json").status_code == 403


def test_window_helpers_without_time():
    from apps.academics.models import Group

    assert services.attendance_window(Group(days="DCJ"), dt.date(2026, 10, 14)) is None


def test_teacher_sees_only_own_support_plan(group, teacher, teacher2, api, math):
    import datetime as dt

    from apps.academics.models import Group
    from apps.accounts.models import Role, User

    s = User(username="sup2", role=Role.SUPPORT)
    s.set_password("Str0ng-pass-123")
    s.save()
    other = Group.objects.create(name="Mat_7", subject=math, room="102", days="DCJ", start_time=dt.time(8, 0))
    other.group_teachers.create(teacher=teacher2)
    group.supports.add(s)
    other.supports.add(s)
    mine = api(teacher).get("/api/groups/support-plan/").json()
    assert [p["name"] for p in mine] == ["Mat_1"]
    assert len(api(s).get("/api/groups/support-plan/").json()) == 2
