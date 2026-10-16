import pytest

from apps.academics.models import Room


@pytest.mark.django_db
def test_rooms_seeded_and_listed(admin, api, group):
    Room.objects.get_or_create(name="101")
    r = api(admin).get("/api/rooms/")
    assert r.status_code == 200
    assert "101" in [x["name"] for x in r.data]


@pytest.mark.django_db
def test_add_room_and_duplicate(admin, api):
    c = api(admin)
    assert c.post("/api/rooms/", {"name": "301"}, format="json").status_code == 201
    assert c.post("/api/rooms/", {"name": "301"}, format="json").status_code == 400
    names = [x["name"] for x in c.get("/api/rooms/").data]
    assert "301" in names


@pytest.mark.django_db
def test_rooms_in_suggestions_pool(admin, api):
    from apps.academics import services

    Room.objects.create(name="305")
    assert "305" in services.rooms()


@pytest.mark.django_db
def test_cannot_delete_room_in_use(admin, api, group):
    room, _ = Room.objects.get_or_create(name=group.room)
    r = api(admin).delete(f"/api/rooms/{room.id}/")
    assert r.status_code == 400
    free = Room.objects.create(name="999")
    assert api(admin).delete(f"/api/rooms/{free.id}/").status_code == 204


@pytest.mark.django_db
def test_teacher_cannot_add_room(teacher, api):
    assert api(teacher).post("/api/rooms/", {"name": "400"}, format="json").status_code == 403


@pytest.mark.django_db
def test_salary_detail_and_rate_edit(bugalter, teacher, group, api):
    c = api(bugalter)
    r = c.get(f"/api/salary/{teacher.id}/?month=2026-10")
    assert r.status_code == 200
    assert r.data["groups"][0]["name"] == "Mat_1"
    r = c.patch(f"/api/salary/{teacher.id}/", {"rate": 12000}, format="json")
    assert r.status_code == 200 and r.data["rate"] == 12000
    teacher.refresh_from_db()
    assert teacher.rate == 12000


@pytest.mark.django_db
def test_salary_detail_forbidden_for_teacher(teacher, teacher2, api):
    assert api(teacher).get(f"/api/salary/{teacher2.id}/").status_code == 403


@pytest.mark.django_db
def test_salary_rate_validation(admin, teacher, api):
    assert api(admin).patch(f"/api/salary/{teacher.id}/", {"rate": -5}, format="json").status_code == 400
    assert api(admin).patch(f"/api/salary/{teacher.id}/", {"rate": "abc"}, format="json").status_code == 400


@pytest.mark.django_db
def test_dashboard_totals(admin, teacher, group, student, api):
    from apps.academics import services

    services.enroll(student, group)
    t = api(admin).get("/api/groups/stats/").data["totals"]
    assert (t["teachers"], t["supports"], t["groups"], t["students"]) == (1, 0, 1, 1)
    assert t["nogroup"] == 0 and t["free_places"] >= 1 and t["rooms"] >= 1
