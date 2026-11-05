# Infraestructura como código (práctica 3.6)

Terraform crea la red, el clúster GKE con autoescalado de nodos, Artifact
Registry, las cuentas de servicio con permisos mínimos, Firestore, el secreto de
la tabla de líderes e instala Agones con Helm. Se basa en la práctica 3.6 del
material, organizada en módulos.

```
infra/
├── providers.tf      proveedores (google, helm) y estado remoto en GCS
├── variables.tf      proyecto, región, tipo de máquina, nodos...
├── main.tf           llama a los módulos; el entorno sale del workspace
├── outputs.tf        clúster, registro, cuenta de GitHub, comando de credenciales
├── entornos/         dev.tfvars, staging.tfvars, prod.tfvars
└── modules/
    ├── servicios/    APIs, Firestore, cuenta y secreto de la tabla de líderes
    ├── red/          VPC, subred con rangos para pods/servicios, firewall 7000-8000
    ├── iam/          cuentas de nodos y de GitHub Actions (permisos mínimos)
    ├── registro/     Artifact Registry "nebula"
    ├── gke/          clúster zonal + node pool con Cluster Autoscaler
    └── agones/       helm_release de Agones (con ServiceMonitor para Prometheus)
```

## Entornos

El mismo código crea entornos separados con *workspaces* y archivos de variables.
El clúster se llama `nebula-<entorno>`.

| Entorno | Workspace | Variables | Nodos | Para qué |
|---|---|---|---|---|
| Desarrollo | `default` (= dev) | `entornos/dev.tfvars` | 2 × e2-standard-4 (8 vCPU) | Prácticas 3.3 y 3.6 dentro del límite de la prueba gratuita |
| Staging | `staging` | `entornos/staging.tfvars` | 3–12 × e2-standard-4 | Pruebas de carga de la 3.4 (necesita la cuenta completa) |
| Producción | `prod` | `entornos/prod.tfvars` | 3–20 × c3-standard-4 | Referencia; no se crea en el curso |

## Uso

Una sola vez por proyecto, crea el bucket del estado remoto. GCS bloquea el
estado mientras alguien ejecuta `plan` o `apply`; el versionado permite
recuperar un estado dañado.

```bash
gcloud services enable storage.googleapis.com
gcloud storage buckets create gs://nebula-tfstate-<TU-ID> --location=us-central1 --uniform-bucket-level-access
gcloud storage buckets update gs://nebula-tfstate-<TU-ID> --versioning
```

Ciclo de trabajo:

```bash
cd infra
terraform init -backend-config="bucket=nebula-tfstate-<TU-ID>"
terraform fmt -recursive
terraform validate
terraform workspace select -or-create default        # o staging
terraform plan  -var proyecto=<TU-PROYECTO> -var-file=entornos/dev.tfvars -out plan.tfplan
terraform apply plan.tfplan

# usar el clúster
$(terraform output -raw credenciales)
kubectl apply -f ../k8s/fleet.yaml -f ../k8s/autoscaler.yaml -f ../k8s/matchmaker.yaml

# al terminar la sesión
terraform destroy -var proyecto=<TU-PROYECTO> -var-file=entornos/dev.tfvars
```

Después del `apply`, el valor del secreto de la tabla de líderes se agrega a mano
(nunca en el código ni en el estado):

```bash
openssl rand -hex 24 | gcloud secrets versions add score-api-key --data-file=-
```

## Qué queda fuera de Terraform y por qué

- **Llave JSON de GitHub Actions:** si la creara Terraform, quedaría en texto plano en el estado. Se crea con `gcloud iam service-accounts keys create` y se guarda solo como secreto `GCP_SA_KEY` en GitHub. La alternativa de producción es Workload Identity Federation, que no usa llaves.
- **Servicio de Cloud Run:** se despliega con `gcloud run deploy --source serverless` (práctica 3.5), porque necesita construir la imagen. Terraform deja lista su cuenta de servicio, Firestore y el secreto.
- **El bucket del estado:** Terraform no puede crear el bucket donde guarda su propio estado.

## Recursos que generan cargos

| Recurso | Cobra mientras exista | Nota |
|---|---|---|
| Nodos del clúster (Compute Engine) | Sí, por hora | El principal costo; `destroy` al terminar |
| Tarifa de administración de GKE | Sí, por hora | Google suele dar un crédito mensual que cubre un clúster zonal; verifícalo en la calculadora |
| Balanceadores (Service LoadBalancer del matchmaker y del allocator) | Sí, por hora | Los crea Kubernetes, no Terraform: bórralos con `kubectl delete -f ../k8s/matchmaker.yaml` **antes** de `destroy`, o quedarán huérfanos |
| Artifact Registry | Por GB almacenado | Pocos centavos |
| Firestore, Secret Manager, Cloud Run | Por uso | Dentro de las capas gratuitas en las prácticas |
| Bucket del estado | Por GB | Centavos; se conserva a propósito |

## Verificado sin cuenta de nube

Con Terraform v1.16.6, el 2026-11-05: `terraform fmt -recursive` y
`terraform validate` → **Success! The configuration is valid.**
(`init -backend=false`). `plan`, `apply` y `destroy` necesitan el proyecto de
Google Cloud: pendientes.
