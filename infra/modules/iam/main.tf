# Cuentas de servicio con permisos mínimos.
variable "proyecto" { type = string }
variable "nombre" { type = string }

# Nodos de GKE: escribir logs/métricas y descargar imágenes. Nada más.
resource "google_service_account" "nodos" {
  account_id   = "${var.nombre}-nodos"
  display_name = "Nodos GKE de ${var.nombre}"
}

resource "google_project_iam_member" "nodos" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/monitoring.viewer",
    "roles/artifactregistry.reader",
  ])
  project = var.proyecto
  role    = each.value
  member  = "serviceAccount:${google_service_account.nodos.email}"
}

# GitHub Actions (3.2): publicar imágenes y actualizar la flota en GKE.
# La llave JSON NO se crea aquí (quedaría en el estado de Terraform): se crea
# a mano con gcloud y se guarda solo como secreto GCP_SA_KEY en GitHub.
resource "google_service_account" "github" {
  account_id   = "${var.nombre}-github"
  display_name = "GitHub Actions de ${var.nombre}"
}

resource "google_project_iam_member" "github" {
  for_each = toset([
    "roles/artifactregistry.writer",
    "roles/container.developer",
  ])
  project = var.proyecto
  role    = each.value
  member  = "serviceAccount:${google_service_account.github.email}"
}

output "cuenta_nodos" { value = google_service_account.nodos.email }
output "cuenta_github" { value = google_service_account.github.email }
