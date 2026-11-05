# APIs del proyecto, Firestore y lo que necesita la tabla de líderes (3.5).
variable "proyecto" { type = string }
variable "region" { type = string }

locals {
  apis = [
    "compute.googleapis.com",
    "container.googleapis.com",
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "firestore.googleapis.com",
    "cloudbuild.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false # apagar APIs al destruir rompe otros recursos del proyecto
}

# Base de datos de la tabla de líderes. deletion_policy = "DELETE" para que
# terraform destroy no deje la base huérfana.
resource "google_firestore_database" "scores" {
  name            = "(default)"
  location_id     = "nam5"
  type            = "FIRESTORE_NATIVE"
  deletion_policy = "DELETE"
  depends_on      = [google_project_service.apis]
}

# Identidad del servicio de Cloud Run: solo lee/escribe Firestore y lee su secreto.
resource "google_service_account" "leaderboard" {
  account_id   = "nebula-leaderboard"
  display_name = "Cloud Run - tabla de lideres de Nebula Arena"
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "leaderboard_firestore" {
  project = var.proyecto
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.leaderboard.email}"
}

# Llave que protege POST /score. Terraform crea el secreto vacío; el valor se
# agrega a mano para que nunca quede en el código ni en el estado:
#   openssl rand -hex 24 | gcloud secrets versions add score-api-key --data-file=-
resource "google_secret_manager_secret" "score_api_key" {
  secret_id = "score-api-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "leaderboard_lee_llave" {
  secret_id = google_secret_manager_secret.score_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.leaderboard.email}"
}

output "cuenta_leaderboard" { value = google_service_account.leaderboard.email }
