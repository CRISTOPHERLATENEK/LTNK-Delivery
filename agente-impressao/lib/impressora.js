/**
 * Comunicação com o Windows: lista impressoras e envia bytes ESC/POS crus
 * (RAW) via spooler, através do PowerShell (imprimir-raw.ps1).
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function ps(args) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', ...args], { encoding: 'utf8', windowsHide: true });
}

/**
 * Empacotado (pkg), __dirname aponta pro filesystem VIRTUAL do snapshot — o
 * PowerShell (processo externo) não enxerga esse caminho. Por isso extraímos
 * o .ps1 pra um arquivo REAL em disco (tmpdir) na primeira vez que precisamos.
 *
 * `raizApp` é o __dirname do agente.js (entry point), passado via
 * `definirRaizApp` — é a base que os assets do pkg (imprimir-raw.ps1) usam.
 * Calcular isso aqui dentro (via __dirname ou require.main) não é confiável:
 * o pkg resolve mal caminhos partindo de um módulo aninhado (lib/) no snapshot.
 */
let raizApp = __dirname;
function definirRaizApp(dir) { raizApp = dir; }

let ps1Real = null;
function caminhoPs1() {
  if (ps1Real) return ps1Real;
  const origem = path.join(raizApp, 'imprimir-raw.ps1');
  const destino = path.join(os.tmpdir(), 'delivery-imprimir-raw.ps1');
  fs.writeFileSync(destino, fs.readFileSync(origem));
  ps1Real = destino;
  return destino;
}

/** Lista as impressoras instaladas no Windows (só o nome — formato usado pelo
 * painel do lojista, GET /impressoras). Não mudar esse formato: o painel web
 * espera um array de strings. */
function listarImpressoras() {
  const r = ps(['-Command', 'Get-Printer | Select-Object -ExpandProperty Name']);
  if (r.status !== 0) return [];
  return r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

/**
 * Versão com status real (Normal/Offline/etc.) — usada só pelo dashboard da
 * janela do app (GET /impressoras/detalhado). Separado de listarImpressoras()
 * de propósito: o painel web (loja-config.tsx) espera um array de strings,
 * não objetos — não dá pra reaproveitar o mesmo endpoint sem quebrá-lo.
 */
function listarImpressorasDetalhado() {
  const r = ps(['-Command',
    'Get-Printer | Select-Object Name, PrinterStatus, WorkOffline, Default | ConvertTo-Json -Compress',
  ]);
  if (r.status !== 0) return [];
  let dados;
  try { dados = JSON.parse(r.stdout || '[]'); } catch { return []; }
  const lista = Array.isArray(dados) ? dados : [dados]; // 1 impressora só = objeto, não array
  return lista.filter(Boolean).map(p => {
    let status = 'pronta';
    if (p.WorkOffline) status = 'offline';
    else if (p.PrinterStatus && p.PrinterStatus !== 'Normal') status = 'atencao';
    return { nome: p.Name, status, motivo: p.PrinterStatus || '', padrao: !!p.Default };
  });
}

/** Manda bytes crus (ESC/POS) para a impressora via RAW. */
function imprimirRaw(impressora, buffer) {
  const arq = path.join(os.tmpdir(), `cupom-${Date.now()}.bin`);
  fs.writeFileSync(arq, buffer);
  try {
    const r = ps(['-ExecutionPolicy', 'Bypass', '-File', caminhoPs1(), '-Printer', impressora, '-File', arq]);
    if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'falha na impressão').trim());
    return true;
  } finally {
    try { fs.unlinkSync(arq); } catch { /* ignore */ }
  }
}

module.exports = { listarImpressoras, listarImpressorasDetalhado, imprimirRaw, definirRaizApp };
