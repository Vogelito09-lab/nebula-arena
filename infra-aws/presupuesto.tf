# Práctica 3.6: alarma de costos. El plan gratuito descuenta todo de los créditos,
# así que el gasto "neto" siempre se ve en USD 0. Por eso el presupuesto mide el
# costo ANTES de créditos (include_credit = false): avisa cuando se están
# gastando los créditos, no cuando ya se acabaron.
resource "aws_budgets_budget" "nebula" {
  count        = var.correo_alertas == "" ? 0 : 1
  name         = "nebula-arena-mensual"
  budget_type  = "COST"
  limit_amount = tostring(var.presupuesto_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = false
    include_refund = false
  }

  # 50 % y 80 % de lo gastado de verdad, y 100 % de lo que AWS pronostica para el mes
  dynamic "notification" {
    for_each = [
      { umbral = 50, tipo = "ACTUAL" },
      { umbral = 80, tipo = "ACTUAL" },
      { umbral = 100, tipo = "FORECASTED" },
    ]
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value.umbral
      threshold_type             = "PERCENTAGE"
      notification_type          = notification.value.tipo
      subscriber_email_addresses = [var.correo_alertas]
    }
  }
}
