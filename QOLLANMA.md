# Ishlayotgan sayt bo'yicha qo'llanma — https://olimpiya.work.gd

## 1. Kodni yangilash (kundalik ish)
1. PyCharm'da o'zgartiring va lokal sinang (`python manage.py runserver` yoki `docker compose up --build`).
2. Testlar: `$env:DJANGO_TESTING="1"; pytest`
3. Yuborish:
   ```powershell
   git add .
   git commit -m "Nima o'zgargani"
   git push
   ```
4. GitHub → Actions: avval **CI** (test, docker, compose-config), yashil bo'lsa **Deploy** o'zi ishga tushadi.
5. Deploy tugagach sayt yangilanadi (migratsiyalar konteyner ishga tushganda avtomatik bajariladi). Brauzerda Ctrl+F5 bosing.

CI qizil bo'lsa, deploy bo'lmaydi: sayt eski, ishlaydigan holatda qoladi. Xato matnini ko'rib tuzating va qayta push qiling.

Faqat o'zgartirilgan `.env` kerak bo'lsa (kamdan-kam): serverda `/opt/markaz/.env` ni tahrirlab, `docker compose -f docker-compose.prod.yml up -d` qiling.

## 2. Django admin panelga kirish
- Manzil: **https://olimpiya.work.gd/boshqaruv-af48cab6/** (yashirin yo'l; `/admin/` ishlamaydi)
- Login: `admin`, parol: saytdagi admin paroli.
- Manzilni unutsangiz: `ssh root@77.110.115.45 "grep DJANGO_ADMIN_URL /opt/markaz/.env"`
- Kundalik boshqaruv saytning o'zida (Sozlamalar, Akkauntlar). Django panel faqat texnik tuzatishlar uchun.

## 3. Parolni tiklash
Admin parolini unutsangiz:
```powershell
ssh root@77.110.115.45 "cd /opt/markaz && docker compose -f docker-compose.prod.yml exec web python manage.py init_center --password 'YANGI_PAROL'"
```
Boshqa xodimlar parolini admin sayt orqali (Sozlamalar → Akkauntlar) tiklaydi. Ko'p marta noto'g'ri parol kiritilsa, `django-axes` vaqtincha bloklaydi.

## 4. Foydali serverdagi buyruqlar
Hammasi `ssh root@77.110.115.45` orqali, papka `/opt/markaz`:
- Holat: `docker compose -f docker-compose.prod.yml ps`
- Loglar: `docker compose -f docker-compose.prod.yml logs --tail=100 web`
- Qayta ishga tushirish: `docker compose -f docker-compose.prod.yml restart web`
- Sog'liq: `curl -s https://olimpiya.work.gd/healthz/`

## 5. Zaxira nusxa (muhim)
Qo'lda:
```bash
cd /opt/markaz && sh scripts/backup.sh     # backups/ papkaga .sql.gz yozadi
```
Har kuni avtomatik (serverda `crontab -e`):
```
0 3 * * * cd /opt/markaz && sh scripts/backup.sh
```
Nusxani vaqti-vaqti bilan kompyuteringizga oling: `scp root@77.110.115.45:/opt/markaz/backups/*.sql.gz .`

Tiklash:
```bash
gunzip -c backups/markaz-YYYY-MM-DD.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U markaz markaz
```

## 6. Orqaga qaytarish (yangi versiya buzsa)
1. GitHub → Actions → oldingi muvaffaqiyatli **Deploy** → **Re-run all jobs**; yoki
2. kodni qaytarib push qiling: `git revert HEAD` → `git push`.

## 7. Xavfsizlik eslatmalari
- Admin parolini kuchli (12+ belgi) qiling va hech kimga yubormang.
- `.env` va SSH kalit (`markaz_deploy`) hech qachon GitHub'ga chiqmasin.
- Serverga parol bilan emas, SSH kalit bilan kirishni yoqing (`PasswordAuthentication no`), xohlasangiz keyin sozlaymiz.
- Boshqa loyihalar (Taskflow va h.k.) shu serverda; markaz alohida `/opt/markaz` da va `127.0.0.1:8001` da ishlaydi, ularga tegmaydi.
