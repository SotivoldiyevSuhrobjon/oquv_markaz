import datetime as dt
import os

os.environ.setdefault("DJANGO_TESTING", "1")

import pytest  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402

from apps.academics.models import Group, Student, Subject  # noqa: E402
from apps.accounts.models import Role, User  # noqa: E402


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    """Sana qotirilgan: 2026-10-15 (payshanba)."""
    d = dt.date(2026, 10, 15)
    monkeypatch.setattr("apps.core.utils.today", lambda: d)
    for mod in ("apps.finance.services", "apps.academics.services"):
        monkeypatch.setattr(f"{mod}.today", lambda: d, raising=False)
    monkeypatch.setattr("apps.finance.views.today", lambda: d, raising=False)
    return d


def make_user(username, role, **kw):
    u = User(username=username, role=role, full_name=kw.pop("full_name", username), **kw)
    u.set_password("Str0ng-pass-123")
    u.save()
    return u


@pytest.fixture
def admin(db):
    return make_user("admin", Role.ADMIN)


@pytest.fixture
def administrator(db):
    return make_user("adm", Role.ADMINISTRATOR, perms={"att": 2, "pay": 1})


@pytest.fixture
def bugalter(db):
    return make_user("bug", Role.BUGALTER)


@pytest.fixture
def teacher(db):
    return make_user("t1", Role.TEACHER)


@pytest.fixture
def teacher2(db):
    return make_user("t2", Role.TEACHER)


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def api():
    return client_for


@pytest.fixture
def math(db):
    return Subject.objects.create(slug="math", name="Matematika", price=600000, prefix="Mat_")


@pytest.fixture
def kids(db):
    return Subject.objects.create(slug="kids", name="Kids", price=900000, is_kids=True)


@pytest.fixture
def group(math, teacher):
    g = Group.objects.create(name="Mat_1", subject=math, room="101", days="DCJ", start_time=dt.time(8, 0))
    g.group_teachers.create(teacher=teacher)
    return g


@pytest.fixture
def student(db):
    return Student.objects.create(full_name="Ali Valiyev", started_on=dt.date(2026, 9, 1))
