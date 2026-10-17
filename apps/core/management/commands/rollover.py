from django.core.management.base import BaseCommand

from apps.finance.services import rollover


class Command(BaseCommand):
    help = "Oy avtomatik o'tishi: yangi oyni ochadi, o'tgan oylarni (sozlamaga qarab) yopadi. Cron: 5 0 1 * *"

    def handle(self, *args, **opts):
        self.stdout.write(str(rollover()))
