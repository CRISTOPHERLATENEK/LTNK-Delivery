# Software de Impressão — LTNK (Delivery)

Nosso agente local de impressão térmica — **substitui o QZ Tray**. Roda no PC do
caixa e imprime **direto na térmica** (ESC/POS, RAW pelo spooler do Windows), sem
diálogo. O painel do lojista (navegador) fala com ele por HTTP em
`http://localhost:9110`.

Tem uma **janela de verdade** (Electron) mostrando status, impressoras detectadas
e um botão de teste — e um ícone na bandeja do Windows pra minimizar sem fechar o
agente. Antes disso era só um console cru; ver `main.js` pra a parte da janela.

## Rodar (dev)
```
cd agente-impressao
npm install
npm start
```
Abre a janela normal. Pra depurar o HTML da janela (console do Chromium):
```
LTNK_DEBUG=1 npm start
```

Se preferir só o servidor, sem janela (ex.: testar os endpoints por curl):
```
npm run servidor
```

## Como o painel usa
1. Abra o painel → **Config → Impressão** → **Software de Impressão** → **Procurar impressoras** → escolha a térmica.
2. A partir daí, cupom/DANFE/pedido saem direto na impressora escolhida (por PC, salvo no navegador).
3. Se o agente estiver fechado, cai automaticamente no diálogo do navegador.

## Endpoints
- `GET /` → dashboard (janela do app carrega isso)
- `GET /status` → `{ ok, versao }`
- `GET /impressoras` → `{ impressoras: [...] }`
- `POST /imprimir` → body `{ impressora, largura, blocos }` → imprime ESC/POS.
- `GET /editor` / `GET,POST /config` → editor do cupom fiscal (cabeçalho, rodapé, QR, fonte).

Blocos: `titulo | center | texto | lr(l,r) | linha | qr(data) | pular(n) | corte`.

## Gerar o instalador
Empacotado com [electron-builder](https://www.electron.build/) — gera um instalador
Windows (NSIS) com wizard: escolhe pasta, cria atalho na Área de Trabalho e no Menu
Iniciar, oferece "iniciar com o Windows", e tem desinstalador pelo Painel de Controle.

```
cd agente-impressao
npm run dist
```
Gera `dist/AgenteImpressao-Instalador.exe` — **é isso que você distribui pro lojista**.

## Como funciona a impressão
`main.js` só cria a janela/bandeja; quem faz o trabalho pesado é `agente.js` (mesmo
de sempre): monta o ESC/POS (`escpos.js`) e envia RAW à impressora via
`imprimir-raw.ps1` (P/Invoke `winspool.WritePrinter`). Sem drivers extras: usa a
impressora já instalada no Windows. Acentos em CP850. QR Code via `GS ( k`.

## Requisitos
- Windows com a impressora térmica instalada (ex.: Elgin i7/i9, Bematech, Epson).
- PowerShell (padrão do Windows).

## Ambientes virtualizados / RDP
Se a janela abrir em branco (raro, mas acontece em VMs/RDP com driver de vídeo
limitado), é o processo de GPU do Chromium falhando — `main.js` já desliga a
aceleração de hardware (`app.disableHardwareAcceleration()`) exatamente por causa
disso, então isso não deveria mais acontecer. Se acontecer mesmo assim, rode com
`LTNK_DEBUG=1` pra ver o log de carregamento da janela.
