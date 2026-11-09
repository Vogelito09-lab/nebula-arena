# Prueba la tabla de líderes ya desplegada (práctica 3.5), igual que los curl del material.
# Lee la llave de SSM para usarla en la cabecera X-Api-Key, sin mostrarla.
#   Uso:  .\infra-aws\probar-tabla.ps1
$aws = 'C:\Program Files\Amazon\AWSCLIV2\aws.exe'
Push-Location $PSScriptRoot
$url = (terraform output -raw url_tabla_lideres).TrimEnd('/')
Pop-Location
$llave = & $aws ssm get-parameter --region us-east-2 --name /nebula/score-api-key `
  --with-decryption --query Parameter.Value --output text

function Codigo($bloque) {
  try { (& $bloque).StatusCode } catch { $_.Exception.Response.StatusCode.value__ }
}

Write-Host "URL: $url`n"
$partidas = @(
  @{ jugador = 'ana';    puntos = 1250; resultado = 'victoria' },
  @{ jugador = 'beto';   puntos = 900;  resultado = 'derrota' },
  @{ jugador = 'ana';    puntos = 300;  resultado = 'derrota' },
  @{ jugador = 'carlos'; puntos = 1800; resultado = 'victoria' }
)
foreach ($p in $partidas) {
  $cuerpo = $p | ConvertTo-Json -Compress
  $c = Codigo { Invoke-WebRequest "$url/score" -Method Post -ContentType 'application/json' `
        -Headers @{ 'X-Api-Key' = $llave } -Body $cuerpo -UseBasicParsing }
  Write-Host "POST /score $cuerpo -> $c"
}
$c = Codigo { Invoke-WebRequest "$url/score" -Method Post -ContentType 'application/json' `
      -Body '{"jugador":"intruso","puntos":99999}' -UseBasicParsing }
Write-Host "POST /score SIN llave (debe ser 401) -> $c"
$c = Codigo { Invoke-WebRequest "$url/score" -Method Post -ContentType 'application/json' `
      -Headers @{ 'X-Api-Key' = $llave } -Body '{"jugador":"ana","puntos":-5}' -UseBasicParsing }
Write-Host "POST /score con puntos negativos (debe ser 400) -> $c"
Remove-Variable llave

Write-Host "`nGET /top:"
(Invoke-WebRequest "$url/top" -UseBasicParsing).Content | ConvertFrom-Json | Format-Table
Write-Host "GET /jugador/ana:"
(Invoke-WebRequest "$url/jugador/ana" -UseBasicParsing).Content
