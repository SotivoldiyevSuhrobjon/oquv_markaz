"""Guruhlar_2026-2027 Excel faylidan guruh, o'quvchi va xodimlarni yuklaydi.

    python manage.py import_excel data/Guruhlar.xlsx [--password-for-staff PAROL] [--dry-run]

Haqiqiy o'quvchi ma'lumotlari git'ga qo'shilmaydi (data/ .gitignore'da).
Xodimlarga parol berilmasa, tasodifiy parol yaratiladi va bir marta ekranga chiqariladi.
"""

import datetime as dt
import re
import secrets
from collections import Counter

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.academics.models import Enrollment, Group, GroupTeacher, Student, Subject
from apps.accounts.models import DEFAULT_PERMS, Role, User

FIXES = (("Ma'rufxon", "Marufxon"), ("Mohidiloy", "Mohidil"), ("Muhtorjon", "Muxtorjon"), ("domla", ""))
SUBJECTS = {
    "kids": dict(name="Kids", price=900000, is_kids=True, prefix="Kids"),
    "math": dict(name="Matematika", price=600000, prefix="Mat_"),
    "eng": dict(name="English", price=600000, has_levels=True, prefix="E"),
}


def tname(t):
    if not t:
        return []
    for a, b in FIXES:
        t = t.replace(a, b)
    return [x.strip() for x in re.split(r"\s*-\s*", t) if x.strip()]


def days_of(s):
    s = str(s or "").upper().replace(".", "").replace("-", "")
    return ("DCJ" if s[:1] in "DM" else "SPSh") if s else ""


def phone_of(v):
    d = digits(v)
    if len(d) == 9:
        return "+998" + d
    return ("+" + d) if d else ""


MONTHS = {"yan": 1, "fev": 2, "mar": 3, "apr": 4, "may": 5, "iyun": 6, "iyul": 7, "avg": 8, "sent": 9, "okt": 10, "noy": 11, "dek": 12}


def qabul_of(v, default=dt.date(2026, 9, 1)):
    """'21.sent', '15,10', datetime yoki bo'sh -> sana."""
    if isinstance(v, dt.datetime):
        return v.date()
    t = str(v or "").strip().lower()
    if not t:
        return default
    m = re.match(r"(\d{1,2})\s*[.,/]\s*(\d{1,2})$", t)
    if m:
        d, mo = int(m[1]), int(m[2])
        return dt.date(2026 if mo >= 9 else 2027, mo, d) if 1 <= mo <= 12 and 1 <= d <= 31 else default
    for key, mo in MONTHS.items():
        if key in t:
            n = re.search(r"\d+", t)
            d = min(int(n[0]), 28) if n else 1
            return dt.date(2026 if mo >= 9 else 2027, mo, d)
    return default


def digits(v):
    return re.sub(r"\D", "", str(v)) if v else ""


def username_of(name):
    base = re.sub(r"[^a-z0-9]", "", name.lower().replace("'", "")) or "user"
    return base


