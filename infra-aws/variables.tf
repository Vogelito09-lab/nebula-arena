variable "region" {
  description = "Región de AWS. La cuenta del plan gratuito solo permite us-east-2 (Ohio)."
  type        = string
  default     = "us-east-2"
}

variable "aws_cli" {
  description = "Ruta de la AWS CLI (Helm la usa para pedir el token del clúster)."
  type        = string
  default     = "aws"
}

variable "repo_github" {
  description = "Repositorio de GitHub (usuario/repo) que puede desplegar con el rol nebula-github."
  type        = string
  default     = "Vogelito09-lab/nebula-arena"
}

variable "version_k8s" {
  description = "Versión de Kubernetes de EKS (debe estar en soporte estándar y ser compatible con Agones)."
  type        = string
  default     = "1.36"
}

variable "version_agones" {
  description = "Versión del chart de Agones (la misma que en Google Cloud y en kind)."
  type        = string
  default     = "1.62.0"
}

variable "tipo_maquina" {
  description = "Tipo de máquina de los nodos. El plan gratuito solo permite tipos chicos; m7i-flex.large = 2 vCPU, 8 GB."
  type        = string
  default     = "m7i-flex.large"
}

variable "nodos_juego" {
  description = "Nodos al crear el clúster."
  type        = number
  default     = 2
}

variable "nodos_min" {
  description = "Mínimo de nodos del Cluster Autoscaler."
  type        = number
  default     = 2
}

variable "nodos_max" {
  description = "Máximo de nodos del Cluster Autoscaler (6 × 2 vCPU = 12 vCPU, tope para cuidar el crédito)."
  type        = number
  default     = 6
}

variable "parametro_llave" {
  description = <<-EOT
    Nombre del parámetro SecureString de SSM con la llave de POST /score.
    El valor se crea a mano (ver infra-aws/README.md) para que nunca quede en
    el código ni en el estado de Terraform.
  EOT
  type        = string
  default     = "/nebula/score-api-key"
}

variable "presupuesto_usd" {
  description = "Gasto mensual (antes de créditos) a partir del cual AWS avisa por correo."
  type        = number
  default     = 15
}

variable "correo_alertas" {
  description = <<-EOT
    Correo que recibe las alertas del presupuesto. No se sube a Git: ponlo en
    infra-aws/local.auto.tfvars (ignorado) como  correo_alertas = "tu@correo".
    Si se deja vacío, no se crea el presupuesto.
  EOT
  type        = string
  default     = ""
}
