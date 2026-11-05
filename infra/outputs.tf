output "cluster" {
  value = module.gke.nombre
}

output "zona" {
  value = var.zona
}

output "registro" {
  description = "Prefijo de las imágenes: <registro>/nebula-server:<tag>"
  value       = "${var.region}-docker.pkg.dev/${var.proyecto}/${module.registro.repositorio}"
}

output "cuenta_github" {
  description = "Cuenta de servicio que usa GitHub Actions (práctica 3.2)"
  value       = module.iam.cuenta_github
}

output "credenciales" {
  description = "Comando para conectar kubectl al clúster"
  value       = "gcloud container clusters get-credentials ${module.gke.nombre} --zone ${var.zona}"
}