class Command(BaseCommand):
    help = "Excel (Guruhlar_2026-2027) dan ma'lumot yuklash"

    def add_arguments(self, p):
        p.add_argument("path")
        p.add_argument("--password-for-staff", default="")
        p.add_argument("--dry-run", action="store_true")
        p.add_argument("--credentials", default="", help="Yangi xodimlar login-parollari yoziladigan fayl (masalan data/xodimlar.txt)")

    def handle(self, *a, path, password_for_staff, dry_run, credentials="", **kw):
        self.creds = []
        try:
            import openpyxl
        except ImportError as e:
            raise CommandError("openpyxl o'rnatilmagan: pip install openpyxl") from e
        wb = openpyxl.load_workbook(path, data_only=True)
        with transaction.atomic():
            for slug, d in SUBJECTS.items():
                Subject.objects.get_or_create(slug=slug, defaults=d)
            staff = self.import_staff(wb, password_for_staff)
            n_g, n_s = self.import_groups(wb, staff)
            self.stdout.write(self.style.SUCCESS(f"Xodim: {len(staff)}, guruh: {n_g}, o'quvchi: {n_s}"))
            if credentials and self.creds and not dry_run:
                with open(credentials, "w", encoding="utf-8") as fh:
                    fh.write("login\tism\tlavozim\tparol (birinchi kirishda almashtiriladi)\n" + "\n".join(self.creds) + "\n")
                self.stdout.write(f"Xodimlar login-parollari: {credentials}")
            if dry_run:
                transaction.set_rollback(True)
                self.stdout.write("DRY-RUN: o'zgarish saqlanmadi")

    def import_staff(self, wb, pw):
        out, sec = {}, None
        for r in (tuple(x) + (None,) * 20 for x in wb["Ustozlar"].iter_rows(values_only=True)):
            if r[0] and isinstance(r[0], str) and "fan" in r[0]:
                sec = "eng" if "Ingliz" in r[0] else "math"
                continue
            if not (r[1] and isinstance(r[1], str) and r[1] != "F.I.Sh"):
                continue
            full = r[1].strip()
            sup = "support" in full.lower() or full == "Madina"
            short = re.sub(r"\s*support\s*", "", full, flags=re.I).replace("mat", "").strip() if sup else full
            for a, b in FIXES:
                short = short.replace(a, b)
            short = short.strip()
            if not sup and sec == "eng" and " " in short:
                short = short.split()[-1]
            for pref, nm in (("Akbarov", "Yusufxon"), ("Sevara", "Sevara"), ("Dilshoda", "Dilshoda")):
                if sup and full.startswith(pref):
                    short = nm
            frm = next((c.date() for c in r[11:13] if isinstance(c, dt.datetime)), None)
            uname, i = username_of(short), 1
            while User.objects.filter(username=uname).exclude(full_name=short).exists():
                i += 1
                uname = f"{username_of(short)}{i}"
            password = pw or secrets.token_urlsafe(9)
            u, created = User.objects.get_or_create(
                username=uname,
                defaults=dict(
                    full_name=short,
                    role=Role.SUPPORT if sup else Role.TEACHER,
                    category=sec or "eng",
                    phone=phone_of(r[2]),
                    work_from=frm,
                    note="Lavozimi aniqlanmagan — tekshiring" if full == "Madina" else "",
                    must_change_password=True,
                ),
            )
            if created:
                u.set_password(password)
                u.save()
                self.creds.append(f"{uname}\t{short}\t{u.role}\t{password}")
            out[short] = u
        return out

    def import_groups(self, wb, staff):
        spec = [
            ("Kids", "kids", r"^Kids", 9, 7, 10),
            ("Matematika", "math", r"^Mat_", 9, 7, 10),
            ("English", "eng", r"^E\d+_[A-C]\d", 8, 7, 9),
        ]
        n_g = n_s = 0
        for sheet, slug, pat, c_room, c_time, c_note in spec:
            subj, cur = Subject.objects.get(slug=slug), None
            rows = []
            for r in (tuple(x) + (None,) * 20 for x in wb[sheet].iter_rows(values_only=True)):
                if r[0] and re.match(pat, str(r[0]).strip()):
                    cur = dict(
                        name=str(r[0]).strip(),
                        teachers=tname(r[1]),
                        room=str(r[c_room] or ""),
                        time=r[c_time],
                        time2=r[8] if slug == "kids" else None,
                        st=[],
                        days=[],
                    )
                    rows.append(cur)
                if cur is None or r[3] == "N" or not r[4] or not str(r[4]).strip():
                    continue
                note = r[c_note] if isinstance(r[c_note], str) else ""
                if slug == "kids" and isinstance(r[9], str):
                    note = r[9]
                cur["st"].append(
                    dict(
                        name=re.sub(r"\s+", " ", str(r[4])).strip(),
                        phone=phone_of(r[5]),
                        joined=qabul_of(r[2]),
                        note=note.strip(),
                        cls=str(r[8]) if slug == "math" and r[8] else "",
                    )
                )
                cur["days"].append(days_of(r[6]))
            for g in rows:
                top = Counter(x for x in g["days"] if x).most_common(1)
                level = g["name"].split("_")[1] if slug == "eng" else ""
                t1, t2 = g["time"], g["time2"]
                start = min(x for x in (t1, t2) if isinstance(x, dt.time)) if isinstance(t1, dt.time) or isinstance(t2, dt.time) else None
                order = "E" if isinstance(t1, dt.time) and isinstance(t2, dt.time) and t2 < t1 else "M"
                grp, _ = Group.objects.get_or_create(
                    name=g["name"],
                    defaults=dict(
                        subject=subj,
                        level=level,
                        room=g["room"].replace(".0", ""),
                        days=top[0][0] if top else "",
                        start_time=start,
                        kids_order=order,
                    ),
                )
                n_g += 1
                for pos, tn_ in enumerate(g["teachers"]):
                    t = staff.get(tn_)
                    if t:
                        GroupTeacher.objects.get_or_create(group=grp, teacher=t, defaults={"position": pos})
                    else:
                        self.stdout.write(self.style.WARNING(f"  ! {g['name']}: '{tn_}' Ustozlar varag'ida topilmadi — saytda biriktiring"))
                for s in g["st"]:
                    st, created = Student.objects.get_or_create(
                        full_name=s["name"],
                        phone=s["phone"][:15],
                        defaults=dict(note=s["note"], class_name=s["cls"][:10], started_on=s["joined"], admitted_on=s["joined"]),
                    )
                    if created:
                        n_s += 1
                    if not grp.enrollments.filter(student=st, left_on__isnull=True).exists():
                        Enrollment.objects.create(student=st, group=grp, joined_on=st.started_on)  # import limitni chetlab o'tadi
        Group.objects.get_or_create(
            name="E9_B2",
            defaults=dict(subject=Subject.objects.get(slug="eng"), level="B2", room="201", days="DCJ", start_time=dt.time(10, 0)),
        )
        return n_g, n_s


__all__ = ["Command", "DEFAULT_PERMS"]
