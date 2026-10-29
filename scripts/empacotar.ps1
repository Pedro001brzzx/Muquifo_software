<#
.SYNOPSIS
  Monta a pasta do Muquifo pronta para instalar: Muquifo.exe, servidor, telas,
  Node e PostgreSQL embutidos. O banco é criado na 1ª vez em dados\postgres.

.EXAMPLE
  pnpm run empacotar
  pwsh scripts/empacotar.ps1 -Saida D:\Muquifo -PostgresDir "C:\Program Files\PostgreSQL\18"

.NOTES
  Nunca apaga a pasta dados\ do destino (é onde fica o banco do restaurante).
#>
param(
  [string]$Saida = 'release\Muquifo',
  [string]$PostgresDir = 'C:\Program Files\PostgreSQL\18',
  [switch]$SemBuild,
  # Também gera o instalador (Inno Setup 6) em release\Muquifo-Instalador-<versão>.exe.
  [switch]$Instalador
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not [System.IO.Path]::IsPathRooted($Saida)) { $Saida = Join-Path $root $Saida }

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }

Step 'Conferindo ferramentas'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "Compilador C# do Windows não encontrado em $csc" }
foreach ($exe in 'postgres.exe', 'pg_ctl.exe', 'initdb.exe', 'createdb.exe') {
  if (-not (Test-Path (Join-Path $PostgresDir "bin\$exe"))) {
    throw "PostgreSQL não encontrado em $PostgresDir (falta bin\$exe). Use -PostgresDir."
  }
}
$node = (Get-Command node).Source
Write-Host "Node $(node -v) em $node"
Write-Host "PostgreSQL $((& (Join-Path $PostgresDir 'bin\postgres.exe') --version))"

if (-not $SemBuild) {
  Step 'Compilando o sistema'
  pnpm run build
  if ($LASTEXITCODE) { throw 'Falha no build.' }
}

Step "Limpando $Saida (a pasta dados\ é mantida)"
New-Item -ItemType Directory -Force $Saida | Out-Null
Get-ChildItem $Saida -Force | Where-Object Name -NotIn 'dados', 'logs' |
  Remove-Item -Recurse -Force

Step 'Servidor (um arquivo só, sem node_modules)'
$api = Join-Path $Saida 'app\api'
New-Item -ItemType Directory -Force $api | Out-Null
node (Join-Path $root 'scripts\bundle-api.mjs') (Join-Path $api 'main.mjs')
if ($LASTEXITCODE) { throw 'Falha ao juntar o servidor.' }
Copy-Item (Join-Path $root 'apps\api\drizzle') (Join-Path $api 'drizzle') -Recurse

Step 'Telas'
Copy-Item (Join-Path $root 'apps\web\dist') (Join-Path $Saida 'app\web') -Recurse

Step 'Node embutido'
$runtime = Join-Path $Saida 'runtime'
New-Item -ItemType Directory -Force (Join-Path $runtime 'node') | Out-Null
Copy-Item $node (Join-Path $runtime 'node\node.exe')

Step 'PostgreSQL embutido'
$pg = Join-Path $runtime 'pgsql'
# Só os programas que o Muquifo usa (ligar, backup, restaurar) ou que servem
# para manutenção e troca de versão do PostgreSQL. Todas as DLLs, menos as
# da interface do StackBuilder (wx).
$pgPrograms = 'postgres', 'pg_ctl', 'initdb', 'createdb', 'psql', 'pg_dump', 'pg_dumpall',
  'pg_restore', 'pg_upgrade', 'pg_isready', 'pg_controldata', 'pg_resetwal', 'pg_checksums',
  'vacuumdb', 'reindexdb' | ForEach-Object { "$_.exe" }
