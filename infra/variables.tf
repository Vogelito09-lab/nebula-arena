variable "proyecto" {
  description = "ID del proyecto de Google Cloud"
  type        = string
}

variable "region" {
  description = "Región de todos los recursos"
  type        = string
  default     = "us-central1"
}

variable "zona" {
  description = "Zona del clúster (zonal: más barato que regional)"
  type        = string
  default     = "us-central1-a"
}

variable "tipo_maquina" {
  description = "Tipo de máquina del pool de servidores de juego"
  type        = string
  default     = "e2-standard-4"
}

variable "nodos_juego" {
  description = "Nodos iniciales del pool de servidores de juego"
  type        = number
  default     = 3
}

variable "nodos_min" {
  description = "Mínimo de nodos del Cluster Autoscaler"
  type        = number
  default     = 3
}

variable "nodos_max" {
  description = "Máximo de nodos del Cluster Autoscaler"
  type        = number
  default     = 20
}

variable "version_agones" {
  description = "Versión del chart de Agones"
  type        = string
  default     = "1.62.0"
}

variable "repo_github" {
  description = "Repositorio de GitHub (usuario/repo) que despliega con la cuenta de servicio"
  type        = string
  default     = ""
}
