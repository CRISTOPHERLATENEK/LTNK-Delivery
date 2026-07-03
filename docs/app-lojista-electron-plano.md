# Plano — App instalável do lojista (Electron)

Status: **planejado** (não construído). Decisão: Electron, URL configurável no 1º uso,
impressão silenciosa nativa. Este doc é o passo a passo pra executar depois.

## Objetivo
Empacotar o painel do lojista como um app de desktop Windows (.exe), que:
- Abre como programa (ícone, inicia com o Windows, tela cheia/kiosk opcional).
- **Imprime direto na térmica sem diálogo** usando a impressão nativa do Electron
  (`webContents.print({ silent: true, deviceName })`) — **dispensa o QZ Tray** no desktop.
- Carrega a loja por uma **URL configurável no primeiro uso** (SaaS multi-loja).

## Arquitetura
```
app-lojista/                    (novo projeto, separado do frontend web)
  package.json                  scripts electron + electron-builder
  electron/
    main.ts                     processo principal: BrowserWindow, carrega a URL
    preload.ts                  bridge segura (contextBridge) p/ impressão
    print.ts                    impressão silenciosa (print + optional PDF/ESC-POS)
    config.ts                   lê/grava a URL da loja (electron-store)
  build/                        ícones (icon.ico) e assets do instalador
```
O app NÃO rebundla o frontend — ele **carrega a URL do site** (o mesmo painel web
já publicado). Assim, atualizações do painel chegam sem reinstalar o app.

## Fluxo
1. 1º uso: tela pedindo a **URL da loja** (ex.: `https://minhaloja.seudominio.com/lojista`).
   Salva com `electron-store`. Botão "trocar loja" nas configs.
2. Abre o painel dentro de um `BrowserWindow`.
3. Impressão: o web chama `window.printerBridge.imprimir(html)` (exposto no preload);
   o main renderiza num `BrowserWindow` oculto e faz `print({ silent:true, deviceName })`.
   - A impressora escolhida fica salva (electron-store) — tela de seleção lista
     `webContents.getPrintersAsync()`.

## Integração com o código atual (mínima)
- Em `frontend/src/lib/impressao.ts` → `despacharImpressao`: adicionar 1º caminho
  "se `window.printerBridge` existir (rodando no Electron), usar ele"; senão a lógica
  atual (QZ Tray → diálogo). Ou seja, **ordem: Electron → QZ Tray → diálogo**.
- Nada mais muda no web; no navegador comum continua QZ Tray/diálogo.

## Impressão silenciosa (Electron)
```ts
// main: imprime um HTML sem diálogo
async function imprimirHtml(html: string, deviceName: string) {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  win.webContents.print({ silent: true, deviceName, marginsType: 1 }, () => win.close());
}
```
Bobina 58/80mm: o `@page size` no HTML já controla; a impressora térmica precisa
estar instalada no Windows (driver do fabricante).

## Build / instalador
- `electron-builder` gerando **NSIS** (.exe) — instalador Windows com atalho + autostart opcional.
- `package.json`:
  ```json
  "scripts": { "dev": "...", "dist": "electron-builder --win nsis" }
  ```
- Assinatura de código (certificado) é opcional — sem ela o Windows SmartScreen mostra
  aviso na 1ª execução. Para produção, assinar com um code-signing cert.
- **Auto-update** (opcional, fase 2): `electron-updater` + um endpoint/hospedagem dos releases.

## Passo a passo de execução (quando for fazer)
1. Criar `app-lojista/` com Electron + TypeScript + electron-builder + electron-store.
2. `main.ts`: janela, carregar URL salva ou tela de config.
3. `preload.ts` + `contextBridge`: expor `printerBridge.imprimir/listarImpressoras/definirImpressora`.
4. `print.ts`: impressão silenciosa (código acima).
5. Ajustar `despacharImpressao` no web p/ preferir `window.printerBridge`.
6. Ícone + `electron-builder.yml` (appId, NSIS, autostart).
7. `npm run dist` → gera o `.exe` em `app-lojista/dist/`.
8. Testar: instalar, configurar URL, escolher impressora, fazer um pedido → imprime sozinho.

## Observações / riscos
- Gerar o instalador baixa ~200MB (Electron + NSIS) na 1ª vez.
- Testar o .exe é interativo (abre janela) — melhor validar na máquina do dev/caixa.
- Alternativa mais leve considerada: **Tauri** (~10MB) — mas impressão silenciosa é
  menos madura; e **PWA** — leve mas NÃO tem impressão silenciosa nativa (dependeria do QZ Tray).
- Multi-loja: a URL configurável cobre todos os tenants com um único instalador.

Ver memórias: [[impressao-qztray-delivery]] (motor de impressão atual) e
[[multi-tenant-silo-delivery]] (URL por tenant).
