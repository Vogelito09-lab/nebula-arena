# Clúster GKE zonal y pool de nodos para los servidores de juego.
variable "nombre" { type = string }
variable "zona" { type = string }
variable "red" { type = string }
variable "subred" { type = string }
variable "tipo_maquina" { type = string }
variable "nodos_juego" { type = number }
variable "nodos_min" { type = number }
variable "nodos_max" { type = number }
variable "cuenta_nodos" { type = string }
variable "etiquetas" { type = map(string) }

resource "google_container_cluster" "nebula" {
  name                     = var.nombre
  location                 = var.zona
  network                  = var.red
  subnetwork               = var.subred
  remove_default_node_pool = true
  initial_node_count       = 1
  deletion_protection      = false # permite terraform destroy al terminar la sesión
  resource_labels          = var.etiquetas

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "servicios"
  }
}

# Capa 3 del autoescalado: el Cluster Autoscaler agrega nodos cuando hay pods
# pendientes (servidores de juego nuevos que no caben).
resource "google_container_node_pool" "juego" {
  name               = "game-pool"
  cluster            = google_container_cluster.nebula.id
  initial_node_count = var.nodos_juego

  autoscaling {
    min_node_count = var.nodos_min
    max_node_count = var.nodos_max
  }

  node_config {
    machine_type    = var.tipo_maquina
    service_account = var.cuenta_nodos
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
    tags            = ["game-server"]
    labels          = { rol = "juego" }
  }
}

output "nombre" { value = google_container_cluster.nebula.name }
output "endpoint" { value = google_container_cluster.nebula.endpoint }
output "ca_certificate" {
  value     = google_container_cluster.nebula.master_auth[0].cluster_ca_certificate
  sensitive = true
}
# el pool debe existir antes de instalar Agones
output "pool_id" { value = google_container_node_pool.juego.id }
