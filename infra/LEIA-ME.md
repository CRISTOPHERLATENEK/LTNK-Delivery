# Backup e restauração

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
- **retenção de 14 dias**, limpando só DEPOIS do dump do dia (nunca fica sem
  nenhuma cópia caso o dump de hoje falhe)

Cada arquivo é verificado: o `.sql.gz` precisa terminar com `Dump completed` e o
`.tar.gz` precisa ter o índice legível. Sem isso, um backup truncado por disco
cheio parece bom até o dia em que precisa ser usado.

## Cópia fora da máquina

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
