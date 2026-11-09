# Lo que se instala DENTRO del clúster con Helm: Agones (3.3), Cluster
# Autoscaler (3.4) y Prometheus + Grafana (3.4/3.6).
# Equivale a infra/modules/agones.

resource "helm_release" "agones" {
  name             = "agones"
  repository       = "https://agones.dev/chart/stable"
  chart            = "agones"
  version          = var.version_agones
  namespace        = "agones-system"
  create_namespace = true
  timeout          = 900

  # El matchmaker pide servidores con GameServerAllocation (API de Kubernetes),
  # así que el allocator no necesita balanceador público, y el servicio de ping
  # tampoco: cada balanceador cuesta ~USD 18 al mes.
  set {
    name  = "agones.allocator.service.serviceType"
    value = "ClusterIP"
  }
  set {
    name  = "agones.ping.install"
    value = "false"
  }
  # métricas de servidores por estado para Prometheus (3.4)
  set {
    name  = "agones.metrics.serviceMonitor.enabled"
    value = "true"
  }

  depends_on = [aws_eks_node_group.juego, helm_release.monitoreo]
}

resource "helm_release" "cluster_autoscaler" {
  name       = "cluster-autoscaler"
  repository = "https://kubernetes.github.io/autoscaler"
  chart      = "cluster-autoscaler"
  version    = "9.60.0"
  namespace  = "kube-system"

  set {
    name  = "autoDiscovery.clusterName"
    value = aws_eks_cluster.nebula.name
  }
  set {
    name  = "awsRegion"
    value = var.region
  }
  set {
    name  = "rbac.serviceAccount.name"
    value = "cluster-autoscaler" # el que tiene la Pod Identity
  }
  # apagar nodos vacíos rápido = pagar menos (el valor por defecto es 10 min)
  set {
    name  = "extraArgs.scale-down-unneeded-time"
    value = "3m"
  }
  set {
    name  = "extraArgs.scale-down-delay-after-add"
    value = "3m"
  }

  depends_on = [aws_eks_pod_identity_association.autoscaler, aws_eks_addon.pod_identity]
}

# Prometheus + Grafana. Sin discos persistentes (las gráficas se exportan
# como evidencia antes de destruir) y con recursos acotados.
resource "helm_release" "monitoreo" {
  name             = "monitoreo"
  repository       = "https://prometheus-community.github.io/helm-charts"
  chart            = "kube-prometheus-stack"
  namespace        = "monitoring"
  create_namespace = true
  timeout          = 900

  values = [yamlencode({
    alertmanager = { enabled = false }
    prometheus = {
      prometheusSpec = {
        retention                               = "1d"
        scrapeInterval                          = "15s"
        podMonitorSelectorNilUsesHelmValues     = false # lee los PodMonitor del juego
        serviceMonitorSelectorNilUsesHelmValues = false # y el ServiceMonitor de Agones
        resources = {
          requests = { cpu = "200m", memory = "512Mi" }
          limits   = { memory = "1536Mi" }
        }
      }
    }
    grafana = {
      # contraseña aleatoria generada por el chart; se lee del Secret de
      # Kubernetes cuando se necesita (nunca en el repo)
      adminPassword = null
    }
  })]

  depends_on = [aws_eks_node_group.juego]
}
