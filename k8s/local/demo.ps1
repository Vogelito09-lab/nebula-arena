# Demo en vivo del autoescalado en la laptop (clúster kind "nebula", sin nube, sin costo).
#
#   .\k8s\local\demo.ps1 -Encender   # 5-10 min antes: enciende el clúster y abre Grafana
#   .\k8s\local\demo.ps1 -Carga      # en la demo: 40 jugadores simulados durante 3 min
#   .\k8s\local\demo.ps1 -Estado     # kubectl get de flota, servidores y HPA
#   .\k8s\local\demo.ps1 -Apagar     # al terminar: cierra Grafana y apaga el clúster
#
# Docker Desktop solo tiene ~4 GB: antes de encender, detén otros proyectos de Docker
# (por ejemplo, en la carpeta live-zone: docker compose stop).
param([switch]$Encender, [switch]$Carga, [switch]$Estado, [switch]$Apagar)

$ErrorActionPreference = "Continue"   # mientras arranca, kubectl avisa errores pasajeros
$raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$grafana = "http://localhost:3000/d/nebula-arena?orgId=1&from=now-15m&to=now&refresh=5s&kiosk"

function Esperar($texto, [scriptblock]$listo) {
    Write-Host "Esperando: $texto..." -NoNewline
    while (-not (& $listo)) { Start-Sleep -Seconds 5; Write-Host "." -NoNewline }
    Write-Host " listo"
}

if ($Encender) {
    docker start nebula-control-plane | Out-Null
    kind export kubeconfig --name nebula | Out-Null      # kubectl apunta a la laptop, no a AWS
    Esperar "Kubernetes" { cmd /c "kubectl get fleet nebula-fleet >nul 2>&1"; $LASTEXITCODE -eq 0 }
    kubectl apply -f "$raiz\k8s\local\autoscaler-demo.yaml" | Out-Null
    Esperar "5 servidores libres en la flota" { [int](cmd /c "kubectl get fleet nebula-fleet -o jsonpath={.status.readyReplicas} 2>nul") -ge 5 }
    Esperar "Grafana" { (cmd /c "kubectl -n monitoring get deploy monitoreo-grafana -o jsonpath={.status.readyReplicas} 2>nul") -eq "1" }
    Start-Process kubectl -ArgumentList "-n monitoring port-forward svc/monitoreo-grafana 3000:80" -WindowStyle Hidden
    Start-Sleep -Seconds 3
    Start-Process $grafana
    Write-Host "Grafana abierto (no pide contraseña). Siguiente paso: .\k8s\local\demo.ps1 -Carga"
}

if ($Carga) {
    Write-Host "40 jugadores simulados, 1 nuevo por segundo, 3 minutos. Mira Grafana mientras sube."
    docker run --rm --name nebula-demo-locust --network kind `
        -e MATCHMAKER_URL=http://nebula-control-plane:30080 `
        nebula-locust:1.0 Jugador -u 40 -r 1 -t 3m --headless --only-summary
}

if ($Estado -or $Carga) {
    kubectl get fleet nebula-fleet
    kubectl get gameservers
    kubectl get hpa matchmaker-hpa
}

if ($Apagar) {
    Get-Process kubectl -ErrorAction SilentlyContinue | Stop-Process -Force
    docker stop nebula-control-plane | Out-Null
    Write-Host "Clúster apagado. Puedes volver a encender tus otros proyectos de Docker."
}
