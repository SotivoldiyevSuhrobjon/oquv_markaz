import datetime as dt

import pytest

from apps.academics import services
from apps.academics.models import Group
from apps.core.exceptions import BusinessError
from apps.core.models import Setting


@pytest.mark.django_db
def test_enroll_limit(group):
    from apps.academics.models import Student

    Setting.objects.update_or_create(pk=1, defaults={"max_group_size": 2})
    for i in range(2):
        services.enroll(Student.objects.create(full_name=f"S{i}", started_on=dt.date(2026, 9, 1)), group)
    with pytest.raises(BusinessError):
        services.enroll(Student.objects.create(full_name="S9", started_on=dt.date(2026, 9, 1)), group)


@pytest.mark.django_db
def test_no_double_enroll(group, student):
    services.enroll(student, group)
    with pytest.raises(BusinessError):
        services.enroll(student, group)


@pytest.mark.django_db
def test_archive_removes_from_groups(group, student):
    services.enroll(student, group)
    services.archive_student(student, "left", "ko'chdi")
    assert not group.enrollments.filter(left_on__isnull=True).exists()


@pytest.mark.django_db
def test_later_requires_date(student):
    with pytest.raises(BusinessError):
        services.archive_student(student, "later")


@pytest.mark.django_db
def test_attendance_flow(group, student, teacher, teacher2, api):
    services.enroll(student, group)
    c = api(teacher)
    body = {"group": group.id, "date": "2026-10-14", "records": [{"student": student.id, "present": False}]}
    assert c.post("/api/attendance/mark/", body, format="json").status_code == 200
    assert c.post("/api/attendance/finalize/", {"group": group.id, "date": "2026-10-14"}, format="json").status_code == 200
    # yakunlangandan keyin o'zgartirib bo'lmaydi
    assert c.post("/api/attendance/mark/", body, format="json").status_code == 400
    # boshqa o'qituvchi belgilay olmaydi
    assert api(teacher2).post("/api/attendance/mark/", body, format="json").status_code == 403
    # o'qituvchi qayta ocha olmaydi
    assert c.post("/api/attendance/reopen/", {"group": group.id, "date": "2026-10-14"}, format="json").status_code == 403


@pytest.mark.django_db
def test_finalize_requires_all_marked(group, student, teacher, api):
    services.enroll(student, group)
    r = api(teacher).post("/api/attendance/finalize/", {"group": group.id, "date": "2026-10-14"}, format="json")
    assert r.status_code == 400


@pytest.mark.django_db
def test_group_conflict_blocked_for_new_group(group, math, admin, api):
    r = api(admin).post(
        "/api/groups/", {"name": "Mat_2", "subject": "math", "room": "101", "days": "DCJ", "start_time": "08:00"}, format="json"
    )
    assert r.status_code == 400
    assert "schedule" in r.data


@pytest.mark.django_db
def test_group_no_conflict_different_room(group, math, admin, api):
    r = api(admin).post(
        "/api/groups/", {"name": "Mat_2", "subject": "math", "room": "102", "days": "DCJ", "start_time": "08:00"}, format="json"
    )
    assert r.status_code == 201, r.data


@pytest.mark.django_db
def test_start_time_window(math, admin, api):
    r = api(admin).post(
        "/api/groups/", {"name": "Mat_9", "subject": "math", "room": "103", "days": "DCJ", "start_time": "18:00"}, format="json"
    )
    assert r.status_code == 400


@pytest.mark.django_db
def test_teacher_sees_only_own_groups(group, math, teacher, teacher2, api):
    Group.objects.create(name="Mat_7", subject=math)
    assert [g["name"] for g in api(teacher).get("/api/groups/").data["results"]] == ["Mat_1"]
    assert api(teacher2).get("/api/groups/").data["results"] == []
