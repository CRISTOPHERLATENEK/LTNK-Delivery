# Backup e restauração

> **Se o servidor caiu agora**, vá direto para [SE-O-SERVIDOR-CAIR.md](SE-O-SERVIDOR-CAIR.md).
> Este arquivo explica como o backup funciona; aquele diz o que fazer no incidente.

Os dois scripts rodam no servidor, em `/usr/local/bin/`. Estão versionados aqui
porque script que só existe na máquina desaparece com a máquina — e é justamente
numa máquina perdida que eles seriam necessários.

## O que o backup salva

Todo dia às 03:12 (`/etc/cron.d/backup-delivery`), em `/opt/backup-delivery/<data>/`:

- **um arquivo por banco** (`.sql.gz`) — permite restaurar UM cliente sem tocar
  nos outros; num dump único, restaurar um obriga a derrubar todos
- **`uploads.tar.gz`** — fotos de produto, logo e banner. Sem isso, restaurar
  devolve todo produto apontando para uma imagem que não existe mais, e o
  lojista teria que refotografar o cardápio inteiro
- **`certificados.tar.gz`** — o A1 fiscal e os certificados da ONZ/Pix. Ficavam
  de fora (o backup pegava só `uploads`), e o certificado não se recupera de
  lugar nenhum: não está em banco, não está no git, só existe naquele disco.
  Perder o A1 é parar de emitir nota até comprar outro
- **`ambiente.tar.gz.enc`** — o `.env`, **cifrado**. É a peça sem a qual o
  restore não serve: `APP_SECRET` é a chave que cifra os segredos em repouso no
  banco (token do Mercado Pago, token do Maxx Gestão, senha do certificado).
  Restaurar o banco sem ela devolve tudo isso como lixo indecifrável — o restore
  "funciona" e o sistema não
- **retenção de 14 dias**, limpando só DEPOIS do dump do dia (nunca fica sem
  nenhuma cópia caso o dump de hoje falhe)

## A senha do `.env` cifrado

Fica em `/root/.backup-senha` (600) e **não entra no backup**: guardar a senha
junto do que ela protege é o mesmo que não ter senha.

Por isso ela precisa estar **fora do servidor** — num gerenciador de senhas. Se
ela só existir na máquina, o dia em que a máquina morrer é o dia em que o `.env`
cifrado na nuvem vira um arquivo que ninguém consegue abrir.

Criar, uma vez:

```bash
openssl rand -base64 48 > /root/.backup-senha && chmod 600 /root/.backup-senha
```

Enquanto ela não existir, o backup **pula o `.env`** e registra um aviso alto no
log — é melhor um backup sem o `.env`, e o operador sabendo, do que segredo em
claro espalhado por toda cópia do backup.

