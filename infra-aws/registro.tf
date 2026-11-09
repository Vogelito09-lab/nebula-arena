# Práctica 3.2 (AWS): registro de imágenes. Equivale a Artifact Registry.
# El pipeline sube aquí nebula-server:<sha> y matchmaker:<sha>.
resource "aws_ecr_repository" "imagenes" {
  for_each             = toset(["nebula-server", "matchmaker"])
  name                 = each.value
  image_tag_mutability = "IMMUTABLE" # una etiqueta = una sola imagen (trazabilidad por commit)
  force_delete         = true        # permite terraform destroy aunque tenga imágenes

  image_scanning_configuration {
    scan_on_push = true # busca vulnerabilidades conocidas en cada imagen
  }
}

# Guardar imágenes también cuesta: solo se conservan las 10 más recientes.
resource "aws_ecr_lifecycle_policy" "imagenes" {
  for_each   = aws_ecr_repository.imagenes
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "conservar solo las 10 imagenes mas recientes"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}
