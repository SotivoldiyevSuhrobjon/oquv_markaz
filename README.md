# Olimpiya akademiyasi — o'quv markaz boshqaruv tizimi

Django 5.2 + DRF + JWT, PostgreSQL, Docker, GitHub Actions (CI/CD). Interfeys (`frontend/`) to'liq API bilan ishlaydi va Django tomonidan `/` manzilida beriladi — alohida frontend serveri kerak emas.

## PyCharm / Windows'da ishga tushirish
`make` Windows'da yo'q va PowerShell'da `&&` ishlamaydi — quyidagi buyruqlarni birin-ketin yozing:
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements\dev.txt
copy .env.dev .env          # DJANGO_DEBUG=1 (lokal rejim; .env ni dastur o'zi o'qiydi)
python manage.py migrate
python manage.py init_center --username admin --password "Admin123." --excel data\Guruhlar_2026-2027.xlsx
python manage.py runserver
```
Keyin brauzerda **http://localhost:8000/** oching va `init_center`da yaratgan admin login-paroli bilan kiring. Xodim/administrator/bugalter akkauntlarini **Xodimlar** bo'limidan yarating (parol maydonida 👁 tugmasi bilan parolni ko'rish va 🔑 bilan kuchli parol yaratish mumkin). Yangi akkaunt birinchi kirishda parolni almashtiradi.

Demo (`oquv_markaz_demo.html`) bilan chalkashtirmang: u alohida fayl, o'z login-parollari brauzer ichida saqlanadi va Django bazasi bilan bog'lanmagan.
PyCharm: **Run → Edit Configurations → + Django server** yoki shu `runserver` buyrug'i. Testlar: `$env:DJANGO_TESTING="1"; pytest`.
`init_center` bitta buyruqda: yo'nalishlarni, adminni va Excel'dagi hamma ma'lumotni (guruhlar, o'quvchilar, qabul sanalari, sinflar, izohlar, xodimlar) yuklaydi. Xodimlarning avtomatik parollari `data\\xodimlar_parollari.txt` fayliga yoziladi (birinchi kirishda almashtiriladi). Admin login-paroli **sayt va Django admin (`/admin/`) uchun bir xil**. Admin paroli oldin boshqa bo'lsa, shu buyruq uni yangilaydi (yoki `python manage.py changepassword admin`).
Bundan keyingi hamma boshqaruv saytning o'zida: **Sozlamalar → Fanlar** (fan qo'shish/narx/nofaol qilish) va **Sozlamalar → Akkauntlar va ruxsatlar** (kim qaysi bo'limni ko'rishi/o'zgartirishi). API hujjati: http://localhost:8000/api/docs/
(Faqat Excel qayta yuklash kerak bo'lsa: `python manage.py import_excel data\\fayl.xlsx --dry-run` — avval sinab ko'rish.)
⚠ `Admin123.` oddiy parol — ishchi serverga chiqarishdan oldin Profil (tepada ismingiz) orqali kuchli parolga almashtiring.

## Docker
- Lokal: `docker compose up --build` (Postgres + Django, http://localhost:8000).
- To'liq yo'riqnoma (Docker → GitHub → CI/CD → server): **DEPLOY.md**.
- Ishchi server: `cp .env.example .env`, qiymatlarni to'ldiring → `docker compose -f docker-compose.prod.yml up -d`. TLS sertifikatlari `./certs/` (fullchain.pem, privkey.pem; masalan certbot). Kunlik zaxira: `scripts/backup.sh` (cron).

## CI/CD (GitHub Actions)
- `ci.yml` (har push/PR): ruff, bandit, pip-audit, migratsiya sinxronligi, `check --deploy`, Postgres bilan pytest.
- `deploy.yml` (main): Docker image → GHCR → SSH orqali serverda `docker compose pull && up -d`.
- Secrets (Settings → Secrets → Actions, `production` environment): `SSH_HOST`, `SSH_USER`, `SSH_KEY`. Serverda `/opt/markaz` ichiga `docker-compose.prod.yml`, `deploy/`, `.env`, `certs/`, `frontend/` qo'ying; `IMAGE` o'zgaruvchisidagi `OWNER`ni GitHub nomingizga almashtiring.

## Xavfsizlik
Parollar Argon2 bilan; JWT (15 daqiqa access, refresh aylantiriladi va qora ro'yxatga olinadi, "eslab qolish" 30 kun); django-axes — 5 xato urinishdan keyin 30 daqiqa blok; throttling; rol/bo'lim ruxsatlari server tomonida (o'qituvchi faqat o'z guruhini ko'radi, administrator oylik ko'ra olmaydi); barcha o'zgarishlar tarixga yoziladi (`/api/audit/`, faqat admin); `DJANGO_SECRET_KEY`siz production ishga tushmaydi; HTTPS/HSTS/secure cookie; konteyner root emas, read-only; nginx rate-limit va CSP; `data/` va `.env` git'ga kirmaydi.

## Asosiy API
`/api/auth/{login,refresh,logout,me,password}/`, `/api/staff/`, `/api/subjects/`, `/api/groups/` (+`conflicts`, `suggest`, `stats`), `/api/students/` (+`archive`, `restore`, `enroll`, `contacts`), `/api/attendance/{mark,finalize,reopen}/`, `/api/alerts/`, `/api/students/<id>/{finance,pay,discount}/`, `/api/payments/`, `/api/cash/` (+`summary`), `/api/finance/{overview,debtors}/`, `/api/finance/months/<YYYY-MM>/{close,reopen}/`, `/api/salary/`, `/api/settings/`, `/api/audit/`, `/healthz/`.
