# Preparar la cuenta de Google Cloud

Hace falta a partir del paso 3 de la práctica 3.3. Las prácticas 3.1 y los pasos
1–2 de la 3.3 no la necesitan.

## 1. Conseguir créditos

Opción A: **créditos educativos.** Pregunta al profesor si la materia tiene
cupones de Google Cloud for Education para tu correo institucional. Si los hay,
no necesitas tarjeta.

Opción B (la que usamos): **prueba gratuita con una cuenta personal de Gmail.**
Las cuentas institucionales suelen tener Google Cloud bloqueado por la
organización. En cloud.google.com → *Get started for free*:

- Los créditos de la prueba suelen vencer a los **90 días** de activarla. Actívala hasta tener listo el paso 3 de la 3.3, no antes. Confirma la fecha exacta en la consola (*Facturación → Créditos*).

- Da USD 300 en créditos (según el material de la unidad).
- Pide tarjeta para verificar identidad, pero no cobra mientras no actives la cuenta completa.
- Limita a **8 vCPU** encendidas a la vez. La práctica 3.4 necesita unas 30–40, así que antes de esa práctica hay que activar la cuenta completa. Los créditos que queden se conservan.

## 2. Crear el proyecto y la alerta de presupuesto

1. En la consola, crea un proyecto (por ejemplo `nebula-arena-<tu-id>`) y anota su **ID**.
2. *Facturación → Presupuestos y alertas → Crear presupuesto*: **USD 10**, con alertas al 50 %, 90 % y 100 %. El material lo recomienda antes de la primera práctica.

## 3. Instalar las herramientas que faltan en tu PC

Ya están instalados: Docker Desktop, kubectl, Helm y Git. Faltan:

- **Google Cloud CLI** (`gcloud`): cloud.google.com/sdk/docs/install → instalador de Windows.
- **Terraform ≥ 1.6** (para la 3.6): developer.hashicorp.com/terraform/install.

Después:

```bash
gcloud init                     # inicia sesión y elige el proyecto
gcloud components install gke-gcloud-auth-plugin
```

## Regla de costos

Al terminar **cada** sesión de laboratorio, borra el clúster:

```bash
gcloud container clusters delete nebula --zone us-central1-a
```

En la 3.6 lo mismo se hace con `terraform destroy`. Costos orientativos del
material: USD 0.5–1 por hora con el clúster de la 3.3 encendido y USD 3–6 por la
sesión de pruebas de carga de la 3.4.
