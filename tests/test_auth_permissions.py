import pytest

from apps.accounts.models import User


@pytest.mark.django_db
def test_login_returns_tokens_and_permissions(admin, api):
    from rest_framework.test import APIClient

    r = APIClient().post("/api/auth/login/", {"username": "admin", "password": "Str0ng-pass-123"}, format="json")
    assert r.status_code == 200
    assert r.data["access"] and r.data["refresh"]
    assert r.data["user"]["permissions"]["sal"] == 2
    assert "password" not in r.data["user"]


@pytest.mark.django_db
def test_login_wrong_password(admin):
    from rest_framework.test import APIClient

    assert APIClient().post("/api/auth/login/", {"username": "admin", "password": "x"}, format="json").status_code == 401


@pytest.mark.django_db
def test_anonymous_blocked(db):
    from rest_framework.test import APIClient

    for url in ("/api/groups/", "/api/students/", "/api/payments/", "/api/staff/", "/api/audit/"):
        assert APIClient().get(url).status_code == 401


@pytest.mark.django_db
def test_administrator_cannot_see_salary(administrator, api):
    assert api(administrator).get("/api/salary/").status_code == 403


@pytest.mark.django_db
def test_bugalter_cannot_mark_attendance_or_create_group(bugalter, api, math):
    assert api(bugalter).post("/api/groups/", {"name": "X", "subject": "math"}, format="json").status_code == 403


@pytest.mark.django_db
def test_teacher_cannot_touch_finance(teacher, api):
    c = api(teacher)
    assert c.get("/api/payments/").status_code == 403
    assert c.get("/api/finance/overview/").status_code == 403
    assert c.get("/api/audit/").status_code == 403


@pytest.mark.django_db
def test_staff_password_never_returned_and_hashed(admin, api):
    r = api(admin).post(
        "/api/staff/", {"username": "yangi", "full_name": "Yangi", "role": "teacher", "password": "Zor-Parol-9876"}, format="json"
    )
    assert r.status_code == 201, r.data
    assert "password" not in r.data
    u = User.objects.get(username="yangi")
    assert u.password != "Zor-Parol-9876" and u.check_password("Zor-Parol-9876")


@pytest.mark.django_db
def test_administrator_cannot_create_admin(administrator, api):
    administrator.perms = {"stf": 2}
    administrator.save()
    r = api(administrator).post("/api/staff/", {"username": "zz", "role": "admin", "password": "Zor-Parol-9876"}, format="json")
    assert r.status_code == 400


@pytest.mark.django_db
def test_weak_password_rejected(admin, api):
    r = api(admin).post("/api/staff/", {"username": "zz", "role": "teacher", "password": "123"}, format="json")
    assert r.status_code == 400


@pytest.mark.django_db
def test_cannot_archive_self(admin, api):
    assert api(admin).post(f"/api/staff/{admin.id}/archive/").status_code == 400


@pytest.mark.django_db
def test_audit_log_admin_only_and_records(admin, administrator, api, math):
    api(admin).post("/api/subjects/", {"slug": "eng", "name": "English", "price": 500000}, format="json")
    assert api(administrator).get("/api/audit/").status_code == 403
    r = api(admin).get("/api/audit/")
    assert r.status_code == 200 and any(x["action"] == "subject.create" for x in r.data["results"])


@pytest.mark.django_db
def test_healthz(client):
    assert client.get("/healthz/").json() == {"status": "ok"}


@pytest.mark.django_db
def test_init_center_clean_start():
    from django.core.management import call_command

    from apps.academics.models import Student, Subject

    call_command("init_center", "--password", "Zor-Parol-9876")
    assert Subject.objects.count() == 3 and Student.objects.count() == 0
    assert User.objects.get(username="admin").role == "admin"
