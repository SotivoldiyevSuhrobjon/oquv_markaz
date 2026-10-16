# Docker → Git → CI/CD → Server (qadamma-qadam)

## 1. Lokal Docker (Windows, Docker Desktop)
1. Docker Desktop o'rnating va ishga tushiring.
2. Loyiha papkasida (PowerShell):
   ```powershell
   docker compose up --build
   ```
3. Boshqa oynada, birinchi marta ma'lumotlarni yuklash (admin + Excel):
   ```powershell
   docker compose exec web python manage.py init_center --password "Admin123." --excel data/Guruhlar_2026-2027.xlsx
   ```
4. Oching: http://localhost:8000 — login `admin`, parol `Admin123.`
   (Serverga chiqarishdan oldin parolni **albatta** almashtiring: Sozlamalar → Akkauntlar.)

## 2. Git va GitHub
```powershell
git init
git add .
git commit -m "Dastlabki versiya"
git branch -M main
git remote add origin https://github.com/SIZNING_NOM/oquv-markaz.git
git push -u origin main
```
`.env`, `data/`, `backups/` `.gitignore` da — GitHub'ga chiqmaydi (parollar va Excel xavfsiz).

## 3. CI/CD qanday ishlaydi
- Har push / PR: `ci.yml` — ruff, bandit, pip-audit, migratsiya tekshiruvi, `check --deploy`, pytest (Postgres bilan).
- `main` ga CI muvaffaqiyatli o'tsa: `deploy.yml` — image yig'iladi → GHCR → serverga SSH → `pull` + `up -d` → `/healthz/` tekshiruvi.

GitHub → Settings → Environments → **production** yarating. Secrets (Settings → Secrets and variables → Actions):
| Nom | Qiymat |
|---|---|
| `SSH_HOST` | server IP yoki domen |
| `SSH_USER` | SSH foydalanuvchi (docker guruhida) |
| `SSH_KEY` | maxfiy SSH kalit (to'liq matn) |
| `DEPLOY_PATH` | ixtiyoriy, standart `/opt/markaz` |

Image GHCR'da private bo'lsa ham, deploy vaqtida workflow tokeni bilan login qilinadi.

## 4. Serverni tayyorlash (bir marta, avtomatik)
1. **Domen:** duckdns.org da yangi subdomen oching (masalan `olimpiya.duckdns.org`) va uni server IP'siga yo'naltiring (Taskflow'dagi bilan bir xil IP bo'lishi mumkin — nginx domen bo'yicha ajratadi).
2. Serverga SSH bilan kirib, skriptni oling va ishga tushiring:
   ```bash
   mkdir -p /opt/markaz/deploy && cd /opt/markaz
   # skriptni kompyuteringizdan yuboring (PowerShell):  scp deploy/server-setup.sh root@SERVER_IP:/opt/markaz/deploy/
   sudo bash deploy/server-setup.sh olimpiya.duckdns.org
   ```
   U Docker'ni (yo'q bo'lsa) o'rnatadi, tasodifiy kalitlar bilan `.env` yaratadi, nginx saytini sozlaydi va certbot bilan bepul HTTPS oladi. Boshqa saytlarga tegmaydi.
3. Skript oxirida chiqqan **Django admin manzilini** yozib oling (`.env` ichida `DJANGO_ADMIN_URL`).

Qo'lda sozlamoqchi bo'lsangiz: `.env.example` asosida `.env` yarating, `deploy/nginx/host-nginx.conf` ni nginx'ga ulang va `certbot --nginx -d DOMEN` qiling.

## 5. Birinchi deploy
`main` ga push qiling yoki GitHub → Actions → Deploy → Run workflow. Keyin serverda Excel'ni bir marta yuklang:
```bash
scp data/Guruhlar_2026-2027.xlsx user@server:/opt/markaz/data/
cd /opt/markaz
docker compose -f docker-compose.prod.yml exec web \
  python manage.py init_center --password "YANGI_KUCHLI_PAROL" --excel data/Guruhlar_2026-2027.xlsx
```
Xodimlar parollari `data/xodimlar_parollari.txt` ga yoziladi — o'qib bo'lgach o'chiring.

## 6. Zaxira va qaytarish
- Zaxira: `scripts/backup.sh` — cron: `0 3 * * * cd /opt/markaz && ./scripts/backup.sh`
- Qaytarish: oldingi image tegi bilan: `IMAGE=ghcr.io/nom/oquv-markaz:<eski-sha> docker compose -f docker-compose.prod.yml up -d`
- Loglar: `docker compose -f docker-compose.prod.yml logs -f web`
