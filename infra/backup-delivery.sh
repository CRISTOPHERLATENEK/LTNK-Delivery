#!/bin/bash
#
# Backup dos bancos do Delivery. Roda por cron, diario.
#
# DECISOES:
#  - Um arquivo POR BANCO, nao um dump unico: permite restaurar UMA loja/tenant
#    sem tocar nas outras. Num dump unico, restaurar um tenant obriga a derrubar
#    todos.
#  - `--single-transaction`: sem isso o mysqldump TRAVA as tabelas e a loja sai
#    do ar durante o backup. Com InnoDB, da um dump consistente sem lock.
#  - Fora de /opt/delivery de proposito: backup dentro da pasta do app morre
#    junto num `rm -rf` da pasta, que e exatamente um dos acidentes de que ele
#    deveria proteger.
#  - Sem senha no script: o root do MySQL usa auth_socket nesta maquina. Nao ha
#    credencial em texto pra vazar junto se o arquivo for lido.
#
set -uo pipefail

DESTINO=/opt/backup-delivery
RETENCAO_DIAS=14
LOG=/var/log/backup-delivery.log
DATA=$(date +%Y-%m-%d_%H%M)
PASTA="$DESTINO/$DATA"

registrar() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

mkdir -p "$PASTA"
# 600/700: o dump tem dado de cliente, endereco e nota fiscal. Nao pode ficar
# legivel pra outro usuario da maquina.
chmod 700 "$DESTINO" "$PASTA"

registrar "=== inicio ==="
FALHAS=0
TOTAL=0

BANCOS=$(mysql -N -B -e "SHOW DATABASES;" \
  | grep -vE '^(information_schema|performance_schema|mysql|sys)$')

for BANCO in $BANCOS; do
  ARQ="$PASTA/$BANCO.sql.gz"
  if mysqldump --single-transaction --quick --routines --triggers --events \
       --default-character-set=utf8mb4 "$BANCO" 2>>"$LOG" | gzip -9 > "$ARQ"; then
    # `Dump completed` no fim do arquivo e a prova de que o dump nao foi cortado
    # no meio (disco cheio, conexao caindo). Sem checar isso, um backup truncado
    # parece bom ate o dia em que precisa ser usado.
    if zcat "$ARQ" 2>/dev/null | tail -5 | grep -q "Dump completed"; then
      registrar "ok    $BANCO ($(du -h "$ARQ" | cut -f1))"
      TOTAL=$((TOTAL+1))
    else
      registrar "FALHA $BANCO: dump truncado (sem marca 'Dump completed')"
      FALHAS=$((FALHAS+1))
    fi
  else
    registrar "FALHA $BANCO: mysqldump retornou erro"
    FALHAS=$((FALHAS+1))
  fi
  chmod 600 "$ARQ" 2>/dev/null
done

# ---------------------------------------------------------------------------
# UPLOADS (fotos de produto, logo, banner).
#
# O backup salvava SO banco. Restaurar assim devolve todo produto apontando pra
# uma foto que nao existe mais, e o lojista teria que refotografar o cardapio
# inteiro. Sao ~25 MB por instalacao — barato demais pra ficar de fora.
#
# `tar -C` pra guardar caminho relativo: assim o restore nao depende de a pasta
# do app estar exatamente no mesmo lugar.
# ---------------------------------------------------------------------------
UPLOADS=/opt/delivery/dados/uploads
if [ -d "$UPLOADS" ]; then
  ARQ_UP="$PASTA/uploads.tar.gz"
  if tar -C "$(dirname "$UPLOADS")" -czf "$ARQ_UP" "$(basename "$UPLOADS")" 2>>"$LOG"; then
    # `tar -tzf` le o indice inteiro: se o arquivo foi cortado no meio (disco
    # cheio), isso falha aqui e nao no dia do restore.
    if tar -tzf "$ARQ_UP" >/dev/null 2>>"$LOG"; then
      registrar "ok    uploads ($(du -h "$ARQ_UP" | cut -f1), $(tar -tzf "$ARQ_UP" | wc -l) arquivos)"
      TOTAL=$((TOTAL+1))
    else
      registrar "FALHA uploads: arquivo tar corrompido"
      FALHAS=$((FALHAS+1))
    fi
  else
    registrar "FALHA uploads: tar retornou erro"
    FALHAS=$((FALHAS+1))
  fi
  chmod 600 "$ARQ_UP" 2>/dev/null
else
  registrar "aviso uploads: pasta $UPLOADS nao existe (nada a salvar)"
fi

# Retencao: apaga pasta de backup mais velha que N dias. Roda DEPOIS do dump do
# dia, pra nunca ficar sem nenhuma copia caso o dump de hoje falhe.
find "$DESTINO" -mindepth 1 -maxdepth 1 -type d -mtime +$RETENCAO_DIAS \
  -exec rm -rf {} + 2>>"$LOG"

# ---------------------------------------------------------------------------
# COPIA FORA DA MAQUINA.
#
# O backup local sobrevive a um `rm -rf` da pasta do app, mas nao a VPS apagada,
# disco corrompido, conta suspensa ou ransomware com root — que sao justamente
# os casos em que ele seria a unica saida.
#
# Roda por rclone, que fala com R2/S3/Backblaze/Drive. Se o destino chamado
# `backup` nao estiver configurado, ESTA ETAPA E PULADA e o backup local
# continua valendo: falta de nuvem nao pode transformar backup bom em falha.
#
# Pra configurar (uma vez, com as SUAS credenciais):  rclone config
# ---------------------------------------------------------------------------
if command -v rclone >/dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -q ^backup:; then
  if rclone sync "$DESTINO" backup:delivery-backup --transfers 4 --checksum >>"$LOG" 2>&1; then
    registrar "ok    copia externa enviada ($(rclone size backup:delivery-backup --json 2>/dev/null | head -c 120))"
  else
    # NAO conta como falha do backup: o local esta feito. Mas fica no log, que e
    # o unico jeito de alguem notar que a nuvem parou de receber.
    registrar "AVISO copia externa falhou — o backup LOCAL foi concluido"
  fi
else
  registrar "aviso copia externa nao configurada (rclone sem destino backup)"
fi

registrar "=== fim: $TOTAL banco(s) ok, $FALHAS falha(s) — total $(du -sh "$PASTA" | cut -f1) ==="
[ "$FALHAS" -eq 0 ] || exit 1
