# Red y subred del clúster, y firewall de los puertos de partida de Agones.
variable "nombre" { type = string }
variable "region" { type = string }

resource "google_compute_network" "vpc" {
  name                    = "${var.nombre}-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "gke" {
  name          = "${var.nombre}-gke"
  region        = var.region
  network       = google_compute_network.vpc.id
  ip_cidr_range = "10.10.0.0/20"

  # rangos secundarios para pods y servicios (clúster VPC-native)
  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.20.0.0/16"
  }
  secondary_ip_range {
    range_name    = "servicios"
    ip_cidr_range = "10.30.0.0/20"
  }
}

# Agones asigna a cada partida un puerto entre 7000 y 8000 en el nodo.
resource "google_compute_firewall" "juego" {
  name          = "${var.nombre}-gameservers"
  network       = google_compute_network.vpc.name
  target_tags   = ["game-server"]
  source_ranges = ["0.0.0.0/0"]
  allow {
    protocol = "udp"
    ports    = ["7000-8000"]
  }
  allow {
    protocol = "tcp"
    ports    = ["7000-8000"]
  }
}

output "red_id" { value = google_compute_network.vpc.id }
output "subred_id" { value = google_compute_subnetwork.gke.id }
