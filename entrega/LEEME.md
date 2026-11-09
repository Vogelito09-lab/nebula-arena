# Entrega — Nebula Arena en la nube (Unidad 3)

- **Repositorio:** https://github.com/Vogelito09-lab/nebula-arena (código, Terraform, pipeline y estos mismos archivos)
- **Nube:** AWS, región us-east-2 (Ohio). Todo se creó con Terraform el 2026-11-09, se probó y se destruyó el mismo día.

## Documentos (`documentos/`)

| Archivo | Qué es |
|---|---|
| `reporte-tecnico.pdf` | Reporte técnico del proyecto integrador (6 páginas): arquitectura, resultados, capacidad, tiempo de reacción del escalado, costos y recomendaciones |
| `practica-3.1.pdf` | Bot e inferencia: CPU vs GPU, capacidad y costo |
| `practica-3.2.pdf` | Pipeline CI/CD con GitHub Actions, y rollback |
| `practica-3.3.pdf` | Clúster EKS con Agones y partida real |
| `practica-3.4.pdf` | Autoescalado en tres capas y prueba de carga de 300 jugadores |
| `practica-3.5.pdf` | Tabla de líderes serverless, prueba de carga y costo serverless vs VM |
| `practica-3.6.pdf` | Terraform: estado remoto, drift, idempotencia, presupuesto y destroy |
| `presentacion.pdf` | Guion de la presentación de 10 minutos con la demo en vivo |

## Evidencias (`evidencias/`)

| Carpeta | Contenido principal |
|---|---|
| `00-acceso-aws/` | Cómo se accedió a AWS sin llaves guardadas |
| `3.2-pipeline/` | Captura del pipeline en verde (4 trabajos) y salida de `kubectl` con la imagen del commit |
| `3.3-cluster-agones/` | `terraform plan` del clúster y partida real de 10 jugadores (RTT) |
| `3.4-autoescalado/` | Captura de Grafana durante la rampa, gráficas de reacción del autoescalado y CCU vs latencia, estado del clúster y CSV de Prometheus y Locust |
| `3.5-tabla-lideres/` | `plan`/`apply`, prueba en CloudShell (201/401/400), pruebas de carga antes y después de la mejora, métricas de CloudWatch |
| `3.6-terraform/` | `plan` sin drift, idempotencia, clúster funcionando y `destroy` sin recursos huérfanos |

El ID de la cuenta de AWS y el correo están enmascarados en todas las evidencias.

## Lo que no se midió (y por qué)

- **Rampa de 1,000 jugadores y pico de 1× a 10×:** con ~42 jugadores por nodo harían falta ~24 nodos. El máximo se dejó en 6 para no agotar el crédito del plan gratuito.
- **500 espectadores por CDN:** no se montó S3 + CloudFront. La extrapolación a 20,000 espectadores (54 TB por hora) está calculada en el reporte.
