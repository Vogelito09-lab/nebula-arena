# Práctica 3.6 — proveedores y estado remoto.
terraform {
  required_version = ">= 1.6"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
    helm   = { source = "hashicorp/helm", version = "~> 2.13" }
  }

  # Estado remoto con bloqueo: el backend "gcs" bloquea el estado mientras
  # alguien ejecuta plan/apply. El bucket se crea una sola vez a mano
  # (ver infra/README.md) y se pasa al iniciar:
  #   terraform init -backend-config="bucket=nebula-tfstate-<TU-ID>"
  backend "gcs" {
    prefix = "nebula"
  }
}

provider "google" {
  project = var.proyecto
  region  = var.region
}

data "google_client_config" "actual" {}

# Helm se conecta al clúster recién creado para instalar Agones.
provider "helm" {
  kubernetes {
    host                   = "https://${module.gke.endpoint}"
    token                  = data.google_client_config.actual.access_token
    cluster_ca_certificate = base64decode(module.gke.ca_certificate)
  }
}
