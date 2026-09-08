#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# VOLTA O DEPLOY ANTERIOR, SEM RECONSTRUIR NADA.
#
# Existe porque o caminho de volta não pode depender de um build: se o deploy
# quebrou o site, reconstruir na pressa é justamente o que não se quer fazer
# — leva minutos, pode falhar de novo pelo mesmo motivo, e o site fica fora
# nesse tempo todo. Aqui é troca de diretório e reload: segundos.
#
# O `deploy.sh` guarda três coisas antes de mexer em qualquer coisa:
#   public.anterior     o que estava sendo servido
#   dist.anterior       o backend compilado que estava rodando
#   .deploy-anterior    o commit de onde tudo aquilo saiu
#
# Uso:  bash /opt/delivery/rollback.sh
#       bash /opt/delivery/rollback.sh --ver    (só mostra o que voltaria)
# ---------------------------------------------------------------------------
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/delivery}"
cd "$APP_DIR"

if [ ! -f .deploy-anterior ] || [ ! -d public.anterior ]; then
  echo "✗ Não há ponto de retorno guardado."
  echo "  Isso acontece se o último deploy foi feito antes desta versão do"
  echo "  deploy.sh, ou se um rollback já foi usado. Caminho manual:"
  echo "    git log --oneline -5          # escolha o commit bom"
  echo "    git reset --hard <commit> && bash deploy.sh"
  exit 1
fi

ALVO=$(cat .deploy-anterior)
ATUAL=$(git rev-parse HEAD)

echo "Atual:    $ATUAL  $(git log -1 --format=%s "$ATUAL" 2>/dev/null || true)"
echo "Voltaria: $ALVO  $(git log -1 --format=%s "$ALVO" 2>/dev/null || true)"

if [ "${1:-}" = "--ver" ]; then
  echo "(--ver: nada foi alterado)"
  exit 0
fi

if [ "$ALVO" = "$ATUAL" ]; then
  echo "✓ Já está no commit guardado — nada a fazer."
  exit 0
fi

# O que está no ar AGORA vira o "anterior" do rollback: se voltar foi a
# decisão errada, dá para vir de novo para cá sem reconstruir.
echo "→ Guardando o estado atual em public.ruim/dist.ruim"
rm -rf public.ruim dist.ruim
cp -a public public.ruim
[ -d dist ] && cp -a dist dist.ruim

echo "→ Voltando o código para $ALVO"
git reset --hard "$ALVO"

echo "→ Restaurando os arquivos servidos e o backend compilado"
rm -rf public.trocando
mv public public.trocando
cp -a public.anterior public
rm -rf public.trocando
if [ -d dist.anterior ]; then
  rm -rf dist.trocando
  mv dist dist.trocando
  cp -a dist.anterior dist
  rm -rf dist.trocando
fi

echo "→ Recarregando o processo"
pm2 reload ecosystem.config.js --update-env || pm2 start ecosystem.config.js
pm2 save

echo "✓ Rollback concluído — rodando $ALVO."
echo "  O estado que foi retirado ficou em public.ruim/dist.ruim, para inspeção."
echo "  ATENÇÃO: rollback NÃO desfaz migração de banco. Coluna ou tabela criada"
echo "  pelo deploy ruim continua lá — o schema é aditivo de propósito, então"
echo "  código antigo convive com coluna nova; o contrário é que não vale."
