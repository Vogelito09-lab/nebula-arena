# Práctica 3.5 (AWS): tabla de líderes serverless.
#   API Gateway (HTTP) -> Lambda (Python 3.12) -> DynamoDB (nebula-scores)
# Todo se paga por uso: sin tráfico, el costo es prácticamente cero.

data "aws_caller_identity" "actual" {}

# Base de datos: llave de partición "jugador", como en el material.
# PAY_PER_REQUEST = se paga por lectura/escritura, no por capacidad reservada.
resource "aws_dynamodb_table" "scores" {
  name         = "nebula-scores"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "jugador"

  attribute {
    name = "jugador"
    type = "S"
  }
}

# Rol de ejecución: la función solo puede escribir sus logs, tocar SU tabla
# (las 3 operaciones que usa) y leer SU parámetro. Mínimo privilegio.
resource "aws_iam_role" "leaderboard" {
  name = "nebula-leaderboard-lambda"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "leaderboard" {
  name = "nebula-leaderboard"
  role = aws_iam_role.leaderboard.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.leaderboard.arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem", "dynamodb:GetItem", "dynamodb:Scan"]
        Resource = aws_dynamodb_table.scores.arn
      },
      {
        Effect   = "Allow"
        Action   = "ssm:GetParameter"
        Resource = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.actual.account_id}:parameter${var.parametro_llave}"
      },
    ]
  })
}

# Logs con retención corta: guardarlos para siempre también cuesta.
resource "aws_cloudwatch_log_group" "leaderboard" {
  name              = "/aws/lambda/nebula-leaderboard"
  retention_in_days = 7
}

data "archive_file" "leaderboard" {
  type        = "zip"
  source_file = "${path.module}/../serverless/aws/lambda_function.py"
  output_path = "${path.module}/.build/leaderboard.zip"
}

resource "aws_lambda_function" "leaderboard" {
  function_name    = "nebula-leaderboard"
  role             = aws_iam_role.leaderboard.arn
  runtime          = "python3.12"
  handler          = "lambda_function.lambda_handler"
  filename         = data.archive_file.leaderboard.output_path
  source_code_hash = data.archive_file.leaderboard.output_base64sha256
  memory_size      = 256
  timeout          = 5

  environment {
    variables = {
      TABLA               = aws_dynamodb_table.scores.name
      SCORE_API_KEY_PARAM = var.parametro_llave
    }
  }

  depends_on = [aws_cloudwatch_log_group.leaderboard, aws_iam_role_policy.leaderboard]
}

# API Gateway HTTP: la "puerta" pública. CORS deja que el cliente web lea /top;
# el límite de peticiones protege el crédito si alguien abusa del endpoint.
resource "aws_apigatewayv2_api" "leaderboard" {
  name          = "nebula-leaderboard"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST"]
    allow_headers = ["content-type", "x-api-key"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_integration" "leaderboard" {
  api_id                 = aws_apigatewayv2_api.leaderboard.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.leaderboard.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "rutas" {
  for_each  = toset(["POST /score", "GET /top", "GET /jugador/{jugador}", "GET /healthz"])
  api_id    = aws_apigatewayv2_api.leaderboard.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.leaderboard.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.leaderboard.id
  name        = "$default"
  auto_deploy = true

  # Primera prueba de carga: con 100 req/s, el 70 % de las peticiones de 500
  # usuarios (~440 req/s) recibieron 429. Se sube a 1000 req/s: sigue siendo
  # un tope contra abuso, y una petición cuesta fracciones de centavo.
  default_route_settings {
    throttling_rate_limit  = 1000 # peticiones por segundo
    throttling_burst_limit = 2000
  }
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "api-gateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.leaderboard.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.leaderboard.execution_arn}/*/*"
}
