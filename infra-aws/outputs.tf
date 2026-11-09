output "url_tabla_lideres" {
  description = "URL pública de la tabla de líderes (LEADERBOARD_URL del servidor y ?leaderboard= del cliente)."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "registro" {
  description = "Prefijo de las imágenes en ECR."
  value       = split("/", aws_ecr_repository.imagenes["nebula-server"].repository_url)[0]
}

output "usuario_github" {
  description = "Usuario IAM de GitHub Actions (su llave se crea a mano y va solo a los secretos de GitHub)."
  value       = aws_iam_user.github.name
}

output "cluster" {
  value = aws_eks_cluster.nebula.name
}

output "conectar_kubectl" {
  value = "aws eks update-kubeconfig --name ${aws_eks_cluster.nebula.name} --region ${var.region}"
}
