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

echo "→ Reiniciando o processo (PM2)"
pm2 restart all
pm2 save

echo "✓ Deploy concluído."
