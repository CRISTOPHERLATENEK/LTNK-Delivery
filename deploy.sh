#!/usr/bin/env bash
# Deploy do Delivery no VPS. Idempotente: pode rodar quantas vezes quiser.
# Usado pelo GitHub Action (.github/workflows/deploy.yml) e também dá pra
# rodar na mão no VPS com:  bash /opt/delivery/deploy.sh
#
# ---------------------------------------------------------------------------
# BUILD FORA DO AR, TROCA NO FIM. E DÁ PRA VOLTAR.
#
# Como era: `npm run build` encadeia um passo que APAGA public/app-assets, e
# só o build seguinte recriava. Ou seja, existia uma janela de ~20s em que o
# site servia index.html novo sem nenhum asset — e se o build morresse no meio
# (rede, memória, erro de tipo), ficava assim até alguém perceber. Não era
# "site meio quebrado": era site sem CSS nem JS, e sem caminho de volta a não
# ser reconstruir na pressa.
#
# Como é: o frontend é construído numa CÓPIA (`public.novo`), e a troca é um
# `mv` no fim. Build que falha não encosta no que está no ar. E o que estava
# no ar fica guardado em `public.anterior`/`dist.anterior`, com o commit
# gravado em `.deploy-anterior` — é o que o `rollback.sh` usa para voltar em
# segundos, sem reconstruir nada.
#
# A cópia custa 18 MB num disco com 182 GB livres.
# ---------------------------------------------------------------------------
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/delivery}"
BRANCH="${DEPLOY_BRANCH:-migracao-mysql}"

echo "→ Entrando em $APP_DIR"
cd "$APP_DIR"

# ---------------------------------------------------------------------------
# 1. Guarda o ponto de retorno ANTES de mexer em qualquer coisa.
#    O commit vai para arquivo porque depois do `git reset` o HEAD é outro — e
#    é justamente o anterior que o rollback precisa.
# ---------------------------------------------------------------------------
ANTES=$(git rev-parse HEAD)
echo "→ Ponto de retorno: $ANTES"
rm -rf public.anterior dist.anterior
cp -a public public.anterior
[ -d dist ] && cp -a dist dist.anterior
echo "$ANTES" > .deploy-anterior

echo "→ Baixando a branch $BRANCH"
git fetch origin "$BRANCH"
# Deploy target: alinha exatamente com o remoto (evita conflito de merge).
# Só mexe em arquivos versionados — .env, dados/ e build ficam intactos.
git reset --hard "origin/$BRANCH"

echo "→ Instalando dependências"
npm install

# ---------------------------------------------------------------------------
# 2. Backend em cima do dist mesmo. Pode: o processo no ar já carregou os
#    módulos dele na memória, então um dist pela metade só importaria no
#    próximo reload — e o reload é a última linha, depois de tudo dar certo.
# ---------------------------------------------------------------------------
echo "→ Build do backend"
npx tsc -p tsconfig.backend.json

# ---------------------------------------------------------------------------
# 3. Frontend numa cópia. `set -e` garante que um build que falhe pare aqui,
#    com o que está no ar intocado.
# ---------------------------------------------------------------------------
echo "→ Build do frontend (em public.novo)"
rm -rf public.novo
cp -a public public.novo
# Limpa os hashes antigos DA CÓPIA. Sem isso, cada deploy deixa lixo
# acumulado; fazendo no original, é a janela que este script existe pra evitar.
rm -rf public.novo/app-assets
( cd frontend && npx vite build --outDir ../public.novo )

# Confere que o build produziu o essencial antes de trocar. Build que
# "termina" sem index.html ou sem asset nenhum existe — e trocar assim seria
# publicar o problema em vez de segurá-lo aqui.
[ -s public.novo/index.html ] || { echo "✗ build sem index.html — nada foi trocado"; exit 1; }
[ -d public.novo/app-assets ] && [ -n "$(ls -A public.novo/app-assets)" ] || {
  echo "✗ build sem app-assets — nada foi trocado"; exit 1; }

echo "→ Trocando public (dois mv, instantâneo)"
mv public public.trocando
mv public.novo public
rm -rf public.trocando

echo "→ Recarregando o processo (PM2, sem queda)"
# `reload` e nao `restart`: em modo cluster o PM2 troca UMA instancia por vez e,
# com wait_ready, so derruba a antiga depois que a nova avisa que terminou de
# aplicar o schema. `restart` derruba as tres de uma vez — que era a origem dos
# ~5s de 502 a cada deploy (e de 8s com 100 clientes).
# Se o app ainda nao estiver rodando, `reload` falha e o `start` assume.
pm2 reload ecosystem.config.js --update-env || pm2 start ecosystem.config.js
pm2 save

echo "✓ Deploy concluído. Para voltar: bash $APP_DIR/rollback.sh"
