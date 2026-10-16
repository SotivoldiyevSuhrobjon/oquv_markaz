import datetime as dt

from rest_framework import serializers

from apps.core.models import Setting
from apps.core.utils import today

from . import schedule, services
from .models import Group, ParentContact, Room, Student, Subject


class SubjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = ("id", "slug", "name", "price", "has_levels", "is_kids", "prefix", "is_active")


class RoomSerializer(serializers.ModelSerializer):
    used = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = ("id", "name", "used")

    def get_used(self, obj) -> int:
        return Group.objects.filter(room=obj.name, is_active=True).count()

    def validate_name(self, v):
        v = v.strip()
        if not v:
            raise serializers.ValidationError("Xona nomi bo'sh bo'lmasin")
        return v


class GroupSerializer(serializers.ModelSerializer):
    subject = serializers.SlugRelatedField(slug_field="slug", queryset=Subject.objects.filter(is_active=True))
    teachers = serializers.SerializerMethodField()
    supports = serializers.SerializerMethodField()
    student_count = serializers.IntegerField(read_only=True)
    free_places = serializers.SerializerMethodField()

    class Meta:
        model = Group
        fields = (
            "id",
            "name",
            "subject",
            "level",
            "room",
            "days",
            "start_time",
            "kids_order",
            "teachers",
            "supports",
            "student_count",
            "free_places",
            "is_active",
        )

    def get_teachers(self, g):
        return [{"id": gt.teacher_id, "name": str(gt.teacher), "position": gt.position} for gt in g.group_teachers.all()]

    def get_supports(self, g):
        return [{"id": u.id, "name": str(u)} for u in g.supports.all()]

    def get_free_places(self, g):
        return max(0, Setting.get().max_group_size - getattr(g, "student_count", 0))

    def validate(self, attrs):
        subject = attrs.get("subject") or (self.instance.subject if self.instance else None)
        level = attrs.get("level", self.instance.level if self.instance else "")
        if level and subject and not subject.has_levels:
            raise serializers.ValidationError({"level": "Bu yo'nalishda daraja yo'q"})
        start = attrs.get("start_time", self.instance.start_time if self.instance else None)
        if start and not (dt.time(8, 0) <= start <= dt.time(16, 0)):
            raise serializers.ValidationError({"start_time": "Dars boshlanishi 08:00–16:00 oralig'ida"})
        cand = self._candidate(attrs, subject)
        before = services.slot_of(self.instance) if self.instance else schedule.Slot(None, cand.name, "", None, "", cand.is_kids)
        bad = schedule.new_conflicts(before, cand, services.all_slots(exclude_id=self.instance.id if self.instance else None))
        if bad:
            raise serializers.ValidationError(
                {
                    "schedule": [c["message"] for c in bad],
                    "suggestions": schedule.suggestions(cand, services.all_slots(exclude_id=cand.id), services.rooms()),
                }
            )
        return attrs

    def _candidate(self, attrs, subject):
        g = self.instance
        base = services.slot_of(g) if g else schedule.Slot(None, attrs.get("name", ""), "", None, "", subject.is_kids)
        start = attrs.get("start_time", g.start_time if g else None)
        return schedule.Slot(
            base.id,
            attrs.get("name", base.name),
            attrs.get("days", g.days if g else ""),
            start.hour if start else None,
            attrs.get("room", g.room if g else ""),
            subject.is_kids,
            attrs.get("kids_order", g.kids_order if g else "M"),
            base.teachers,
        )


class StudentSerializer(serializers.ModelSerializer):
    groups = serializers.SerializerMethodField()
    group = serializers.PrimaryKeyRelatedField(queryset=Group.objects.filter(is_active=True), write_only=True, required=False)
    absences = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = Student
        fields = (
            "id",
            "full_name",
            "phone",
            "district",
            "class_name",
            "note",
            "admitted_on",
            "started_on",
            "status",
            "archive_reason",
            "archive_start",
            "groups",
            "group",
            "absences",
        )
        read_only_fields = ("status", "archive_reason", "archive_start")
        extra_kwargs = {"started_on": {"required": False}}

    def get_groups(self, s):
        return [{"id": e.group_id, "name": e.group.name} for e in s.enrollments.all() if e.left_on is None]

    def validate_started_on(self, v):
        if v > today() + dt.timedelta(days=366):
            raise serializers.ValidationError("Sana juda uzoq kelajakda")
        return v

    def create(self, data):
        group = data.pop("group", None)
        data.setdefault("started_on", today())
        student = Student.objects.create(**data)
        if group:
            services.enroll(student, group, student.started_on)
        return student


class ContactSerializer(serializers.ModelSerializer):
    by = serializers.StringRelatedField()

    class Meta:
        model = ParentContact
        fields = ("id", "student", "by", "note", "missed_at_time", "created_at")


class MarkSerializer(serializers.Serializer):
    group = serializers.PrimaryKeyRelatedField(queryset=Group.objects.all())
    date = serializers.DateField()
    records = serializers.ListField(child=serializers.DictField(), required=False)
    all_present = serializers.BooleanField(required=False, default=False)

    def validate_records(self, recs):
        out = []
        for r in recs:
            if not isinstance(r.get("student"), int) or not isinstance(r.get("present"), bool):
                raise serializers.ValidationError("Har yozuv: {student: int, present: bool}")
            out.append({"student": r["student"], "present": r["present"]})
        return out
