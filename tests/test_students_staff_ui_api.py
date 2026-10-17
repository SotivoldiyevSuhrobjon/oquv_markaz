"""O'quvchilar bo'limi (qidiruv/filtr), xodim tavsifi va Kids o'qituvchi tartibi."""

import datetime as dt

import pytest

from apps.academics import schedule, services
from apps.academics.models import Group, Student

from .conftest import make_user


@pytest.mark.django_db
def test_staff_description_roundtrip(admin, api):
    c = api(admin)
    r = c.post(
        "/api/staff/",
        {
            "username": "ali",
            "full_name": "Ali",
            "role": "teacher",
            "password": "Zor-Parol-9876",
            "description": "10 yillik tajriba\nOlimpiada ustozi",
        },
        format="json",
    )
    assert r.status_code == 201, r.data
    assert r.data["description"].startswith("10 yillik")
    r = c.patch(f"/api/staff/{r.data['id']}/", {"description": "Yangilandi"}, format="json")
    assert r.data["description"] == "Yangilandi"
    assert c.get("/api/staff/").data["results"][0] is not None if isinstance(c.get("/api/staff/").data, dict) else True


@pytest.mark.django_db
def test_student_search_by_phone_and_filters(group, math, admin, api):
    a = Student.objects.create(full_name="Aziz Karimov", phone="+998901112233", started_on=dt.date(2026, 9, 1))
    b = Student.objects.create(full_name="Bobur Aliyev", phone="+998935554433", started_on=dt.date(2026, 9, 1))
    services.enroll(a, group)
    c = api(admin)

    def names(qs):
        data = c.get("/api/students/" + qs).data
        data = data["results"] if isinstance(data, dict) else data
        return sorted(x["full_name"] for x in data)

    assert names("?q=901112233") == ["Aziz Karimov"]  # telefon bo'yicha
    assert names("?q=bobur") == ["Bobur Aliyev"]
    assert names("?subject=math") == ["Aziz Karimov"]
    assert names("?nogroup=1") == ["Bobur Aliyev"]
    assert b.id  # guruhsiz o'quvchi


@pytest.mark.django_db
def test_student_edit_requires_new_section(group, administrator, bugalter, api):
    s = Student.objects.create(full_name="Sinov", started_on=dt.date(2026, 9, 1))
    assert (
        api(administrator).patch(f"/api/students/{s.id}/", {"phone": "+998901234567", "admitted_on": None}, format="json").status_code
        == 200
    )
    # bugalter 'new' bo'limiga ruxsatsiz — tahrirlay olmaydi
    assert api(bugalter).patch(f"/api/students/{s.id}/", {"phone": "+998900000000"}, format="json").status_code == 403


@pytest.mark.django_db
def test_kids_order_is_per_group(kids, teacher, teacher2, admin, api):
    """Bir xil juftlik, bir vaqt: faqat tartib teskari bo'lsa to'qnashmaydi; tartib faqat shu guruhga ta'sir qiladi."""
    g1 = Group.objects.create(name="Kids_uz1", subject=kids, room="102", days="SPSh", start_time=dt.time(8, 0), kids_order="E")
    g2 = Group.objects.create(name="Kids_uz4", subject=kids, room="103", days="SPSh", start_time=dt.time(8, 0), kids_order="E")
    for g in (g1, g2):
        g.group_teachers.create(teacher=teacher, position=0)  # English
        g.group_teachers.create(teacher=teacher2, position=1)  # Math
    slots = services.all_slots()
    assert schedule.conflicts_of(slots[0], slots)  # ikkalasi ham English-birinchi: to'qnashuv
    r = api(admin).patch(f"/api/groups/{g2.id}/", {"kids_order": "M"}, format="json")
    assert r.status_code == 200, r.data
    g1.refresh_from_db()
    g2.refresh_from_db()
    assert (g1.kids_order, g2.kids_order) == ("E", "M")  # g1 o'zgarmadi
    slots = services.all_slots()
    assert not [c for s in slots for c in schedule.conflicts_of(s, slots) if c["kind"] == "teacher"]


def test_make_user_helper_importable():
    assert callable(make_user)


@pytest.mark.django_db
def test_parent_phone_roundtrip_and_search(admin, api, group):
    c = api(admin)
    r = c.post(
        "/api/students/",
        {"full_name": "Sardor Rahimov", "phone": "+998901112233", "parent_phone": "+998935556677", "group": group.id},
        format="json",
    )
    assert r.status_code == 201 and r.data["parent_phone"] == "+998935556677"
    found = c.get("/api/students/?q=5556677").data["results"]
    assert [x["full_name"] for x in found] == ["Sardor Rahimov"]
    bad = c.post("/api/students/", {"full_name": "X Y", "parent_phone": "abc"}, format="json")
    assert bad.status_code == 400
