# Status da migração SQLite → MySQL — o que falta

> Gerado automaticamente ao final de uma sessão longa de trabalho, pra você
> (ou uma sessão futura, inclusive em outra conta) continuar de onde parou.
> Contexto completo da decisão está em `C:\Users\User\.claude\plans\moonlit-jumping-yeti.md`
> (só existe na sua máquina local, não é versionado no git).

## Onde estamos

Branch: **`migracao-mysql`** (não é a `main` — nada disso foi pro ar ainda).
Todos os commits abaixo já estão nessa branch, em ordem:

1. `feat(mysql): núcleo da nova camada de banco assíncrona (etapa 2 da migração)`
2. `feat(mysql): schema completo traduzido + script de verificação (etapa 2)`
3. `feat(mysql): tenants.ts portado para MySQL (etapa 3)`
4. `feat(mysql): converte autenticacao/publico/webhooks/push/server para MySQL (etapa 4a)`
5. `feat(mysql): converte cozinha/pagamentos/comissao/notificacoes/auth/whatsapp/fluxoPedido para MySQL (etapa 4b)`
6. `feat(mysql): converte entregador.ts para MySQL (etapa 4c)`
7. `feat(mysql): converte cliente.ts para MySQL (etapa 4d)`
8. `feat(mysql): converte admin.ts para MySQL (etapa 4e)`
9. `feat(mysql): converte lojista.ts para MySQL (etapa 4f, maior arquivo)`
10. `feat(mysql): converte seed.ts para MySQL (etapa 4g) — conversão de rotas completa`
11. `feat(mysql): script de migração de dados SQLite -> MySQL (etapa 5)`

**Etapas 1 a 5 do plano estão 100% concluídas e testadas** contra um banco
MySQL real (o de teste do Hostinger). **Nenhum arquivo de rota/serviço do
app importa mais o `db.ts`/`tenants.ts` antigos (SQLite)** — confirmado via
grep. Só sobram dois arquivos legados no repo: `src/backend/db.ts` e
`src/backend/tenants.ts` (SQLite), mantidos de propósito até a Etapa 7,
porque o script de migração de dados ainda precisa do `better-sqlite3` pra
LER os `.db` antigos.

## O que falta (Etapas 6 e 7)

### Etapa 6 — Corte em produção (a etapa que falta de verdade)

**Por que eu não fiz isso sozinho:** é a única etapa que mexe em produção de
verdade — dados reais de clientes, pedidos, janela de manutenção, deploy no
domínio ao vivo. Isso exige você por perto pra confirmar cada passo (não é
uma ação que se deva automatizar sem supervisão direta).

Checklist, na ordem:

1. **Provisionar o(s) banco(s) MySQL de produção.**
   - Decisão já tomada: você comprou um **VPS** (Hostinger KVM 4, Debian 11,
     4 vCPU, 16GB RAM, 200GB disco, IP `179.197.76.76`) e vai manter MySQL
     (não voltar pra SQLite) pensando em compatibilidade futura com AWS.
   - No VPS, instalar MySQL 8+ ou MariaDB 10.6+ localmente (recomendado —
     evita as dores de acesso remoto que tivemos com o MySQL gerenciado da
     Hostinger na Etapa 1), OU continuar usando o MySQL gerenciado da
     Hostinger (`srv1526.hstgr.io`) se preferir não administrar o banco.
   - Criar um banco por tenant real (hoje: o tenant padrão/master + o que
     tiver em `dados/tenants/*.db` — confira quantos tenants existem rodando
     `ls dados/tenants/` antes do corte). **O usuário MySQL não tem
     privilégio `CREATE DATABASE`** (confirmado na Etapa 1) — cada banco
     precisa ser criado manualmente no painel/CLI do MySQL antes.
   - Rodar `node dist/backend/testar-schema-mysql.js` (com as env vars do
     banco novo) em cada banco recém-criado pra aplicar o schema e validar
     os índices únicos/CHECKs — igual foi feito no banco de teste.

2. **Configurar as variáveis de ambiente de produção** (no painel do VPS/PM2/
   systemd, o que for usar pra rodar o processo Node):
   `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`,
   `MYSQL_DATABASE` (banco do tenant master), `MYSQL_DATABASE_CENTRAL`
   (banco do registro de tenants — pode ser o mesmo do master),
   `MYSQL_TENANT_PREFIX` (opcional). Ver comentários novos em `.env.example`.

3. **Resolver a sujeira de dados encontrada pelo script de migração**
   (achado real, não é bug do script): o banco de dev tem **4 contas de
   usuário com o mesmo telefone** (`47984173970`) — o SQLite antigo tinha
   essa checagem de unicidade, mas ela falhava silenciosamente pra dados
   legados (ver comentário em `src/backend/db.ts` perto de
   `idx_usuarios_telefone_unico`). Antes de migrar os dados REAIS de
   produção, rode o script de migração contra uma CÓPIA (baixada via
   `GET /api/admin/backup`) e um banco de teste, leia o relatório de
   conflitos no final, e decida linha a linha o que fazer com cada
   duplicata (normalmente: manter a conta mais recente/ativa, apagar ou
   renomear o telefone das outras) ANTES do corte real. Repita até o
   relatório sair limpo (`✅ Migração concluída sem divergências de contagem.`).

