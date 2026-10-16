from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("payments", views.PaymentViewSet, basename="payment")
router.register("cash", views.CashViewSet, basename="cash")

urlpatterns = router.urls + [
    path("students/<int:pk>/finance/", views.StudentFinanceView.as_view()),
    path("students/<int:pk>/pay/", views.StudentPayView.as_view()),
    path("students/<int:pk>/discount/", views.StudentDiscountView.as_view()),
    path("finance/overview/", views.OverviewView.as_view()),
    path("finance/month/", views.MonthRowsView.as_view()),
    path("finance/debtors/", views.DebtorsView.as_view()),
    path("finance/months/<str:month>/<str:op>/", views.MonthCloseView.as_view()),
    path("salary/", views.SalaryView.as_view()),
    path("salary/me/", views.MySalaryView.as_view()),
    path("salary/<int:pk>/pay/", views.SalaryView.as_view()),
]
