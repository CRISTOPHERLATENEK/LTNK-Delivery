# Se o servidor cair

Escrito antes de precisar, porque no dia em que precisar ninguém vai lembrar a
ordem — e a hora de descobrir o comando não pode ser a hora do desespero.

Levantado da máquina em produção em 04/09/2026. Se algo aqui divergir do que
você encontrar, o servidor tem razão e este documento está velho: corrija-o.

---

## Primeiro: qual dos dois é?

**Caiu ≠ sumiu.** As duas situações têm respostas completamente diferentes, e
tratar a primeira como a segunda destrói dados sem necessidade.

| | o que aconteceu | tempo |
|---|---|---|
| **A. Caiu** | a máquina existe, o site não responde | minutos |
| **B. Sumiu** | VPS apagada, conta suspensa, disco perdido | horas — e depende de haver cópia fora |

Descobre em dez segundos:

```bash
ssh vps-delivery 'uptime && pm2 status && df -h / | tail -1'
```

Se o SSH responde, é **A**. Se não responde de jeito nenhum, tente o painel da
Hostinger antes de concluir que é **B** — SSH fora do ar costuma ser firewall ou
disco cheio, não máquina perdida.

---

## A. A máquina está viva

Na ordem, do mais comum para o mais raro.

### 1. Disco cheio

É a causa mais frequente de "tudo parou ao mesmo tempo": o MySQL para de
escrever, o Node não grava log, o nginx devolve 500.

```bash
ssh vps-delivery 'df -h / && du -sh /opt/backup-delivery /var/log /opt/delivery/dados'
```

Se estiver perto de 100%, o alívio rápido e seguro é apagar backups antigos —
**nunca** `dados/` nem `/opt/delivery`:

```bash
ssh vps-delivery 'ls -dt /opt/backup-delivery/*/ | tail -5 | xargs rm -rf'
```

### 2. O app caiu

```bash
ssh vps-delivery 'pm2 status && pm2 logs delivery --lines 50 --nostream'
```

```bash
ssh vps-delivery 'pm2 restart delivery'
```

Se ele reinicia em laço, **não** insista: o log diz o motivo, e reiniciar em
cima esconde a causa. Erro de schema e `.env` faltando são os dois campeões.

### 3. O banco caiu

```bash
ssh vps-delivery 'systemctl status mariadb --no-pager | head -20'
ssh vps-delivery 'systemctl restart mariadb && pm2 restart delivery'
```

### 4. O deploy quebrou o site

O deploy **não é atômico**: build interrompido derruba o que está no ar. Para
voltar à versão anterior:

```bash
ssh vps-delivery 'cd /opt/delivery && git log --oneline -5'
ssh vps-delivery 'cd /opt/delivery && git reset --hard <commit-bom> && npm run build && pm2 reload ecosystem.config.js'
```

### 5. Certificado vencido (HTTPS quebrado)

```bash
ssh vps-delivery 'certbot renew --nginx && systemctl reload nginx'
```

---

## B. A máquina sumiu

**Leia isto antes de tudo:** existe **uma** cópia fora da VPS, e ela é do
próprio provedor — não é nada que a gente montou.

| Onde | Estado | Alcance |
|---|---|---|
| **Backup automático da Hostinger** | **ligado, SEMANAL** (hpanel → VPS → Snapshots e Backups) | imagem do disco inteiro, ~6,7 GB, guardada **fora do servidor**, 2 gerações, restauração em ~30 min |
| `rclone` para nuvem (R2, B2, S3) | não configurado — o log diz `copia externa nao configurada` todo dia | — |
| cópia na máquina de mesa (`infra/puxar-backup.ps1`) | desligada por decisão em 08/09/2026 | — |

**É o backup da Hostinger que salva a operação hoje**, e ele é melhor do que
parece: sendo imagem do disco, ele carrega **dentro dele** o
`/opt/backup-delivery` inteiro — ou seja, todas as gerações diárias daquele
momento, com a profundidade de 180 dias.

O que ele custa é **quanto você perde**: sendo semanal, o pior caso é o disco
morrer 6 dias depois do último backup e você voltar **6 dias no tempo** —
pedidos, pagamentos e cadastros do período viram nada. Os dumps diários
existiam, mas morreram no disco junto.

A opção **diária** existe no painel e custa **R$ 65,99/mês** (verificado em
08/09/2026). O `rclone` para R2 resolve o mesmo problema por uma fração disso, e
melhor: sobe os dumps diários todo dia, então além de cair para 24 h de perda,
a cópia externa passa a ter os 180 dias de histórico — não só duas gerações.

E se o servidor ainda estiver de pé mas ameaçado: **tire um snapshot manual
agora** (mesma tela, é grátis) e/ou rode `infra/puxar-backup.ps1` para trazer
`/opt/backup-delivery` para fora.

### O que você precisa ter em mãos

| peça | onde deveria estar |
|---|---|
| Backup (`.sql.gz`, `uploads`, `certificados`, `ambiente.enc`) | bucket R2/B2/S3 |
| Senha do `.env` cifrado | **gerenciador de senhas**, não na VPS |
| Acesso ao registrador / Cloudflare | conta do domínio |
| Acesso ao GitHub | o código vem daqui |

