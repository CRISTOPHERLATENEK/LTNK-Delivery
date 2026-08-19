#!/usr/bin/env bash
#
# Restaura UM cliente a partir do backup. Existe porque, na hora em que for
# preciso, ninguem vai lembrar a sequencia certa — e o momento de descobrir o
# comando nao pode ser o momento do desespero.
#
# Uso:  restaurar-delivery.sh tenant_unimaxx [pasta-do-backup]
#       restaurar-delivery.sh --listar
#
set -uo pipefail
DESTINO=/opt/backup-delivery

if [ "${1:-}" = "--listar" ] || [ -z "${1:-}" ]; then
  echo "Backups disponiveis (mais recente primeiro):"
  ls -dt "$DESTINO"/*/ 2>/dev/null | head -14 | while read -r p; do
    echo "  $(basename "$p")  ($(du -sh "$p" | cut -f1), $(ls "$p"/*.sql.gz 2>/dev/null | wc -l) banco(s))"
  done
  echo
  echo "Uso: $0 <nome_do_banco> [pasta]   ex.: $0 tenant_unimaxx 2026-08-19_1228"
  exit 0
fi

BANCO="$1"
PASTA="${2:-$(ls -dt "$DESTINO"/*/ | head -1)}"
[ -d "$PASTA" ] || PASTA="$DESTINO/$2"
ARQ="$PASTA/$BANCO.sql.gz"

[ -f "$ARQ" ] || { echo "Nao achei $ARQ"; exit 1; }

# RESTAURA NUM BANCO NOVO, com sufixo _restaurado. NUNCA por cima do original:
# se o dump estiver ruim, sobrescrever destroi a unica copia boa que restava.
NOVO="${BANCO}_restaurado"
echo "→ Restaurando $ARQ em \`$NOVO\` (o original NAO e tocado)"
mysql -e "DROP DATABASE IF EXISTS \`$NOVO\`; CREATE DATABASE \`$NOVO\` CHARACTER SET utf8mb4"
zcat "$ARQ" | mysql "$NOVO" || { echo "FALHOU ao restaurar"; exit 1; }

echo "→ Conferindo"
mysql -N -e "SELECT CONCAT( tabelas: , COUNT(*)) FROM information_schema.TABLES WHERE table_schema="

if [ -f "$PASTA/uploads.tar.gz" ]; then
  echo "→ Imagens: tar -xzf $PASTA/uploads.tar.gz -C /opt/delivery/dados/"
  echo "  (nao extraio automatico: isso sobrescreve as fotos atuais)"
fi

cat <<FIM

Pronto. O banco restaurado e \`$NOVO\`.
Para colocar no lugar do original, com o app PARADO:
  pm2 stop delivery
  mysql -e "DROP DATABASE \\`$BANCO\\`; CREATE DATABASE \\`$BANCO\\` CHARACTER SET utf8mb4"
  mysqldump $NOVO | mysql $BANCO
  pm2 start delivery
FIM
