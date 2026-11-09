# Infraestructura en AWS (variante AWS de las prácticas)

La versión de Google Cloud sigue en [`infra/`](../infra). Esta carpeta hace lo mismo en AWS, con las equivalencias que da el material:

| Pieza | Google Cloud (`infra/`) | AWS (`infra-aws/`) |
|---|---|---|
| Tabla de líderes (3.5) | Cloud Run + Firestore | Lambda + API Gateway + DynamoDB ([`tabla_lideres.tf`](tabla_lideres.tf)) |

La cuenta del plan gratuito solo permite la región **us-east-2 (Ohio)**.

## Requisitos
- AWS CLI v2 y Terraform ≥ 1.10 (por el bloqueo nativo del estado en S3).
- Sesión iniciada con `aws login --region us-east-2`. Son credenciales temporales: no hay llaves guardadas en el repo ni en Terraform.

## Uso
```powershell
cd infra-aws
# solo la primera vez: bucket privado y versionado para el estado de Terraform
$id = aws sts get-caller-identity --query Account --output text
aws s3api create-bucket --bucket nebula-tfstate-$id --region us-east-2 --create-bucket-configuration LocationConstraint=us-east-2
aws s3api put-bucket-versioning --bucket nebula-tfstate-$id --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket nebula-tfstate-$id --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

terraform init "-backend-config=bucket=nebula-tfstate-$id"
# solo la primera vez: crea la llave de POST /score en SSM (no se muestra)
powershell -ExecutionPolicy Bypass -File .\crear-llave.ps1
# opcional: correo para la alarma de presupuesto (archivo ignorado por Git)
'correo_alertas = "tu@correo"' | Out-File -Encoding ascii local.auto.tfvars

terraform fmt -check; terraform validate
terraform plan -out plan.tfplan     # se revisa en el pull request
terraform apply plan.tfplan         # aplica exactamente lo revisado
powershell -ExecutionPolicy Bypass -File .\desplegar-juego.ps1 -Etiqueta <sha>
# al terminar la sesión, para no gastar crédito:
kubectl delete fleet --all; kubectl delete svc matchmaker      # el balanceador lo crea Kubernetes
aws iam list-access-keys --user-name nebula-github             # borrar su llave con delete-access-key
terraform plan -destroy -out destroy.tfplan; terraform apply destroy.tfplan
```

`crear-llave.ps1` crea la llave fuera de Terraform a propósito. Así su valor nunca queda en el código ni en el archivo de estado. La Lambda solo conoce el **nombre** del parámetro, y su rol solo puede leer ese parámetro.

## Seguridad y costo
- **Mínimo privilegio:** el rol de la Lambda solo puede escribir sus logs, hacer `UpdateItem`, `GetItem` y `Scan` en `nebula-scores`, y leer `/nebula/score-api-key`.
- **Límite de peticiones en API Gateway:** 1000 por segundo, con ráfagas de hasta 2000 (se subió desde 100 después de la prueba de carga de la 3.5). Así un abuso no se come el crédito.
- **Cobro por uso:** DynamoDB está en `PAY_PER_REQUEST` y Lambda cobra por invocación. Sin tráfico, el costo es prácticamente cero.
- **Logs:** se guardan 7 días.
- **Etiquetas:** todo lleva `proyecto = nebula-arena` para separar sus costos en Cost Explorer.
