# Primer despliegue del juego en EKS (después de "terraform apply").
# Después de esto, el pipeline de GitHub (3.2) solo actualiza las imágenes.
#   Uso:  .\infra-aws\desplegar-juego.ps1 -Etiqueta <tag-de-la-imagen>
param([Parameter(Mandatory)] [string] $Etiqueta)
$ErrorActionPreference = 'Stop'
$aws = 'C:\Program Files\Amazon\AWSCLIV2\aws.exe'
$raiz = Split-Path $PSScriptRoot

Push-Location $PSScriptRoot
$registro = terraform output -raw registro
$urlTabla = (terraform output -raw url_tabla_lideres).TrimEnd('/')
Pop-Location

& $aws eks update-kubeconfig --name nebula --region us-east-2 | Out-Null

function Aplicar($archivo, $reemplazos) {
  $texto = [IO.File]::ReadAllText((Join-Path $raiz $archivo))
  foreach ($k in $reemplazos.Keys) { $texto = $texto.Replace($k, $reemplazos[$k]) }
  $tmp = New-TemporaryFile
  [IO.File]::WriteAllText($tmp, $texto, (New-Object Text.UTF8Encoding $false))
  kubectl apply -f $tmp
  Remove-Item $tmp
}

kubectl apply -f (Join-Path $raiz 'k8s/aws/rbac-github.yaml')
Aplicar 'k8s/aws/fleet.yaml' @{
  '<REGISTRO>/nebula-server:1.2' = "$registro/nebula-server:$Etiqueta"
  '<URL_TABLA_LIDERES>'          = $urlTabla
}
Aplicar 'k8s/aws/matchmaker.yaml' @{ '<REGISTRO>/matchmaker:1.0' = "$registro/matchmaker:$Etiqueta" }
kubectl apply -f (Join-Path $raiz 'k8s/autoscaler.yaml')
kubectl apply -f (Join-Path $raiz 'k8s/podmonitor.yaml')

kubectl get fleet,gameservers
kubectl get svc matchmaker
