#!/usr/bin/env bash
# Deploy do Delivery no VPS. Idempotente: pode rodar quantas vezes quiser.
# Usado pelo GitHub Action (.github/workflows/deploy.yml) e também dá pra
# rodar na mão no VPS com:  bash /opt/delivery/deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/delivery}"
BRANCH="${DEPLOY_BRANCH:-migracao-mysql}"

echo "→ Entrando em $APP_DIR"
cd "$APP_DIR"

echo "→ Baixando a branch $BRANCH"
git fetch origin "$BRANCH"
# Deploy target: alinha exatamente com o remoto (evita conflito de merge).
# Só mexe em arquivos versionados — .env, dados/ e build ficam intactos.
git reset --hard "origin/$BRANCH"

echo "→ Instalando dependências"
npm install

echo "→ Build (backend + frontend)"
npm run build

echo "→ Recarregando o processo (PM2, sem queda)"
# `reload` e nao `restart`: em modo cluster o PM2 troca UMA instancia por vez e,
# com wait_ready, so derruba a antiga depois que a nova avisa que terminou de
# aplicar o schema. `restart` derruba as tres de uma vez — que era a origem dos
# ~5s de 502 a cada deploy (e de 8s com 100 clientes).
# Se o app ainda nao estiver rodando, `reload` falha e o `start` assume.
pm2 reload ecosystem.config.js --update-env || pm2 start ecosystem.config.js
pm2 save

echo "✓ Deploy concluído."
