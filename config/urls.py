from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.views import healthz

urlpatterns = [
    path("healthz/", healthz),
    path(settings.ADMIN_URL, admin.site.urls),
    path("api/", include("apps.accounts.urls")),
    path("api/", include("apps.academics.urls")),
    path("api/", include("apps.finance.urls")),
    path("api/", include("apps.core.urls")),
]
if settings.DEBUG:
    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    ]
