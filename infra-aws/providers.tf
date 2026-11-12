# Infraestructura de Nebula Arena en AWS (variante AWS de las prácticas).
# La versión de Google Cloud sigue en infra/; esta carpeta es su equivalente:
#   Firestore + Cloud Run      -> DynamoDB + Lambda + API Gateway   (tabla_lideres.tf)
#
# Credenciales: nunca van aquí. Terraform usa las de "aws login" (temporales).
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.4" }
    helm    = { source = "hashicorp/helm", version = "~> 2.17" }
  }

  # Estado remoto en S3 con bloqueo nativo (use_lockfile, Terraform >= 1.10):
  # ya no hace falta la tabla de DynamoDB que pide el material para el bloqueo.
  # El bucket se crea una vez a mano (ver README) y se pasa al iniciar:
  #   terraform init -backend-config="bucket=nebula-tfstate-<ID-DE-CUENTA>"
  backend "s3" {
    key          = "nebula/aws.tfstate"
    region       = "us-east-2"
    encrypt      = true
    use_lockfile = true
  }
}

# Helm se conecta al clúster recién creado para instalar Agones, el Cluster
# Autoscaler y el monitoreo. El token se pide con la AWS CLI en cada uso
# (dura 15 min; uno fijo caducaría mientras se crea el clúster).
provider "helm" {
  kubernetes {
    host                   = aws_eks_cluster.nebula.endpoint
    cluster_ca_certificate = base64decode(aws_eks_cluster.nebula.certificate_authority[0].data)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = var.aws_cli
      args        = ["eks", "get-token", "--cluster-name", aws_eks_cluster.nebula.name, "--region", var.region]
    }
  }
}

provider "aws" {
  region = var.region

  # Etiquetas en todo lo que se crea: así el explorador de costos separa
  # lo del proyecto de lo demás de la cuenta.
  default_tags {
    tags = {
      proyecto = "nebula-arena"
      gestion  = "terraform"
    }
  }
}

