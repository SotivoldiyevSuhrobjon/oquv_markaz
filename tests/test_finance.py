import datetime as dt

import pytest

from apps.academics import services as acad
from apps.academics.models import Group
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
    assert row["student_days"] == 2 and row["accrued"] == round(2 * 150000 / 13)  # 2 soatlik dars: 2 x 75 000 = 150 000, oktyabrda 13 dars


@pytest.mark.django_db
def test_salary_pays_only_attended_lessons_rest_stays_with_center(group, enrolled, teacher):
    """1 o'quvchi uchun oyiga 130 000; oktyabrda 13 dars (Du-Chor-Ju) => 1 dars 10 000. Faqat kelgan darslar to'lanadi."""
    teacher.rate = 65000  # 1 soatlik ulush; Math 2 soat => 130 000
    teacher.save()
    for day, present in ((12, True), (14, True), (9, False)):
        acad.mark(group, dt.date(2026, 10, day), [{"student": enrolled.id, "present": present}], teacher)
        acad.finalize(group, dt.date(2026, 10, day), teacher)
    row = services.salary_of(teacher, "2026-10")
    g = row["breakdown"][0]
    assert (g["lessons"], g["per_lesson"], g["present"], g["absent"]) == (13, 10000, 2, 1)
    assert row["accrued"] == 20000


@pytest.mark.django_db
def test_kids_teacher_gets_half_share_for_one_hour(kids, teacher, teacher2, student):
    """Kids: o'qituvchi 1 soat beradi => 1 soatlik ulush (75 000); ikkinchi o'qituvchi tayinlanmagan bo'lsa ham."""
    g = Group.objects.create(name="Kids_1", subject=kids, room="102", days="DCJ", start_time=dt.time(8, 0))
    g.group_teachers.create(teacher=teacher, position=1)
    acad.enroll(student, g)
    acad.mark(g, dt.date(2026, 10, 12), [{"student": student.id, "present": True}], teacher)
    acad.finalize(g, dt.date(2026, 10, 12), teacher)
    row = services.salary_of(teacher, "2026-10")
    assert row["breakdown"][0]["per_lesson"] == round(75000 / 13) and row["accrued"] == round(75000 / 13)


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


@pytest.mark.django_db
def test_salary_counts_saved_attendance_without_finalize(group, enrolled, teacher):
    acad.mark(group, dt.date(2026, 10, 12), [{"student": enrolled.id, "present": True}], teacher)
    row = services.salary_of(teacher, "2026-10")
    assert row["student_days"] == 1 and row["accrued"] == round(150000 / 13)


@pytest.mark.django_db
def test_delete_archived_student_and_staff(api, admin, group, enrolled, teacher):
    api = api(admin)
    assert api.delete(f"/api/students/{enrolled.id}/").status_code == 400  # faol
    acad.archive_student(enrolled, "left", "test", None)
    services.add_payment(enrolled, "2026-10", 100000, None)
    r = api.delete(f"/api/students/{enrolled.id}/")
    assert r.status_code == 400 and "PAYMENTS:1:100000" in str(r.data)
    assert api.delete(f"/api/students/{enrolled.id}/?force=1").status_code == 204
    assert api.delete(f"/api/staff/{teacher.id}/").status_code == 400  # faol
    api.post(f"/api/staff/{teacher.id}/archive/")
    assert api.delete(f"/api/staff/{teacher.id}/").status_code == 204
    assert api.delete(f"/api/staff/{admin.id}/").status_code == 400


@pytest.mark.django_db
def test_salary_left_negative_when_advance_exceeds(group, enrolled, teacher, admin):
    services.pay_salary(teacher, "2026-10", admin, amount=500000)
    row = services.salary_of(teacher, "2026-10")
    assert row["left"] == -500000
    with pytest.raises(BusinessError):
        services.pay_salary(teacher, "2026-10", admin)
