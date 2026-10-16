from django.db import migrations, models

BASE = ["101", "102", "103", "104", "105", "106", "107", "108", "201", "202", "203", "204"]


def seed(apps, schema_editor):
    Room = apps.get_model("academics", "Room")
    Group = apps.get_model("academics", "Group")
    used = set(Group.objects.exclude(room="").values_list("room", flat=True))
    for name in sorted(set(BASE) | used):
        Room.objects.get_or_create(name=name)


class Migration(migrations.Migration):
    dependencies = [("academics", "0002_initial")]

    operations = [
        migrations.CreateModel(
            name="Room",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=10, unique=True)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
