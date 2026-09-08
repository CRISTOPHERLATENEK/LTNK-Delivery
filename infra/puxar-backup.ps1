<#
  PUXA O BACKUP DO SERVIDOR PARA ESTA MAQUINA.

  Por que existe: o backup do VPS mora no mesmo disco da aplicacao. Isso
  protege contra "apaguei sem querer" e contra banco corrompido, mas nao
  protege contra perder o servidor -- disco perdido, backup perdido junto.
  Esta copia e a unica que sobrevive ao VPS morrer.

  Por que NAO usa rclone: rclone pede login na conta de nuvem. Este script usa
  a chave SSH que a maquina ja tem para falar com o servidor. Nenhuma
  credencial nova, nenhuma conta nova.

  Isto NAO substitui uma copia em armazenamento de objetos (R2, S3, Backblaze).
  E um paliativo, e por dois motivos concretos:
    - depende desta maquina estar ligada na hora agendada;
    - um disco local morre, e morre sem avisar.
  Quando houver um remoto de nuvem configurado (rclone com destino chamado
  "backup"), o proprio backup-delivery.sh envia sozinho e este script passa a
  ser a segunda linha, nao a primeira.

  SO A PASTA MAIS NOVA, e poucas geracoes: o disco desta maquina esta com 95%
  de uso. Copiar as 14 geracoes do servidor encheria o que sobra.
#>

param(
  # Onde guardar. Fora de OneDrive/Documentos de proposito: pasta sincronizada
  # multiplica o tamanho na nuvem e pode subir segredo cifrado sem voce pedir.
  [string]$Destino = 'C:\backup-delivery',

  # Quantas geracoes manter aqui. 3 dias cobre "descobri o problema no dia
  # seguinte" sem passar de ~100 MB.
  [int]$Geracoes = 3,

  [string]$Servidor = 'vps-delivery',
  [string]$PastaRemota = '/opt/backup-delivery'
)

# SEM `ErrorActionPreference = 'Stop'`: no PowerShell 5.1, tudo que um .exe
# escreve no stderr vira como ErrorRecord, e o `ssh` escreve um aviso de
# algoritmo em TODA conexao. Com 'Stop', esse aviso abortava o script e a
# leitura da pasta remota voltava vazia. O tratamento aqui e explicito, olhando
# codigo de saida e conteudo.
$ssh = "$env:WINDIR\System32\OpenSSH\ssh.exe"
$scp = "$env:WINDIR\System32\OpenSSH\scp.exe"
$log = Join-Path $Destino 'puxar-backup.log'

function Registrar($texto) {
  $linha = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto
  Write-Output $linha
  if (Test-Path $Destino) { Add-Content -Path $log -Value $linha -Encoding utf8 }
}

if (-not (Test-Path $Destino)) { New-Item -ItemType Directory -Path $Destino | Out-Null }
Registrar '=== inicio ==='

# Espaco antes de comecar: encher o disco do sistema quebra mais que o backup.
$livreGB = [math]::Round((Get-PSDrive -Name ($Destino[0])).Free / 1GB, 1)
if ($livreGB -lt 1) {
  Registrar "ERRO: so $livreGB GB livres no disco. Nao vou copiar -- encher o disco do sistema e pior que ficar sem esta copia."
  exit 1
}

# Qual e a pasta mais nova la. Ordem alfabetica JA e ordem cronologica, porque
# o nome e AAAA-MM-DD_HHMM.
#
# O filtro pelo PADRAO do nome nao e paranoia: sem ele, qualquer linha que o
# servidor cuspisse (um aviso, um "Permission denied") viraria nome de pasta, e
# o script sairia copiando o que nao devia -- ou renomeando com valor nulo, que
# foi como isto falhou na primeira vez.
$saida = @(& $ssh $Servidor "ls -1 $PastaRemota 2>/dev/null")
$ultima = $saida |
  Where-Object { $_ -match '^\d{4}-\d{2}-\d{2}_\d{4}\s*$' } |
  ForEach-Object { $_.Trim() } |
  Select-Object -Last 1

if ($LASTEXITCODE -ne 0 -or -not $ultima) {
  Registrar "ERRO: o servidor nao respondeu com pasta nenhuma (ssh saiu $LASTEXITCODE)."
  exit 1
}

$alvo = Join-Path $Destino $ultima
if (Test-Path $alvo) {
  Registrar "nada novo -- $ultima ja esta aqui."
} else {
  Registrar "copiando $ultima ..."
  # Pasta temporaria: se a copia cair no meio, nao fica uma geracao pela
  # metade com nome de geracao boa -- que e o backup que engana na hora do
  # aperto.
  $temp = "$alvo.parcial"
  if (Test-Path $temp) { Remove-Item -Recurse -Force $temp }
  & $scp -r -q "${Servidor}:$PastaRemota/$ultima" $temp
  if ($LASTEXITCODE -ne 0) {
    Registrar "ERRO: scp falhou (codigo $LASTEXITCODE). A copia parcial fica em $temp para inspecao."
    exit 1
  }
  Rename-Item $temp $ultima
  $mb = [math]::Round((Get-ChildItem -Recurse $alvo | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
  $qtd = (Get-ChildItem -Recurse -File $alvo).Count
  Registrar "ok $ultima ($mb MB, $qtd arquivos)"
}

# Poda: mantem as N mais novas. Roda DEPOIS de copiar, nunca antes -- apagar
# antes de ter a nova em maos e ficar sem as duas se a rede cair.
$antigas = Get-ChildItem -Directory $Destino |
  Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{4}$' } |
  Sort-Object Name -Descending | Select-Object -Skip $Geracoes
foreach ($p in $antigas) {
  Remove-Item -Recurse -Force $p.FullName
  Registrar "podada $($p.Name)"
}

$total = [math]::Round((Get-ChildItem -Recurse -File $Destino | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
Registrar "=== fim: $total MB em $Destino, $livreGB GB livres no disco ==="
