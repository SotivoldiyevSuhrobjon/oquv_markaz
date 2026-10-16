import datetime as dt

import pytest

from apps.academics import services as acad
from apps.core.exceptions import BusinessError
from apps.finance import services
from apps.finance.models import Payment


def test_lessons_proration():
    left, total = services.lessons("DCJ", dt.date(2026, 9, 15), "2026-09")
    assert total == 13 and 0 < left < total


@pytest.fixture
def enrolled(group, student):
    acad.enroll(student, group, dt.date(2026, 9, 1))
    return student


@pytest.mark.django_db
def test_full_month_price_and_partial(enrolled):
    services.add_payment(enrolled, "2026-10", 200000, None)
    led = services.ledger_for(enrolled)
    assert led.due("2026-10") == 600000
    assert led.owe("2026-10") == 400000 and led.status("2026-10") == "partial"


@pytest.mark.django_db
def test_discount_applies_from_month(enrolled):
    services.set_discount(enrolled, "2026-10", 100000, None)
    led = services.ledger_for(enrolled)
    assert led.due("2026-09") != led.base("2026-09") - 100000 or led.discount("2026-09") == 0
    assert led.due("2026-10") == 500000 and led.due("2026-11") == 500000


@pytest.mark.django_db
def test_fifo_pays_oldest_first(enrolled):
    led = services.ledger_for(enrolled)
    sep_due = led.due("2026-09")
    services.pay_fifo(enrolled, sep_due + 50000, None)
    led = services.ledger_for(enrolled)
    assert led.owe("2026-09") == 0
    assert led.paid("2026-10") == 50000


@pytest.mark.django_db
def test_closed_month_blocks_changes(enrolled):
    services.close_month("2026-09", None)
    with pytest.raises(BusinessError):
        services.add_payment(enrolled, "2026-09", 1000, None)
    with pytest.raises(BusinessError):
        services.set_discount(enrolled, "2026-09", 1000, None)
    services.reopen_month("2026-09", None)
    services.add_payment(enrolled, "2026-09", 1000, None)


@pytest.mark.django_db
def test_cannot_close_future_or_unfinalized(group, enrolled, teacher, api):
    with pytest.raises(BusinessError):
        services.close_month("2026-12", None)
    acad.mark(group, dt.date(2026, 10, 12), [{"student": enrolled.id, "present": True}], teacher)
    with pytest.raises(BusinessError):
        services.close_month("2026-10", None)


@pytest.mark.django_db
def test_debtors_listing(enrolled):
    d = services.debtors("2026-10")
    assert d["debtors"] and d["debtors"][0]["student"] == enrolled.id


@pytest.mark.django_db
def test_salary_from_finalized_attendance(group, enrolled, teacher):
    for day in (12, 14):
        acad.mark(group, dt.date(2026, 10, day), [{"student": enrolled.id, "present": True}], teacher)
        acad.finalize(group, dt.date(2026, 10, day), teacher)
    row = services.salary_of(teacher, "2026-10")
    assert row["student_days"] == 2 and row["accrued"] == 2 * 50000


@pytest.mark.django_db
def test_salary_pay_creates_chiqim_and_zeroes_left(group, enrolled, teacher, admin):
    acad.mark(group, dt.date(2026, 10, 12), [{"student": enrolled.id, "present": True}], teacher)
    acad.finalize(group, dt.date(2026, 10, 12), teacher)
    services.pay_salary(teacher, "2026-10", admin)
    assert services.salary_of(teacher, "2026-10")["left"] == 0
    with pytest.raises(BusinessError):
        services.pay_salary(teacher, "2026-10", admin)


@pytest.mark.django_db
def test_payment_api_validation_and_permissions(enrolled, bugalter, administrator, api):
    c = api(bugalter)
    assert c.post(f"/api/students/{enrolled.id}/pay/", {"amount": -5}, format="json").status_code == 400
    r = c.post(f"/api/students/{enrolled.id}/pay/", {"amount": 100000, "month": "2026-10"}, format="json")
    assert r.status_code == 201 and Payment.objects.count() == 1
    # administrator 'pay' = ko'rish: yozolmaydi
    assert api(administrator).post(f"/api/students/{enrolled.id}/pay/", {"amount": 1000}, format="json").status_code == 403
    assert api(administrator).get(f"/api/students/{enrolled.id}/finance/").status_code == 200


@pytest.mark.django_db
def test_reopen_only_admin(bugalter, admin, api):
    assert api(bugalter).post("/api/finance/months/2026-09/close/").status_code == 200
    assert api(bugalter).post("/api/finance/months/2026-09/reopen/").status_code == 403
    assert api(admin).post("/api/finance/months/2026-09/reopen/").status_code == 200


@pytest.mark.django_db
def test_cash_summary_and_oylik_blocked(bugalter, api):
    c = api(bugalter)
    assert (
        c.post("/api/cash/", {"kind": "chiqim", "category": "oylik", "amount": 1000, "date": "2026-10-10"}, format="json").status_code
        == 400
    )
    assert (
        c.post("/api/cash/", {"kind": "chiqim", "category": "ijara", "amount": 1000, "date": "2026-10-10"}, format="json").status_code
        == 201
    )
    assert c.get("/api/cash/summary/?month=2026-10").data["chiqim"] == 1000


@pytest.mark.django_db
def test_month_rows_endpoint(enrolled, bugalter, api):
    r = api(bugalter).get("/api/finance/month/?month=2026-10")
    assert r.status_code == 200
    row = r.data["rows"][0]
    assert row["student"] == enrolled.id and row["due"] == 600000 and row["status"] == "unpaid"
