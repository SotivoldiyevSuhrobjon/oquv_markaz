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


def test_kids_room_is_two_hours_only():
    # Kids 08:00–10:00; 10:00 dagi guruh xonani ola oladi (support xonani band qilmaydi)
    assert not conflicts_of(slot(1, kids=True), [slot(2, h=10)])
    assert conflicts_of(slot(1, kids=True), [slot(2, h=9)])


def test_kids_pair_swaps_teachers_without_conflict():
    k1 = Slot(1, "Kids1", "DCJ", 8, "101", True, "M", ["eng", "mat"])  # Math -> English
    k2 = Slot(2, "Kids2", "DCJ", 8, "102", True, "E", ["eng", "mat"])  # English -> Math
    assert not conflicts_of(k1, [k2])


def test_support_plan_prefers_own_room_then_other_free_room():
    from apps.academics.schedule import support_plan

    a = Slot(1, "A", "DCJ", 8, "101", False, "M", [], ["s1"])
    b = Slot(2, "B", "DCJ", 10, "101", False, "M", [])  # A ning support soatida 101 band
    plan = {p["group"]: p for p in support_plan([a, b], ["101", "102"])}
    assert plan[1]["hour"] == 10 and plan[1]["room"] == "102" and not plan[1]["own_room"]
    c = Slot(3, "C", "DCJ", 8, "103", False, "M", [], ["s2"])
    assert {p["group"]: p for p in support_plan([c], ["103"])}[3]["own_room"]


def test_support_plan_no_room_and_no_double_booking():
    from apps.academics.schedule import support_plan

    a = Slot(1, "A", "DCJ", 8, "101", False, "M", [], ["s1"])
    b = Slot(2, "B", "DCJ", 8, "101", False, "M", [], ["s2"])
    plan = support_plan([a, b], ["101"])
    assert [p["room"] for p in plan] == ["101", ""]


def test_same_support_two_groups_same_hour_conflicts():
    a = Slot(1, "A", "DCJ", 8, "101", False, "M", [], ["s1"])
    b = Slot(2, "B", "DCJ", 8, "102", False, "M", [], ["s1"])
    assert [c["kind"] for c in conflicts_of(a, [b])] == ["support"]
    assert not conflicts_of(a, [Slot(2, "B", "DCJ", 9, "102", False, "M", [], ["s1"])])