### Os passos

**1. VPS nova.** Debian/Ubuntu, 4 núcleos (o PM2 está configurado para 3
instâncias + 1 núcleo para o banco). Anote o IP novo.

**2. Base:**

```bash
apt update && apt install -y nginx mariadb-server certbot python3-certbot-nginx git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
npm i -g pm2@7
```

Versões que estavam em produção: Node 20.20.2 · npm 10.8.2 · MariaDB 10.5.29 ·
nginx 1.18.0 · PM2 7.0.3.

**3. Código:**

```bash
git clone <repo> /opt/delivery && cd /opt/delivery && git checkout migracao-mysql
```

**4. O `.env`** — antes do build, senão o app sobe sem saber ler os próprios
segredos:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass file:<senha-do-gerenciador> -in ambiente.tar.gz.enc | tar -xzf - -C /opt/delivery
```

> **O `APP_SECRET` tem que ser o MESMO de quando o backup foi feito.** Ele cifra
> os segredos dentro do banco — token do Mercado Pago, token do Maxx Gestão,
> senha do certificado. Com outro `APP_SECRET`, o banco restaura e todos esses
> valores voltam como lixo indecifrável: o restore "funciona" e o sistema não.

**5. Bancos:**

```bash
for f in *.sql.gz; do
  b=$(basename "$f" .sql.gz)
  mysql -e "CREATE DATABASE \`$b\` CHARACTER SET utf8mb4"
  zcat "$f" | mysql "$b"
done
```

**6. Arquivos:**

```bash
tar -xzf uploads.tar.gz      -C /opt/delivery/dados/
tar -xzf certificados.tar.gz -C /opt/delivery/dados/
chmod 700 /opt/delivery/dados/certificados
```

**7. Subir:**

```bash
cd /opt/delivery && npm install && npm run build && pm2 start ecosystem.config.js && pm2 save && pm2 startup
```

**8. nginx + HTTPS.** O `server_name` em produção era
`maxxpedidos.com.br www.maxxpedidos.com.br *.maxxpedidos.com.br`, com
`proxy_pass http://127.0.0.1:3000`:

```bash
certbot --nginx -d maxxpedidos.com.br -d '*.maxxpedidos.com.br'
```

O curinga exige validação por DNS — precisa do acesso ao Cloudflare.

**9. DNS.** Apontar o A/AAAA para o IP novo. Enquanto o TTL antigo não expirar,
parte dos clientes continua batendo no IP morto: é normal, e **não** é motivo
para refazer nada.

**10. Conferir, antes de avisar que voltou:**

```bash
/usr/local/bin/restaurar-delivery.sh --testar
curl -sI https://maxxpedidos.com.br | head -3
```

E na aplicação: abrir uma loja, fazer um pedido de teste, e conferir que uma
imagem de produto carrega (prova que os uploads voltaram).

**11. Religar o backup na máquina nova** — é o passo que todo mundo esquece, e
aí o próximo incidente encontra você sem backup nenhum:

```bash
install -m 755 /opt/delivery/infra/backup-delivery.sh    /usr/local/bin/
install -m 755 /opt/delivery/infra/restaurar-delivery.sh /usr/local/bin/
cp /opt/delivery/infra/cron-backup /etc/cron.d/backup-delivery   # ou recriar à mão
rclone config    # o destino precisa se chamar `backup`
```

### Se não havia cópia externa

Sem backup fora da VPS, o dado se foi. O que ainda existe:

- **O código**, no GitHub — íntegro.
- **As notas fiscais já autorizadas**, na SEFAZ. Os XMLs se recuperam pela
  chave de acesso; sem o banco, as chaves estão nos e-mails enviados ao contador.
- **Os pedidos que subiram ao Maxx Gestão**, no ERP do cliente.
- **Snapshot da Hostinger**, se algum dia foi ligado — vale checar o painel
  antes de dar tudo por perdido.

Não há como reconstruir cardápio, clientes e histórico a partir disso. É por
esse motivo que a cópia externa é o item mais importante desta pasta.

---

## O que fazer HOJE para este documento valer

1. ~~Criar `/root/.backup-senha`~~ — **feito em 08/09/2026.** O `.env` agora
   entra no backup cifrado (`ambiente.tar.gz.enc`). **Falta guardar o valor no
   gerenciador de senhas** (`cat /root/.backup-senha`): enquanto ela existir só
   dentro da VPS, o `.env` cifrado é inabrível justamente no cenário da seção B.
2. **Cópia fora da VPS: existe a da Hostinger, semanal.** Ligada, guardada
   fora do servidor, 2 gerações. O paliativo da máquina de mesa foi montado e
   desligado no mesmo dia, por decisão; o script segue em
   `infra/puxar-backup.ps1` e religar é uma linha (ver LEIA-ME, opção A2).
   Snapshot manual, grátis na mesma tela, antes de qualquer operação de risco.
3. `rclone config` na VPS, com o destino chamado `backup` — **é o item que
   falta**, e o único que resolve a seção B deste documento.
4. Rodar `restaurar-delivery.sh --testar` de vez em quando.

Sem o passo 1 concluído, a seção B restaura o banco mas devolve os segredos
como lixo.
