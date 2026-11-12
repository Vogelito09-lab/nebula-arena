# Práctica 3.3 (AWS): clúster EKS para los servidores de partida.
# Equivale a infra/modules/gke e infra/modules/iam (nodos).

# --- Plano de control ------------------------------------------------------
resource "aws_iam_role" "cluster" {
  name = "nebula-eks-cluster"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "eks.amazonaws.com" }
      Action    = ["sts:AssumeRole", "sts:TagSession"]
    }]
  })
}

resource "aws_iam_role_policy_attachment" "cluster" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_eks_cluster" "nebula" {
  name     = "nebula"
  role_arn = aws_iam_role.cluster.arn
  # 1.36 está en soporte estándar (USD 0.10/h). Las versiones en soporte
  # extendido cuestan 6 veces más. Agones 1.62 soporta 1.34–1.36.
  version = var.version_k8s

  vpc_config {
    subnet_ids              = aws_subnet.publica[*].id
    endpoint_public_access  = true
    endpoint_private_access = true
  }

  # Permisos de Kubernetes por "access entries" (API de EKS), sin aws-auth.
  # Quien crea el clúster (la sesión de aws login) queda como administrador.
  access_config {
    authentication_mode                         = "API"
    bootstrap_cluster_creator_admin_permissions = true
  }

  depends_on = [aws_iam_role_policy_attachment.cluster]
}

# --- Nodos -------------------------------------------------------------------
# Nodos: unirse al clúster, red de pods y descargar imágenes de ECR. Nada más.
resource "aws_iam_role" "nodos" {
  name = "nebula-eks-nodos"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "nodos" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
  ])
  role       = aws_iam_role.nodos.name
  policy_arn = each.value
}

# Capa 3 del autoescalado: el Cluster Autoscaler mueve "desired" entre min y max.
# m7i-flex.large (2 vCPU, 8 GB) es de los tipos que permite el plan gratuito.
resource "aws_eks_node_group" "juego" {
  cluster_name    = aws_eks_cluster.nebula.name
  node_group_name = "game-pool"
  node_role_arn   = aws_iam_role.nodos.arn
  subnet_ids      = aws_subnet.publica[*].id
  instance_types  = [var.tipo_maquina]
  disk_size       = 20
  labels          = { rol = "juego" }

  scaling_config {
    desired_size = var.nodos_juego
    min_size     = var.nodos_min
    max_size     = var.nodos_max
  }

  # el autoscaler cambia desired_size; Terraform no debe regresarlo
  lifecycle {
    ignore_changes = [scaling_config[0].desired_size]
  }

  # La ruta a internet debe existir mientras haya nodos: al destruir, Terraform
  # la borraba primero y el desinstalador de Agones (Helm) no podía descargar su
  # imagen, así que el destroy se atoraba. Con esta dependencia se borra al final.
  depends_on = [aws_iam_role_policy_attachment.nodos, aws_route_table_association.publica]
}

# Agente de "Pod Identity": da permisos de AWS a pods concretos (el autoscaler).
resource "aws_eks_addon" "pod_identity" {
  cluster_name = aws_eks_cluster.nebula.name
  addon_name   = "eks-pod-identity-agent"
  depends_on   = [aws_eks_node_group.juego]
}

# metrics-server: lo necesita el HPA del matchmaker (capa 2) para medir la CPU.
# EKS no lo trae instalado; sin él, el HPA muestra "cpu: <unknown>".
resource "aws_eks_addon" "metrics_server" {
  cluster_name = aws_eks_cluster.nebula.name
  addon_name   = "metrics-server"
  depends_on   = [aws_eks_node_group.juego]
}

# --- Permisos del Cluster Autoscaler (solo sobre los grupos de ESTE clúster) --
resource "aws_iam_role" "autoscaler" {
  name = "nebula-cluster-autoscaler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "pods.eks.amazonaws.com" }
      Action    = ["sts:AssumeRole", "sts:TagSession"]
    }]
  })
}

resource "aws_iam_role_policy" "autoscaler" {
  name = "nebula-cluster-autoscaler"
  role = aws_iam_role.autoscaler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "autoscaling:DescribeAutoScalingGroups", "autoscaling:DescribeAutoScalingInstances",
          "autoscaling:DescribeLaunchConfigurations", "autoscaling:DescribeScalingActivities",
          "autoscaling:DescribeTags", "ec2:DescribeImages", "ec2:DescribeInstanceTypes",
          "ec2:DescribeLaunchTemplateVersions", "ec2:GetInstanceTypesFromInstanceRequirements",
          "eks:DescribeNodegroup",
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["autoscaling:SetDesiredCapacity", "autoscaling:TerminateInstanceInAutoScalingGroup"]
        Resource = "*"
        Condition = {
          StringEquals = { "aws:ResourceTag/k8s.io/cluster-autoscaler/${aws_eks_cluster.nebula.name}" = "owned" }
        }
      },
    ]
  })
}

resource "aws_eks_pod_identity_association" "autoscaler" {
  cluster_name    = aws_eks_cluster.nebula.name
  namespace       = "kube-system"
  service_account = "cluster-autoscaler"
  role_arn        = aws_iam_role.autoscaler.arn
}