4. **Ensaiar a migração completa** contra cópias dos `.db` reais de
   produção + o(s) banco(s) MySQL de produção (ainda vazios nesse ponto —
   pode limpar à vontade, ainda não é o corte real):
   ```
   MYSQL_HOST=... MYSQL_USER=... MYSQL_PASSWORD=... \
     node dist/backend/migrar-para-mysql.js dados/delivery.db <banco_master> --limpar
   ```
   Repita pra cada tenant (`dados/tenants/<slug>.db` → banco MySQL daquele
   tenant). Confira o relatório final de cada rodada.

5. **Build do branch `migracao-mysql`** (`npm run build`) e revisão final —
   já validado, mas vale rodar de novo puro antes do deploy.

6. **Janela de manutenção**: avisar lojistas/clientes se fizer sentido,
   baixar o backup final de produção (`GET /api/admin/backup`, ou um
   `mysqldump`/`.tar` de tudo se já estiver parcialmente no VPS).

7. **Migração real**: rodar `migrar-para-mysql.js` contra os `.db` reais de
   produção (não mais cópias) e o(s) banco(s) MySQL de produção, SEM
   `--limpar` dessa vez (a menos que o ensaio da etapa 4 já tenha sujado
   esses bancos — nesse caso limpe antes de novo).

8. **Deploy**: subir a branch `migracao-mysql` pro VPS com as env vars do
   passo 2 configuradas. Rodar `npm run build && node dist/backend/server.js`
   (ou via PM2/systemd).

9. **Smoke test**: login em cada perfil (cliente/lojista/entregador/
   admin/cozinha) de cada tenant, um pedido de ponta a ponta, verificar que
   os dados migrados aparecem certinho.

10. **Critério de aceite final do plano inteiro**: produção rodando no MySQL
    sobrevivendo a **pelo menos um deploy git subsequente** sem perder
    dados — essa é a prova de que o problema original (Hostinger apagando
    tudo a cada deploy) foi resolvido.

**Rollback, se algo der errado no passo 7-9:** reverter o deploy pro commit
anterior (branch `main`, que continua 100% em SQLite intocada), restaurar o
backup baixado no passo 6. Qualquer pedido feito no MySQL durante a janela
tentada se perde nesse cenário — risco já aceito por você anteriormente.

### Etapa 7 — Limpeza (só depois do corte confirmado estável)

- Remover `better-sqlite3` do `package.json` (`npm uninstall better-sqlite3`).
- Apagar `src/backend/db.ts` e `src/backend/tenants.ts` (as versões SQLite
  antigas — não são mais importadas por nada, mas ainda existem no repo).
- Apagar `src/backend/testar-schema-mysql.ts` e `src/backend/testar-tenants-mysql.ts`
  (scripts de verificação de desenvolvimento, cumpriram o papel).
  `migrar-para-mysql.ts` pode ficar (é útil se precisar migrar outro tenant
  no futuro) ou sair também, a seu critério.
  ⚠️ **Só remova `better-sqlite3` DEPOIS**, já que `migrar-para-mysql.ts`
  depende dele pra ler os `.db` antigos.
- Atualizar `DEPLOY.md` (ainda descreve o fluxo antigo 100% SQLite) pra
  refletir o MySQL + VPS.
- Revisar comentários residuais que ainda mencionam "SQLite"/"arquivo .db"
  em código (ex.: docstring de topo do `schema-mysql.ts` já documenta as
  traduções, mas vale uma passada geral).

## Arquivos-chave criados/alterados nesta migração

- `src/backend/db-mysql.ts` — camada async sobre `mysql2/promise`
- `src/backend/schema-mysql.ts` — schema completo traduzido (30 tabelas)
- `src/backend/tenants-mysql.ts` — registro central de tenants
- `src/backend/migrar-para-mysql.ts` — script de migração de dados (Etapa 5)
- `src/backend/testar-schema-mysql.ts`, `testar-tenants-mysql.ts` — scripts
  de verificação (dev only)
- Todas as rotas em `src/backend/rotas/*.ts` + `auth.ts`, `comissao.ts`,
  `notificacoes.ts`, `fluxoPedido.ts`, `whatsapp.ts`, `whatsapp-nao-oficial.ts`,
  `push.ts`, `seed.ts`, `server.ts`

## Se for continuar em outra conta/sessão

1. `git clone`/`git fetch` o repo, `git checkout migracao-mysql`.
2. Leia este arquivo + (se ainda existir na sua máquina)
   `C:\Users\User\.claude\plans\moonlit-jumping-yeti.md` pro contexto
   completo das decisões tomadas.
3. Comece pela Etapa 6, passo 1 (provisionar os bancos MySQL de produção no
   VPS).
