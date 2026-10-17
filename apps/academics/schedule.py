"""Dars jadvali mantig'i: xona va o'qituvchi ustma-ust tushishini aniqlash.

Qoidalar:
- Math/English: 2 soat asosiy dars (bitta o'qituvchi).
- Kids: 2 soat asosiy dars — 1 soat English + 1 soat Math; Kids1 va Kids2 bir vaqtda o'tadi va 1 soatdan keyin
  almashadi (tartib guruhning kids_order maydonida: M = Math→English, E = English→Math).
- Support: har bir guruh bilan asosiy dars tugagach 1 soat ishlaydi. U asosiy xonani band qilmaydi: dastur
  shu soatda bo'sh xonani o'zi topadi (avval guruhning o'z xonasi, bo'lmasa boshqa bo'sh xona) — support_plan().
- O'qituvchi, support va xona bir vaqtda ikki joyda bo'la olmaydi.
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
    supports: list[str] = field(default_factory=list)  # support username'lari


def overlap(a, b) -> bool:
    return a[0] < b[1] and b[0] < a[1]


MAIN_HOURS = 2


def occupancy(s: Slot):
    """Asosiy dars xonani qancha band qiladi (Kids ham, boshqalar ham 2 soat)."""
    return (s.hour, s.hour + MAIN_HOURS)


def support_window(s: Slot):
    """Support darsi: asosiy dars tugagach 1 soat."""
    return (s.hour + MAIN_HOURS, s.hour + MAIN_HOURS + 1)


def teacher_window(s: Slot, i: int):
    """i-o'qituvchining dars oynasi. Kidsda 0 = English, 1 = Math."""
    t = s.hour
    if not s.is_kids:
        return (t, t + 2)
    english_first = s.kids_order == "E"
    eng, mat = ((t, t + 1), (t + 1, t + 2)) if english_first else ((t + 1, t + 2), (t, t + 1))
    return eng if i == 0 else mat if i == 1 else (t, t + MAIN_HOURS)


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
        for sn in cand.supports:
            if sn in o.supports and overlap(support_window(cand), support_window(o)):
                out.append(
                    {
                        "key": f"support:{sn}:{o.id}",
                        "kind": "support",
                        "with": o.name,
                        "message": f"Support {sn} {o.name} bilan bir vaqtda ({o.hour + MAIN_HOURS:02d}:00)",
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
            probe = Slot(cand.id, cand.name, cand.days, h, r, cand.is_kids, cand.kids_order, cand.teachers, cand.supports)
            if not conflicts_of(probe, others):
                out.append({"room": r, "time": f"{h:02d}:00"})
                if len(out) >= limit:
                    return out
    return out


def support_plan(slots: list[Slot], rooms: list[str]) -> list[dict]:
    """Support bor guruhlar uchun support soati va xonasi (hisoblanadi, bazada saqlanmaydi).

    Avval guruhning o'z xonasi (agar shu soatda bo'sh bo'lsa), aks holda birinchi bo'sh xona. Xona topilmasa room="".
    """
    plan, taken = [], {}
    live = [s for s in slots if s.supports and s.days and s.hour is not None]
    for s in sorted(live, key=lambda x: (x.days, x.hour, x.id or 0)):
        win = support_window(s)
        busy = {o.room for o in slots if o.room and o.days == s.days and o.hour is not None and overlap(win, occupancy(o))}
        busy |= taken.setdefault((s.days, win[0]), set())
        room = s.room if s.room and s.room not in busy else next((r for r in rooms if r not in busy), "")
        if room:
            taken[(s.days, win[0])].add(room)
        plan.append(
            {"group": s.id, "name": s.name, "days": s.days, "hour": win[0], "room": room, "own_room": bool(room) and room == s.room}
        )
    return plan
