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
# Como é: o frontend é construído numa CÓPIA (`public.novo`) e publicado no fim,
# de forma ADITIVA e ordenada — assets primeiro, index.html por último, num
# rename atômico (ver o bloco 4). Build que falha não encosta no que está no ar.
# E o que estava no ar fica guardado em `public.anterior`/`dist.anterior`, com o
# commit gravado em `.deploy-anterior` — é o que o `rollback.sh` usa para voltar
# em segundos, sem reconstruir nada.
#
# A publicação já foi um `mv` de pasta, e não era instantânea como parecia:
# entre os dois `mv` a pasta não existia e todo pedido levava 404 — que o
# navegador guardava. O bloco 4 conta a história inteira.
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

# ---------------------------------------------------------------------------
# 4. PUBLICAÇÃO SEM JANELA. Assets primeiro, index.html por último.
#
# A troca era `mv public public.trocando; mv public.novo public`. "Instantâneo"
# no papel, e não era: entre os dois `mv` a pasta `public` NÃO EXISTE, e todo
# pedido nessa fração de segundo leva 404. Isso deixava marca porque o 404 saía
# sem `Cache-Control` — o navegador guardava e passava a responder 404 sozinho,
# sem perguntar mais nada. Um único chunk envenenado (o `utils`, onde mora o
# código compartilhado) deixa o app inteiro sem subir: tela branca, e nada no
# servidor para acusar, porque o servidor está com o arquivo no lugar.
#
# Medido: `utils-DrWn0Qow.js` devolvia 404 do cache do navegador e 200 da rede,
# no mesmo instante, com o arquivo em disco. Aba nova não resolvia (cache é por
# origem), limpar service worker não resolvia (o 404 estava no cache HTTP).
# Quem sofreu foi o dono da plataforma: o "Entrar como lojista" parou de
# funcionar depois de cada deploy, e parecia bug da impersonação.
#
# E o `mv` tinha uma SEGUNDA janela, mais longa: a pasta nova não tem os hashes
# antigos, então quem estava com o app ABERTO perdia os chunks que ainda ia
# carregar. Essa dura até a pessoa recarregar.
#
# Agora a publicação é ADITIVA e ordenada:
#
#   1. os assets novos ENTRAM junto dos antigos (nada é removido);
#   2. o resto dos estáticos é copiado em cima;
#   3. o index.html vai por ÚLTIMO, com `mv -T` (rename atômico) — é ele que
#      aponta para os hashes novos, então ele só pode aparecer depois de eles
#      existirem.
#
# Em nenhum instante existe um index.html apontando para arquivo ausente, nem
# uma pasta `public` inexistente. E quem tem o app aberto continua achando os
# chunks da versão dele.
# ---------------------------------------------------------------------------
echo "→ Publicando os assets novos (aditivo, sem janela)"
mkdir -p public/app-assets
cp -a public.novo/app-assets/. public/app-assets/

echo "→ Publicando os demais estáticos"
for item in public.novo/*; do
  nome=$(basename "$item")
  # `app-assets` já foi; `index.html` é o último de todos, mais abaixo.
  [ "$nome" = "app-assets" ] && continue
  [ "$nome" = "index.html" ] && continue
  if [ -d "$item" ]; then
    mkdir -p "public/$nome"
    cp -a "$item/." "public/$nome/"
  else
    cp -a "$item" "public/$nome"
  fi
done

# O index.html por último e num rename: `cp` escreve o arquivo em pedaços, e um
# index.html lido pela metade é uma página quebrada. `mv -T` no mesmo sistema de
# arquivos troca o arquivo inteiro de uma vez.
echo "→ Trocando o index.html (rename atômico)"
cp -a public.novo/index.html public/.index.html.novo
mv -T public/.index.html.novo public/index.html
rm -rf public.novo

# Lixo de deploys ANTIGOS, não do anterior: quem tem o app aberto ainda pede os
# chunks da versão dele, e apagá-los agora recria o problema que este bloco
# existe para resolver. Sete dias é folga de sobra para toda aba abrir de novo.
echo "→ Limpando assets com mais de 7 dias"
find public/app-assets -type f -mtime +7 -delete 2>/dev/null || true

echo "→ Recarregando o processo (PM2, sem queda)"
# `reload` e nao `restart`: em modo cluster o PM2 troca UMA instancia por vez e,
# com wait_ready, so derruba a antiga depois que a nova avisa que terminou de
# aplicar o schema. `restart` derruba as tres de uma vez — que era a origem dos
# ~5s de 502 a cada deploy (e de 8s com 100 clientes).
# Se o app ainda nao estiver rodando, `reload` falha e o `start` assume.
pm2 reload ecosystem.config.js --update-env || pm2 start ecosystem.config.js
pm2 save

echo "✓ Deploy concluído. Para voltar: bash $APP_DIR/rollback.sh"
