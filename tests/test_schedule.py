from apps.academics.schedule import Slot, conflicts_of, new_conflicts, overlap, suggestions


def slot(i, days="DCJ", h=8, room="101", kids=False, teachers=()):
    return Slot(i, f"G{i}", days, h, room, kids, "M", list(teachers))


def test_two_hour_overlap():
    assert overlap((8, 10), (9, 11))
    assert not overlap((8, 10), (10, 12))


def test_room_conflict():
    assert conflicts_of(slot(1), [slot(2, h=9)])


def test_different_days_no_conflict():
    assert not conflicts_of(slot(1), [slot(2, days="SPSh")])


def test_teacher_conflict_other_room():
    assert conflicts_of(slot(1, room="101", teachers=["a"]), [slot(2, room="102", teachers=["a"])])


def test_existing_conflict_not_new():
    a, b = slot(1), slot(2)
    assert conflicts_of(a, [b])
    assert not new_conflicts(a, a, [b])


def test_suggestions_are_free():
    out = suggestions(slot(1), [slot(2)], ["101", "102"])
    assert out and all(not (s["room"] == "101" and s["time"] == "08:00") for s in out)
