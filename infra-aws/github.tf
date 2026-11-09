# Práctica 3.2 (AWS): identidad de GitHub Actions.
#
# Lo ideal es OIDC (sin llaves guardadas), pero la cuenta del plan gratuito
# lo bloquea: iam:CreateOpenIDConnectProvider tiene un "explicit deny" en la
# política de control de servicios (SCP) de AWS. Se usa la opción del material:
# un usuario IAM SOLO para GitHub, con permisos mínimos. Su llave de acceso NO
# se crea aquí (quedaría en el estado de Terraform): se crea a mano y se guarda
# únicamente como secretos AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY en GitHub.
resource "aws_iam_user" "github" {
  name = "nebula-github"
}

# Mínimo privilegio: subir imágenes a SUS dos repositorios y ver el clúster.
resource "aws_iam_user_policy" "github" {
  name = "nebula-github"
  user = aws_iam_user.github.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage",
        ]
        Resource = [for r in aws_ecr_repository.imagenes : r.arn]
      },
      { Effect = "Allow", Action = "eks:DescribeCluster", Resource = aws_eks_cluster.nebula.arn },
    ]
  })
}

# Dentro de Kubernetes, el usuario entra al grupo "github-deployer", que solo
# puede actualizar la flota y el matchmaker (k8s/aws/rbac-github.yaml).
resource "aws_eks_access_entry" "github" {
  cluster_name      = aws_eks_cluster.nebula.name
  principal_arn     = aws_iam_user.github.arn
  kubernetes_groups = ["github-deployer"]
}
