# Agente de Impressão (Delivery)

Nosso agente local de impressão térmica — **substitui o QZ Tray**. Roda no PC do
caixa, escuta em `http://localhost:9110` e imprime **direto na térmica** (ESC/POS,
RAW pelo spooler do Windows), sem diálogo. O painel (navegador **ou** app) fala HTTP com ele.

## Rodar (dev)
```
cd agente-impressao
node agente.js
```
Deixe a janela aberta. Ele lista as impressoras detectadas no console.

## Como o painel usa
1. Abra o painel → **Config → Impressão** → **Agente de Impressão** → **Procurar impressoras** → escolha a térmica.
2. A partir daí, cupom/DANFE/pedido saem direto na impressora escolhida (por PC, salvo no navegador).
3. Se o agente estiver fechado, cai automaticamente no diálogo do navegador.

## Endpoints
- `GET /status` → `{ ok, versao }`
- `GET /impressoras` → `{ impressoras: [...] }`
- `POST /imprimir` → body `{ impressora, largura, blocos }` → imprime ESC/POS.

Blocos: `titulo | center | texto | lr(l,r) | linha | qr(data) | pular(n) | corte`.

## Instalador (para o lojista)
`dist/AgenteImpressao-Instalador.exe` — instalador Windows com wizard (Inno Setup):
instala em Program Files, cria atalho na Área de Trabalho e no Menu Iniciar, e tem
a opção "iniciar com o Windows" (marcada por padrão). Desinstala pelo Painel de
Controle normalmente. **É isso que você distribui pro lojista** — um único .exe.

## Gerar o .exe do agente
Sem dependências nativas — empacota com [pkg](https://github.com/vercel/pkg):
```
cd agente-impressao
npx pkg agente.js --targets node18-win-x64 --output dist/AgenteImpressao.exe
```
O `imprimir-raw.ps1` já vai embutido no .exe (asset do pkg) — na primeira
impressão, o agente extrai o script pra um arquivo real em `%TEMP%` (necessário
porque o PowerShell, sendo um processo externo, não enxerga o filesystem
virtual do pkg).

## Gerar o instalador (.exe com wizard)
Precisa do [Inno Setup](https://jrsoftware.org/isinfo.php) (grátis) instalado:
```
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" instalador.iss
```
Gera `dist/AgenteImpressao-Instalador.exe`. O script fica em `instalador.iss`
(copiar arquivo, atalhos, task de autostart, desinstalador).

## Como funciona a impressão
`agente.js` monta o ESC/POS (`escpos.js`) e envia RAW à impressora via
`imprimir-raw.ps1` (P/Invoke `winspool.WritePrinter`). Sem drivers extras: usa a
impressora já instalada no Windows. Acentos em CP850. QR Code via `GS ( k`.

## Requisitos
- Windows com a impressora térmica instalada (ex.: Elgin i7/i9, Bematech, Epson).
- PowerShell (padrão do Windows).
