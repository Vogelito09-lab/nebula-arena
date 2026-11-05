# Agones instalado con Helm desde Terraform.
variable "version_chart" { type = string }

resource "helm_release" "agones" {
  name             = "agones"
  repository       = "https://agones.dev/chart/stable"
  chart            = "agones"
  version          = var.version_chart
  namespace        = "agones-system"
  create_namespace = true

  # métricas de servidores por estado para Prometheus (3.4)
  set {
    name  = "agones.metrics.serviceMonitor.enabled"
    value = "true"
  }
}
