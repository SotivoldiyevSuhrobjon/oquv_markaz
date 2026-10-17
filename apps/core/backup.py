"""Ma'lumotlar zaxirasi: butun bazani JSON (gzip) qilib saqlaydi va tiklaydi. SQLite va PostgreSQL da bir xil ishlaydi."""

import gzip
import io
import re
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.db import transaction
from django.utils import timezone

from .exceptions import BusinessError

EXCLUDE = ["contenttypes", "auth.permission", "sessions", "admin.logentry", "axes", "token_blacklist"]
NAME_RE = re.compile(r"^backup-\d{8}-\d{6}(-[a-z]+)?\.json\.gz$")


def backup_dir() -> Path:
    d = Path(getattr(settings, "BACKUP_DIR", settings.BASE_DIR / "data" / "backups"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def path_of(name: str) -> Path:
    if not NAME_RE.match(name):
        raise BusinessError("Zaxira nomi noto'g'ri")
    p = backup_dir() / name
    if not p.is_file():
        raise BusinessError("Zaxira topilmadi")
    return p


def make(tag: str = "") -> Path:
    buf = io.StringIO()
    call_command("dumpdata", "--natural-foreign", "--natural-primary", exclude=EXCLUDE, stdout=buf, verbosity=0)
    stamp = timezone.now().strftime("%Y%m%d-%H%M%S")
    p = backup_dir() / f"backup-{stamp}{('-' + tag) if tag else ''}.json.gz"
    with gzip.open(p, "wt", encoding="utf-8") as f:
        f.write(buf.getvalue())
    return p


def listing() -> list[dict]:
    out = []
    for p in sorted(backup_dir().glob("backup-*.json.gz"), reverse=True):
        if NAME_RE.match(p.name):
            st = p.stat()
            out.append(
                {
                    "name": p.name,
                    "size": st.st_size,
                    "created": timezone.datetime.fromtimestamp(st.st_mtime, tz=timezone.get_current_timezone()).isoformat(),
                    "safety": p.name.endswith("-oldin.json.gz"),
                }
            )
    return out


def restore(name: str) -> None:
    src = path_of(name)
    make("oldin")  # tiklashdan oldin joriy holat saqlab qo'yiladi
    tmp = backup_dir() / "_restore.json"
    with gzip.open(src, "rt", encoding="utf-8") as f, open(tmp, "w", encoding="utf-8") as o:
        o.write(f.read())
    try:
        with transaction.atomic():
            call_command("flush", interactive=False, verbosity=0, inhibit_post_migrate=True)
            call_command("loaddata", str(tmp), verbosity=0)
    finally:
        tmp.unlink(missing_ok=True)