robocopy (Join-Path $PostgresDir 'bin') (Join-Path $pg 'bin') *.dll $pgPrograms /NFL /NDL /NJH /NJS /NP `
  /XF wx*.dll *.pdb | Out-Null
robocopy (Join-Path $PostgresDir 'lib') (Join-Path $pg 'lib') /E /NFL /NDL /NJH /NJS /NP /XF *.lib *.pdb | Out-Null
# Traduções: só português.
robocopy (Join-Path $PostgresDir 'share') (Join-Path $pg 'share') /E /NFL /NDL /NJH /NJS /NP /XD locale | Out-Null
$ptBr = Join-Path $PostgresDir 'share\locale\pt_BR'
if (Test-Path $ptBr) {
  robocopy $ptBr (Join-Path $pg 'share\locale\pt_BR') /E /NFL /NDL /NJH /NJS /NP | Out-Null
}
if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar o PostgreSQL (robocopy $LASTEXITCODE)." }

Step 'Licenças'
$lic = Join-Path $Saida 'licencas'
New-Item -ItemType Directory -Force $lic | Out-Null
# Avisos de licença das bibliotecas juntadas no servidor (gerado pelo esbuild).
$legal = Join-Path $api 'main.mjs.LEGAL.txt'
if (Test-Path $legal) { Move-Item $legal (Join-Path $lic 'Bibliotecas do servidor.txt') -Force }
Copy-Item (Join-Path $PostgresDir 'server_license.txt') (Join-Path $lic 'PostgreSQL.txt') -ErrorAction SilentlyContinue
$nodeLicense = Join-Path (Split-Path $node) 'LICENSE'
if (Test-Path $nodeLicense) { Copy-Item $nodeLicense (Join-Path $lic 'Node.js.txt') }
else {
  Set-Content (Join-Path $lic 'Node.js.txt') 'Node.js - licença MIT. https://github.com/nodejs/node/blob/main/LICENSE'
}

Step 'Muquifo.exe'
$icon = Join-Path $root 'tools\launcher\muquifo.ico'
$exeOut = Join-Path $Saida 'Muquifo.exe'
& $csc /nologo /target:winexe /optimize+ /codepage:65001 `
  "/win32icon:$icon" "/out:$exeOut" `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  (Join-Path $root 'tools\launcher\Muquifo.cs')
if ($LASTEXITCODE) { throw 'Falha ao compilar o Muquifo.exe.' }

Copy-Item (Join-Path $root 'tools\launcher\LEIA-ME.txt') (Join-Path $Saida 'LEIA-ME.txt')

$size = (Get-ChildItem $Saida -Recurse -File -Force |
  Where-Object { $_.FullName -notlike (Join-Path $Saida 'dados*') } |
  Measure-Object Length -Sum).Sum / 1MB
Step ("Pasta pronta: {0} ({1:N0} MB). Para testar: {2}" -f $Saida, $size, (Join-Path $Saida 'Muquifo.exe'))

if ($Instalador) {
  Step 'Instalador'
  # Algumas variáveis podem faltar no ambiente (ex.: rodando via pnpm): ignora as vazias.
  $iscc = @(
    @{ base = $env:LOCALAPPDATA; rel = 'Programs\Inno Setup 6\ISCC.exe' },
    @{ base = ${env:ProgramFiles(x86)}; rel = 'Inno Setup 6\ISCC.exe' },
    @{ base = $env:ProgramFiles; rel = 'Inno Setup 6\ISCC.exe' }
  ) | Where-Object { $_.base } | ForEach-Object { Join-Path $_.base $_.rel } |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $iscc) {
    $iscc = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source
  }
  if (-not $iscc) { throw 'Inno Setup 6 não encontrado. Instale com: winget install JRSoftware.InnoSetup' }
  $version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
  $outDir = Split-Path $Saida
  & $iscc /Q "/DAppVersion=$version" "/DSourceDir=$Saida" "/DOutputDir=$outDir" `
    (Join-Path $root 'tools\installer\muquifo.iss')
  if ($LASTEXITCODE) { throw 'Falha ao gerar o instalador.' }
  $setup = Join-Path $outDir "Muquifo-Instalador-$version.exe"
  Step ("Instalador: {0} ({1:N0} MB)" -f $setup, ((Get-Item $setup).Length / 1MB))
}
