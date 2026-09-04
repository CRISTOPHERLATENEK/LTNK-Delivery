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

# ---------------------------------------------------------------------------
# CERTIFICADOS (.pfx do A1 fiscal e os da ONZ/Pix).
#
# Ficavam DE FORA: o backup salvava so `dados/uploads`, e os certificados estao
# em `dados/certificados`. Perder o A1 e parar de emitir nota ate comprar outro,
# e o certificado nao se recupera de lugar nenhum — nao esta em banco, nao esta
# no git, so existe neste disco.
#
# Sao poucos KB. Ficar de fora nunca foi economia, foi esquecimento.
# ---------------------------------------------------------------------------
CERTS=/opt/delivery/dados/certificados
if [ -d "$CERTS" ]; then
  ARQ_CERT="$PASTA/certificados.tar.gz"
  if tar -C "$(dirname "$CERTS")" -czf "$ARQ_CERT" "$(basename "$CERTS")" 2>>"$LOG"      && tar -tzf "$ARQ_CERT" >/dev/null 2>>"$LOG"; then
    registrar "ok    certificados ($(du -h "$ARQ_CERT" | cut -f1), $(tar -tzf "$ARQ_CERT" | grep -c '\.pfx$\|\.p12$') certificado(s))"
    TOTAL=$((TOTAL+1))
  else
    registrar "FALHA certificados: tar retornou erro ou arquivo corrompido"
    FALHAS=$((FALHAS+1))
  fi
  chmod 600 "$ARQ_CERT" 2>/dev/null
else
  registrar "aviso certificados: pasta $CERTS nao existe (nada a salvar)"
fi

# ---------------------------------------------------------------------------
# O .env — A PECA SEM A QUAL O RESTORE NAO SERVE.
#
# `APP_SECRET` e a chave que cifra os segredos EM REPOUSO no banco: token do
# Mercado Pago, token do Maxx Gestao, senha do certificado. Restaurar o banco
# sem essa chave devolve tudo isso como lixo indecifravel — o restore "funciona"
# e o sistema nao. Junto vao JWT_SECRET, credenciais da ONZ, SMTP e VAPID.
#
# CIFRADO, e nao em texto. Um .env em claro dentro do backup transforma
# qualquer copia do backup na chave do reino: quem pegar o arquivo tem o token
# de pagamento de todos os clientes. A senha vem de /root/.backup-senha (600),
# que fica FORA do backup de proposito — guardar a senha junto do que ela
# protege e o mesmo que nao ter senha.
#
# Sem a senha configurada, ESTA ETAPA E PULADA com aviso alto: e melhor um
# backup sem .env, e o operador sabendo, do que segredo em claro espalhado.
# ---------------------------------------------------------------------------
SENHA_ARQ=/root/.backup-senha
if [ -f /opt/delivery/.env ]; then
  if [ -s "$SENHA_ARQ" ] && command -v openssl >/dev/null 2>&1; then
    ARQ_ENV="$PASTA/ambiente.tar.gz.enc"
    if tar -C /opt/delivery -czf - .env 2>>"$LOG"        | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt            -pass "file:$SENHA_ARQ" -out "$ARQ_ENV" 2>>"$LOG"; then
      # Prova de que da pra ABRIR: backup cifrado que nao decifra e pior que
      # backup nenhum, porque parece que existe.
      if openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000            -pass "file:$SENHA_ARQ" -in "$ARQ_ENV" 2>>"$LOG" | tar -tzf - >/dev/null 2>>"$LOG"; then
        registrar "ok    ambiente (.env cifrado, $(du -h "$ARQ_ENV" | cut -f1))"
        TOTAL=$((TOTAL+1))
      else
        registrar "FALHA ambiente: o arquivo cifrado nao abriu na conferencia"
        FALHAS=$((FALHAS+1))
      fi
    else
      registrar "FALHA ambiente: erro ao cifrar o .env"
      FALHAS=$((FALHAS+1))
    fi
    chmod 600 "$ARQ_ENV" 2>/dev/null
  else
    registrar "AVISO ambiente: sem $SENHA_ARQ — .env NAO salvo. Sem ele, restaurar o banco devolve os segredos como lixo. Crie a senha: openssl rand -base64 48 > $SENHA_ARQ && chmod 600 $SENHA_ARQ"
  fi
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
