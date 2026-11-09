# Crea UNA VEZ la llave que protege POST /score de la tabla de líderes.
# La genera al azar y la guarda cifrada en SSM Parameter Store (SecureString).
# No la muestra en pantalla ni la escribe en ningún archivo.
#   Uso:  .\infra-aws\crear-llave.ps1
$aws = 'C:\Program Files\Amazon\AWSCLIV2\aws.exe'
$nombre = '/nebula/score-api-key'
$region = 'us-east-2'

$existe = & $aws ssm describe-parameters --region $region `
  --parameter-filters "Key=Name,Values=$nombre" --query 'length(Parameters)' --output text
if ($existe -ne '0') { Write-Host "La llave $nombre ya existe; no se cambió."; return }

$bytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$valor = -join ($bytes | ForEach-Object { $_.ToString('x2') })

& $aws ssm put-parameter --region $region --name $nombre --type SecureString `
  --value $valor --tags Key=proyecto,Value=nebula-arena --output text | Out-Null
Remove-Variable valor, bytes
if ($LASTEXITCODE -eq 0) { Write-Host "Listo: llave $nombre creada (cifrada, no se muestra)." }
