"""Dars jadvali mantig'i: xona va o'qituvchi ustma-ust tushishini aniqlash.

Qoidalar (demo bilan bir xil):
- Math/English: 2 soat asosiy dars (bitta o'qituvchi) + 1 soat support — xona 3 soat band emas, 2 soat.
- Kids: 3 soat xonada; 1 soat English + 1 soat Math (tartibi guruhdan guruhga almashadi) + 1 soat support.
- O'qituvchi bir vaqtda ikki joyda bo'la olmaydi; xona ham.
- Mavjud (Excel'dan kelgan) to'qnashuvlar tahrirlanadi, lekin YANGI to'qnashuv qo'shib bo'lmaydi.
"""

from dataclasses import dataclass, field

START_HOURS = [f"{h:02d}:00" for h in range(8, 17)]


@dataclass
class Slot:
    """Bitta guruhning jadvalga ta'sir qiluvchi qismi (tekshiruv uchun)."""

    id: int | None
    name: str
    days: str
    hour: int | None
    room: str
    is_kids: bool
    kids_order: str = "M"
    teachers: list[str] = field(default_factory=list)  # username'lar, tartib bilan


def overlap(a, b) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def occupancy(s: Slot):
    return (s.hour, s.hour + (3 if s.is_kids else 2))


def teacher_window(s: Slot, i: int):
    """i-o'qituvchining dars oynasi. Kidsda 0 = English, 1 = Math."""
    t = s.hour
    if not s.is_kids:
        return (t, t + 2)
    english_first = s.kids_order == "E"
    eng, mat = ((t, t + 1), (t + 1, t + 2)) if english_first else ((t + 1, t + 2), (t, t + 1))
    return eng if i == 0 else mat if i == 1 else (t, t + 3)


def conflicts_of(cand: Slot, others: list[Slot]) -> list[dict]:
    """cand ni boshqa guruhlar bilan solishtirib, to'qnashuvlar ro'yxatini qaytaradi.
    Har biri barqaror 'key' ga ega — yangi/eski to'qnashuvni farqlash uchun."""
    out = []
    if not cand.days or cand.hour is None:
        return out
    for o in others:
        if o.id == cand.id or o.days != cand.days or o.hour is None:
            continue
        if cand.room and cand.room == o.room and overlap(occupancy(cand), occupancy(o)):
            out.append({"key": f"room:{cand.room}:{o.id}", "kind": "room", "with": o.name, "message": f"Xona {cand.room} da {o.name} bor"})
        for i, tn in enumerate(cand.teachers):
            for j, on in enumerate(o.teachers):
                if tn == on and overlap(teacher_window(cand, i), teacher_window(o, j)):
                    out.append(
                        {
                            "key": f"teacher:{tn}:{o.id}",
                            "kind": "teacher",
                            "with": o.name,
                            "message": f"{tn} {o.name} da band ({o.hour:02d}:00)",
                        }
                    )
    return out


def new_conflicts(before: Slot, after: Slot, others: list[Slot]) -> list[dict]:
    """O'zgarishdan keyin paydo bo'lgan (avval yo'q bo'lgan) to'qnashuvlar."""
    old = {c["key"] for c in conflicts_of(before, others)}
    return [c for c in conflicts_of(after, others) if c["key"] not in old]


def suggestions(cand: Slot, others: list[Slot], rooms: list[str], limit: int = 8) -> list[dict]:
    """To'qnashuvsiz (xona, vaqt) variantlari."""
    out = []
    hours = [cand.hour] + [int(h[:2]) for h in START_HOURS if int(h[:2]) != cand.hour]
    for h in hours:
        if h is None:
            continue
        for r in rooms:
            probe = Slot(cand.id, cand.name, cand.days, h, r, cand.is_kids, cand.kids_order, cand.teachers)
            if not conflicts_of(probe, others):
                out.append({"room": r, "time": f"{h:02d}:00"})
                if len(out) >= limit:
                    return out
    return out
