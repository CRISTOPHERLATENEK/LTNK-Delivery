# Status da migração SQLite → MySQL — CONCLUÍDA

> Este arquivo documentava o que faltava pra terminar a migração. Como as
> etapas 6 e 7 já foram concluídas, ficou como registro histórico da decisão
> e do estado final. Contexto completo original está em
> `C:\Users\User\.claude\plans\moonlit-jumping-yeti.md` (só existe localmente,
> não é versionado no git).

## Estado atual

Produção roda em **MySQL/MariaDB**, num **VPS** próprio (Hostinger KVM 4,
Debian 11, IP `179.197.76.76`), gerenciado por PM2, deploy via `git pull` +
`npm run build:backend` + `npm run build` (frontend) + `pm2 restart`.
Arquitetura **SILO multi-tenant**: um banco MySQL isolado por cliente da
plataforma, resolvido por domínio/subdomínio (`resolverPorHost` em
`tenants-mysql.ts`) ou por override explícito via header (impersonação
admin, vitrine de demo `/demo/:slug` — ver `server.ts`).

Critério de aceite do plano original ("produção sobrevive a pelo menos um
deploy git subsequente sem perder dados") está cumprido — a plataforma já
passou por dezenas de deploys desde o corte, sem perda de dados.

## O que foi feito (etapas 1–7, todas concluídas)

1. Infra MySQL provisionada (usuário sem privilégio `CREATE DATABASE` —
   cada banco de tenant é criado manualmente antes de registrar o tenant).
2. Camada assíncrona `db-mysql.ts` sobre `mysql2/promise` + schema completo
   traduzido em `schema-mysql.ts` (30 tabelas, idempotente).
3. `tenants-mysql.ts` — registro central de tenants, provisionamento de
   banco novo síncrono (não mais preguiçoso como no SQLite).
4. Todas as rotas convertidas para MySQL (`autenticacao`, `publico`,
   `cliente`, `lojista`, `entregador`, `admin`, `cozinha`, `pagamentos`,
   `webhooks`, `push`, `notificacoes`, `auth`, `whatsapp*`, `fluxoPedido`,
   `comissao`, `seed`, `server`).
5. Dados migrados dos `.db` SQLite legados para os bancos MySQL
   correspondentes (script `migrar-para-mysql.ts`, já removido do repo —
   ver "Limpeza" abaixo).
6. **Corte em produção**: feito. Deploy roda no VPS, não mais no "Web app
   Node.js" gerenciado da Hostinger (que resetava o disco a cada deploy —
   esse era o problema original que motivou a migração).
7. **Limpeza**: concluída —
   - `better-sqlite3`/`@types/better-sqlite3` removidos do `package.json`.
   - `src/backend/db.ts`/`tenants.ts` (SQLite antigos) já não existiam mais
     no repo (removidos numa sessão anterior, zero imports).
   - `src/backend/migrar-para-mysql.ts` removido (cumpriu o papel — não há
     mais tenant em SQLite pra migrar).
   - `src/testes/e2e.ts` removido — a suíte antiga subia um servidor com
     banco SQLite descartável e não fazia mais sentido contra o servidor
     MySQL atual. **Perdeu-se a cobertura e2e** (45 cenários) até que uma
     nova suíte equivalente seja escrita contra um banco MySQL descartável,
     se algum dia fizer sentido reconstruir.
   - `DEPLOY.md` e `README.md` atualizados pra refletir MySQL + VPS (o
     `README.md` ainda tem trechos desatualizados sobre a estrutura de
     pastas e o guia de deploy Railway/Render — não foram tocados nesta
     limpeza, vale uma revisão futura dedicada).

## Arquivos-chave da migração (ainda no repo)

- `src/backend/db-mysql.ts` — camada async sobre `mysql2/promise`
- `src/backend/schema-mysql.ts` — schema completo traduzido (30 tabelas)
- `src/backend/tenants-mysql.ts` — registro central de tenants
- `src/backend/testar-schema-mysql.ts` — script de verificação de schema
  (idempotente, pode rodar de novo em qualquer banco a qualquer momento)
