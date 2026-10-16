from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models

LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]


class Subject(models.Model):
    """Yo'nalish: Kids, Matematika, English… Admin yangisini qo'sha oladi."""

    slug = models.SlugField(max_length=30, unique=True)
    name = models.CharField(max_length=60)
    price = models.PositiveIntegerField(default=600000, help_text="Oylik narx (so'm)")
    has_levels = models.BooleanField(default=False, help_text="A1–C2 darajalar bormi")
    is_kids = models.BooleanField(default=False, help_text="1+1+1 soat: Math/English almashinuvi + support")
    prefix = models.CharField(max_length=10, blank=True, help_text="Guruh nomi old qo'shimchasi (Mat_, E)")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return self.name


class Group(models.Model):
    DAYS = [("DCJ", "Du-Chor-Ju"), ("SPSh", "Se-Pay-Sha")]

    name = models.CharField(max_length=60, unique=True)
    subject = models.ForeignKey(Subject, on_delete=models.PROTECT, related_name="groups")
    level = models.CharField(max_length=2, blank=True, choices=[(x, x) for x in LEVELS])
    room = models.CharField(max_length=10, blank=True)
    days = models.CharField(max_length=4, blank=True, choices=DAYS)
    start_time = models.TimeField(null=True, blank=True)
    # Kids: 'E' = 1-soat English, keyin Math; 'M' = aksincha. O'qituvchilar almashib turadi.
    kids_order = models.CharField(max_length=1, default="M", choices=[("M", "Math → English"), ("E", "English → Math")])
    teachers = models.ManyToManyField(settings.AUTH_USER_MODEL, through="GroupTeacher", related_name="teaching_groups")
    supports = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="support_groups")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(condition=models.Q(days__in=["", "DCJ", "SPSh"]), name="group_days_valid"),
        ]

    def __str__(self):
        return self.name

    @property
    def start_hour(self) -> int | None:
        return self.start_time.hour if self.start_time else None


class GroupTeacher(models.Model):
    """Guruh o'qituvchisi. Kidsda position 0 = English, 1 = Math."""

    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="group_teachers")
    teacher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]
        constraints = [models.UniqueConstraint(fields=["group", "teacher"], name="uniq_group_teacher")]


class Student(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Faol"
        LEFT = "left", "Ketgan"
        PAUSED = "paused", "To'xtatilgan"
        LATER = "later", "Keyin boshlaydi"

    full_name = models.CharField(max_length=150, db_index=True)
    phone = models.CharField(
        max_length=20, blank=True, validators=[RegexValidator(r"^\+?\d{7,15}$", "Telefon faqat raqamlardan iborat bo'lsin")]
    )
    district = models.CharField("Tuman", max_length=60, blank=True)
    class_name = models.CharField("Maktab sinfi", max_length=10, blank=True)
    note = models.CharField(max_length=255, blank=True)
    admitted_on = models.DateField(null=True, blank=True, help_text="Qabul sanasi")
    started_on = models.DateField(help_text="Darsni boshlagan sana — to'lov shundan hisoblanadi")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    archive_reason = models.CharField(max_length=255, blank=True)
    archive_start = models.DateField(null=True, blank=True, help_text="'Keyin boshlaydi' uchun sana")
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["full_name"]

    def __str__(self):
        return self.full_name


class Enrollment(models.Model):
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="enrollments")
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="enrollments")
    joined_on = models.DateField()
    left_on = models.DateField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["student", "group"], condition=models.Q(left_on__isnull=True), name="uniq_active_enrollment"),
        ]


class Session(models.Model):
    """Guruhning bir kunlik darsi. Yakunlanganda o'qituvchi oyligiga hisoblanadi."""

    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="sessions")
    date = models.DateField(db_index=True)
    finalized = models.BooleanField(default=False)
    finalized_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    finalized_at = models.DateTimeField(null=True, blank=True)
    comment = models.CharField(max_length=255, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["group", "date"], name="uniq_group_date_session")]


class Attendance(models.Model):
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name="records")
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="attendance")
    present = models.BooleanField()
    marked_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    marked_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["session", "student"], name="uniq_session_student")]


class ParentContact(models.Model):
    """3 tadan ko'p dars qoldirgan o'quvchining ota-onasi bilan bog'lanish izohi (majburiy)."""

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="contacts")
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    note = models.TextField()
    missed_at_time = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
