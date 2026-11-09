# Infraestructura en AWS (variante AWS de las prácticas)

La versión de Google Cloud sigue en [`infra/`](../infra). Esta carpeta hace lo mismo en AWS, con las equivalencias que da el material:

| Pieza | Google Cloud (`infra/`) | AWS (`infra-aws/`) |
|---|---|---|
| Tabla de líderes (3.5) | Cloud Run + Firestore | Lambda + API Gateway + DynamoDB ([`tabla_lideres.tf`](tabla_lideres.tf)) |

La cuenta del plan gratuito solo permite la región **us-east-2 (Ohio)**.

## Requisitos
- AWS CLI v2 y Terraform ≥ 1.6.
- Sesión iniciada con `aws login --region us-east-2`. Son credenciales temporales: no hay llaves guardadas en el repo ni en Terraform.

## Uso
```powershell
cd infra-aws
terraform init
# solo la primera vez: crea la llave de POST /score en SSM (no se muestra)
powershell -ExecutionPolicy Bypass -File .\crear-llave.ps1
terraform apply
powershell -ExecutionPolicy Bypass -File .\probar-tabla.ps1   # prueba como los curl del material
terraform destroy   # al terminar la sesión, para no gastar crédito
```

`crear-llave.ps1` crea la llave fuera de Terraform a propósito. Así su valor nunca queda en el código ni en el archivo de estado. La Lambda solo conoce el **nombre** del parámetro, y su rol solo puede leer ese parámetro.

## Seguridad y costo
- **Mínimo privilegio:** el rol de la Lambda solo puede escribir sus logs, hacer `UpdateItem`, `GetItem` y `Scan` en `nebula-scores`, y leer `/nebula/score-api-key`.
- **Límite de peticiones en API Gateway:** 100 por segundo, con ráfagas de hasta 200. Así un abuso no se come el crédito.
- **Cobro por uso:** DynamoDB está en `PAY_PER_REQUEST` y Lambda cobra por invocación. Sin tráfico, el costo es prácticamente cero.
- **Logs:** se guardan 7 días.
- **Etiquetas:** todo lleva `proyecto = nebula-arena` para separar sus costos en Cost Explorer.
