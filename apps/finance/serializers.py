from rest_framework import serializers

from apps.core.utils import validate_month

from .models import CashEntry, Payment


class PaymentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)

    class Meta:
        model = Payment
        fields = ("id", "student", "student_name", "month", "amount", "paid_on", "note", "created_at")
        read_only_fields = ("created_at",)


class PayInputSerializer(serializers.Serializer):
    month = serializers.CharField(required=False, validators=[validate_month])
    amount = serializers.IntegerField(min_value=1, max_value=1_000_000_000)
    note = serializers.CharField(required=False, allow_blank=True, max_length=255, default="")


class DiscountInputSerializer(serializers.Serializer):
    month = serializers.CharField(validators=[validate_month])
    amount = serializers.IntegerField(min_value=0, max_value=1_000_000_000)


class CashEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = CashEntry
        fields = ("id", "kind", "category", "amount", "date", "month", "staff", "note", "created_at")
        read_only_fields = ("created_at",)
        extra_kwargs = {"month": {"required": False}}

    def validate_category(self, v):
        if v == "oylik":
            raise serializers.ValidationError("Oylik faqat 'Oylik' bo'limidan to'lanadi")
        return v
