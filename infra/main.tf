# Práctica 3.6 — Nebula Arena completo con Terraform (Google Cloud).
# El nombre del entorno sale del workspace: default/dev, staging o prod.
locals {
  entorno = terraform.workspace == "default" ? "dev" : terraform.workspace
  nombre  = "nebula-${local.entorno}"
  etiquetas = {
    proyecto = "nebula-arena"
    entorno  = local.entorno
  }
}

module "servicios" {
  source   = "./modules/servicios"
  proyecto = var.proyecto
  region   = var.region
}

module "red" {
  source     = "./modules/red"
  nombre     = local.nombre
  region     = var.region
  depends_on = [module.servicios]
}

module "iam" {
  source     = "./modules/iam"
  proyecto   = var.proyecto
  nombre     = local.nombre
  depends_on = [module.servicios]
}

module "registro" {
  source     = "./modules/registro"
  region     = var.region
  etiquetas  = local.etiquetas
  depends_on = [module.servicios]
}

module "gke" {
  source       = "./modules/gke"
  nombre       = local.nombre
  zona         = var.zona
  red          = module.red.red_id
  subred       = module.red.subred_id
  tipo_maquina = var.tipo_maquina
  nodos_juego  = var.nodos_juego
  nodos_min    = var.nodos_min
  nodos_max    = var.nodos_max
  cuenta_nodos = module.iam.cuenta_nodos
  etiquetas    = local.etiquetas
}

module "agones" {
  source        = "./modules/agones"
  version_chart = var.version_agones
  depends_on    = [module.gke]
}
