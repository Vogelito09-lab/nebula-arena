# Artifact Registry: imágenes nebula-server y matchmaker, etiquetadas por SHA.
variable "region" { type = string }
variable "etiquetas" { type = map(string) }

resource "google_artifact_registry_repository" "imagenes" {
  location      = var.region
  repository_id = "nebula"
  format        = "DOCKER"
  labels        = var.etiquetas
}

output "repositorio" { value = google_artifact_registry_repository.imagenes.repository_id }
