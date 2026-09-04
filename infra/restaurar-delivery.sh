#!/usr/bin/env bash
#
# Restaura UM cliente a partir do backup. Existe porque, na hora em que for
# preciso, ninguem vai lembrar a sequencia certa — e o momento de descobrir o
# comando nao pode ser o momento do desespero.
#
# Uso:  restaurar-delivery.sh tenant_unimaxx [pasta-do-backup]
#       restaurar-delivery.sh --listar
#       restaurar-delivery.sh --testar          (ensaio: restaura e confere)
#
set -uo pipefail
DESTINO=/opt/backup-delivery

listar() {
  echo "Backups disponiveis (mais recente primeiro):"
  ls -dt "$DESTINO"/*/ 2>/dev/null | head -14 | while read -r p; do
    echo "  $(basename "$p")  ($(du -sh "$p" | cut -f1), $(ls "$p"/*.sql.gz 2>/dev/null | wc -l) banco(s))"
  done
}

# ---------------------------------------------------------------------------
# ENSAIO DE RESTAURACAO.
#
# Backup que nunca foi restaurado e uma suposicao, nao uma garantia: o dump
# pode estar completo e mesmo assim nao subir (charset, versao do MySQL,
# permissao). Este modo restaura TODOS os bancos do backup mais recente em
# copias `_ensaio`, conta as tabelas, e apaga tudo no fim.
#
# Nao toca em nenhum banco de producao. Pode rodar com o app no ar.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--testar" ]; then
  PASTA="${2:-$(ls -dt "$DESTINO"/*/ 2>/dev/null | head -1)}"
  [ -d "$PASTA" ] || { echo "Sem backup em $DESTINO"; exit 1; }
  echo "=== Ensaio de restauracao a partir de $(basename "$PASTA") ==="
  FALHAS=0
  for ARQ in "$PASTA"/*.sql.gz; do
    [ -f "$ARQ" ] || continue
    BANCO=$(basename "$ARQ" .sql.gz)
    ENSAIO="${BANCO}_ensaio"
    mysql -e "DROP DATABASE IF EXISTS \`$ENSAIO\`; CREATE DATABASE \`$ENSAIO\` CHARACTER SET utf8mb4" 2>/dev/null
    if zcat "$ARQ" | mysql "$ENSAIO" 2>/tmp/ensaio-erro.txt; then
      TABELAS=$(mysql -N -B -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE table_schema='$ENSAIO'")
      ORIG=$(mysql -N -B -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE table_schema='$BANCO'" 2>/dev/null || echo '?')
      if [ "$TABELAS" -gt 0 ]; then
        echo "  ok    $BANCO: $TABELAS tabelas restauradas (producao tem $ORIG)"
      else
        echo "  FALHA $BANCO: subiu sem nenhuma tabela"
        FALHAS=$((FALHAS+1))
      fi
    else
      echo "  FALHA $BANCO: $(head -2 /tmp/ensaio-erro.txt | tr '\n' ' ')"
      FALHAS=$((FALHAS+1))
    fi
    mysql -e "DROP DATABASE IF EXISTS \`$ENSAIO\`" 2>/dev/null
  done

  # As pecas que NAO sao banco e sem as quais o restore nao serve de nada.
  for PECA in uploads.tar.gz certificados.tar.gz ambiente.tar.gz.enc ambiente.tar.gz; do
    if [ -f "$PASTA/$PECA" ]; then
      echo "  ok    $PECA presente ($(du -h "$PASTA/$PECA" | cut -f1))"
    else
      echo "  AUSENTE $PECA — restaurar sem isso deixa o sistema incompleto"
      FALHAS=$((FALHAS+1))
    fi
  done

  rm -f /tmp/ensaio-erro.txt
  echo "=== $FALHAS problema(s) ==="
  [ "$FALHAS" -eq 0 ] || exit 1
  exit 0
fi

if [ "${1:-}" = "--listar" ] || [ -z "${1:-}" ]; then
  listar
  echo
  echo "Uso: $0 <nome_do_banco> [pasta]   ex.: $0 tenant_unimaxx 2026-08-19_1228"
  echo "     $0 --testar                  ensaio, sem tocar em producao"
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

# CONFERE, e a conferencia importa: um dump que sobe sem tabela nenhuma nao da
# erro nenhum no mysql. Sem contar, "restaurado com sucesso" seria mentira.
TABELAS=$(mysql -N -B -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE table_schema='$NOVO'")
ORIG=$(mysql -N -B -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE table_schema='$BANCO'" 2>/dev/null || echo '?')
echo "→ $TABELAS tabelas em \`$NOVO\` (o banco atual tem $ORIG)"
[ "$TABELAS" -gt 0 ] || { echo "ATENCAO: nenhuma tabela restaurada — nao use este backup"; exit 1; }

for PECA in uploads certificados; do
  if [ -f "$PASTA/$PECA.tar.gz" ]; then
    echo "→ $PECA: tar -xzf $PASTA/$PECA.tar.gz -C /opt/delivery/dados/"
    echo "  (nao extraio automatico: isso sobrescreve os arquivos atuais)"
  fi
done

cat <<FIM

Pronto. O banco restaurado e \`$NOVO\`.
Para colocar no lugar do original, com o app PARADO:
  pm2 stop delivery
  mysql -e "DROP DATABASE \\\`$BANCO\\\`; CREATE DATABASE \\\`$BANCO\\\` CHARACTER SET utf8mb4"
  mysqldump $NOVO | mysql $BANCO
  pm2 start delivery

ANTES DE TUDO ISSO, confira que o APP_SECRET do .env e o MESMO de quando o
backup foi feito. Sem ele, os segredos cifrados no banco (token do Mercado
Pago, do Maxx Gestao, senha do certificado) voltam como lixo indecifravel — o
banco restaura e o sistema nao funciona.
FIM