Para abrir o `.env` de um backup:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000   -pass file:/root/.backup-senha -in ambiente.tar.gz.enc | tar -xzf - -C /destino
```

## Ensaio de restauração

```bash
restaurar-delivery.sh --testar
```

Restaura **todos** os bancos do backup mais recente em cópias `_ensaio`, conta
as tabelas comparando com produção, confere que as peças que não são banco estão
presentes, e apaga as cópias no fim. Não toca em produção e pode rodar com o app
no ar.

Existe porque **backup que nunca foi restaurado é suposição, não garantia**: o
dump pode estar completo e mesmo assim não subir — charset, versão do MySQL,
permissão. Vale rodar de vez em quando; leva segundos.

Cada arquivo é verificado: o `.sql.gz` precisa terminar com `Dump completed` e o
`.tar.gz` precisa ter o índice legível. Sem isso, um backup truncado por disco
cheio parece bom até o dia em que precisa ser usado.

## Cópia fora da máquina

### A regra que vale para qualquer destino

**Quem copia nunca pode apagar.** O script usa `rclone copy`, não `sync`, e a
diferença é o backup inteiro: `sync` espelha, então um ransomware que cifrasse
`/opt/backup-delivery` — ou um `rm -rf` errado — teria a destruição replicada
para a cópia externa na execução seguinte, apagando a única sobrevivente.

Pela mesma razão, a **retenção remota roda do outro lado**: no bucket, por regra
de ciclo de vida; na VPS de backup, por cron de lá. Se a máquina de produção
puder apagar a cópia externa, um invasor com root nela também pode.

### Opção A — VPS de backup (segunda máquina)

Funciona, com duas condições:

1. **Outro provedor, ou no mínimo outra conta.** Duas VPS na mesma conta morrem
   juntas numa suspensão por cobrança, que é um dos cenários mais comuns.
2. **A VPS de backup PUXA; a de produção não empurra.** Este é o ponto que
   separa "tenho backup" de "tenho backup que sobrevive a invasão". Se produção
   empurra, ela guarda a credencial do destino — e quem tomar root em produção
   apaga os dois lados. Se o backup puxa, produção não tem credencial nenhuma do
   destino, e não há o que roubar.

Na VPS de backup, uma chave SSH restrita e um cron:

```bash
# na VPS de backup
ssh-keygen -t ed25519 -f ~/.ssh/puxar-backup -N ''
# a chave PUBLICA vai para produção, em /root/.ssh/authorized_keys, com o
# comando travado: ela só serve para ler, nunca para entrar de verdade.
#   command="rsync --server --sender -vlogDtpre.iLsfxC . /opt/backup-delivery/",
#   no-agent-forwarding,no-port-forwarding,no-pty ssh-ed25519 AAAA...
```

```bash
# /etc/cron.d/puxar-delivery — na VPS de backup, 1h depois do backup de lá
42 4 * * * root rsync -az --delete-excluded -e "ssh -i /root/.ssh/puxar-backup"   root@<ip-producao>:/opt/backup-delivery/ /opt/copia-delivery/   && find /opt/copia-delivery -mindepth 1 -maxdepth 1 -type d -mtime +90 -exec rm -rf {} +
```

### Opção B — bucket de objeto (R2, B2, S3)

Mais barato (centavos por mês contra o preço de uma VPS) e sem máquina para
manter — bucket não precisa de patch de segurança. Configure uma vez:

```bash
rclone config      # o destino PRECISA se chamar `backup`
```

E ligue **versionamento** e **regra de ciclo de vida** no bucket: com
versionamento, sobrescrever não perde a versão boa; a regra apaga o que passar
de 90 dias sem ninguém precisar lembrar.

Se o provedor oferecer **bloqueio de objeto** (object lock / immutability),
ligue: nem uma credencial roubada apaga o que está travado.


O backup local sobrevive a um `rm -rf` da pasta do app, mas **não** a VPS
apagada, disco corrompido, conta suspensa ou ransomware com root — que são
justamente os casos em que ele seria a única saída.

A etapa existe no script e é **pulada enquanto não houver destino configurado**
(falta de nuvem não pode transformar backup bom em falha). Para ligar, uma vez:

```bash
ssh vps-delivery "rclone config"
```

Crie um destino com o nome exato **`backup`**. Para Cloudflare R2, que já é sua
conta e tem 10 GB grátis (o backup inteiro hoje são 26 MB por dia):

1. `n` para novo destino, nome: `backup`
2. tipo: `s3`, provedor: `Cloudflare R2`
3. `access_key_id` e `secret_access_key`: criados em R2 → *Manage API Tokens*
4. `endpoint`: `https://<sua-conta>.r2.cloudflarestorage.com`
5. crie o bucket `delivery-backup` no painel do R2

A partir daí o backup sincroniza sozinho e registra no log.

## Restaurar

```bash
ssh vps-delivery "/usr/local/bin/restaurar-delivery.sh --listar"
ssh vps-delivery "/usr/local/bin/restaurar-delivery.sh tenant_unimaxx"
```

Ele restaura num banco **novo**, com sufixo `_restaurado`, e nunca por cima do
original: se o dump estiver ruim, sobrescrever destrói a única cópia boa que
restava. No fim ele imprime os comandos para promover a restauração, com o app
parado.

## Restauração testada em 19/08/2026

Não é teoria — foi executado:

| | |
|---|---|
| Banco original | 29 produtos, 42 pedidos, 13 notas |
| Restaurado | 29 produtos, 42 pedidos, 13 notas |
| Tempo | 0,45 s |
| Imagens | 50 arquivos extraídos |
| Foto de produto real | presente no backup, caminho conferido |

Backup que nunca foi restaurado não é backup.
