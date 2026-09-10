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

# ---------------------------------------------------------------------------
# 1b. VIGIA DOS ASSETS.
#
# A publicação abaixo é aditiva de propósito: os arquivos com hash da versão
# anterior precisam continuar existindo, porque quem está com o app ABERTO ainda
# vai pedir os pedaços da versão dele. Isso está escrito no bloco 4 e foi
# testado em sandbox — o `cp` é aditivo mesmo.
#
# E MESMO ASSIM NÃO ESTÁ ACONTECENDO. Medido em 09/09/2026: dos 54 arquivos que
# existiam antes de um deploy, 44 sumiram depois dele, e a limpeza de 7 dias não
# pegaria nenhum (o `find` devolveu zero). Nem o build do Vite, nem o `tsc`, nem
# o `npm install` reproduzem isso fora daqui.
#
# O custo desse buraco não é teórico: no mesmo dia, 37 pedidos de asset levaram
# 404 em 20 segundos durante um deploy — entre eles o index .js e o index .css —
# e quem estava com o painel aberto ficou na tela branca.
#
# Então este vigia faz duas coisas: MARCA em qual passo os arquivos somem, e no
# fim RESTAURA o que sumiu. A promessa do bloco 4 passa a valer mesmo sem eu
# saber ainda quem apaga.
# ---------------------------------------------------------------------------
VIGIA_LOG="$APP_DIR/dados/deploy-assets.log"
mkdir -p "$(dirname "$VIGIA_LOG")"
vigia() {
  local passo="$1"
  local n=0
  [ -d public/app-assets ] && n=$(ls -1 public/app-assets 2>/dev/null | wc -l)
  echo "$(date -Is) $(printf '%-28s' "$passo") arquivos=$n" >> "$VIGIA_LOG"
  echo "   [vigia] $passo: $n assets"
}
vigia "00 inicio"
rm -rf public.anterior dist.anterior
cp -a public public.anterior
[ -d dist ] && cp -a dist dist.anterior
echo "$ANTES" > .deploy-anterior

echo "→ Baixando a branch $BRANCH"
git fetch origin "$BRANCH"
# Deploy target: alinha exatamente com o remoto (evita conflito de merge).
# Só mexe em arquivos versionados — .env, dados/ e build ficam intactos.
git reset --hard "origin/$BRANCH"
vigia "10 git reset"


echo "→ Instalando dependências"
npm install
vigia "20 npm install"

# ---------------------------------------------------------------------------
# 2. Backend em cima do dist mesmo. Pode: o processo no ar já carregou os
#    módulos dele na memória, então um dist pela metade só importaria no
#    próximo reload — e o reload é a última linha, depois de tudo dar certo.
# ---------------------------------------------------------------------------
echo "→ Build do backend"
npx tsc -p tsconfig.backend.json
vigia "30 tsc backend"

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
vigia "40 rm public.novo/app-assets"
( cd frontend && npx vite build --outDir ../public.novo )
vigia "50 vite build"

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
# ---------------------------------------------------------------------------
# 4b. RESTAURA O QUE SUMIU NO CAMINHO.
#
# A publicação acima é aditiva, e um teste em sandbox confirma que o `cp` não
# apaga nada. Mesmo assim, na máquina de produção, arquivos que existiam antes
# do deploy desaparecem — 44 de 54, medido. Enquanto eu não souber quem apaga
# (o vigia acima marca o passo), esta linha garante o que o bloco 4 promete: o
# que estava no ar continua no ar.
#
# `public.anterior` é a foto tirada no começo deste deploy, antes de qualquer
# passo. O que está lá e não está aqui é exatamente o que alguém removeu.
#
# `cp -n` (não sobrescreve): os arquivos do build NOVO já estão publicados e são
# a verdade. Isto só recoloca os que faltam.
#
# Vem ANTES da limpeza de 7 dias de propósito — restaurar um arquivo velho
# demais só para ele ser apagado na linha seguinte é a ordem certa: a limpeza
# decide o que é velho, não este bloco.
# ---------------------------------------------------------------------------
if [ -d public.anterior/app-assets ]; then
  antes_lista=$(ls -1 public.anterior/app-assets 2>/dev/null | sort)
  agora_lista=$(ls -1 public/app-assets 2>/dev/null | sort)
  faltando=$(comm -23 <(printf '%s\n' "$antes_lista") <(printf '%s\n' "$agora_lista") | grep -c . || true)
  if [ "$faltando" -gt 0 ]; then
    echo "   [vigia] RESTAURANDO $faltando assets que sumiram durante o deploy"
    echo "$(date -Is) $(printf '%-28s' 'RESTAUROU') arquivos=$faltando" >> "$VIGIA_LOG"
    cp -an public.anterior/app-assets/. public/app-assets/ 2>/dev/null || true
  fi
fi
vigia "60 pos-restauracao"

echo "→ Limpando assets com mais de 7 dias"
find public/app-assets -type f -mtime +7 -delete 2>/dev/null || true

vigia "70 pos-limpeza"

echo "→ Recarregando o processo (PM2, sem queda)"
# `reload` e nao `restart`: em modo cluster o PM2 troca UMA instancia por vez e,
# com wait_ready, so derruba a antiga depois que a nova avisa que terminou de
# aplicar o schema. `restart` derruba as tres de uma vez — que era a origem dos
# ~5s de 502 a cada deploy (e de 8s com 100 clientes).
# Se o app ainda nao estiver rodando, `reload` falha e o `start` assume.
pm2 reload ecosystem.config.js --update-env || pm2 start ecosystem.config.js
pm2 save

echo "✓ Deploy concluído. Para voltar: bash $APP_DIR/rollback.sh"
