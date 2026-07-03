/**
 * Config do CUPOM FISCAL (DANFE), por PC — editada no painel /editor.
 * Fica em %USERPROFILE%\.delivery-agente\config.json (não precisa de admin
 * pra escrever, ao contrário de Program Files).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const PASTA_CONFIG = path.join(os.homedir(), '.delivery-agente');
const ARQ_CONFIG = path.join(PASTA_CONFIG, 'config.json');

const CONFIG_PADRAO = {
  cabecalho: '',       // mensagem extra logo abaixo do endereço da loja
  rodape: '',          // mensagem extra no fim do cupom fiscal
  mostrarQr: true,      // imprime o QR Code do DANFE
  mostrarEndereco: true,// imprime o endereço do emitente
  fonteGrande: false,   // fonte maior (recomendado bobina 80mm)
};

function lerConfig() {
  try { return { ...CONFIG_PADRAO, ...JSON.parse(fs.readFileSync(ARQ_CONFIG, 'utf8')) }; }
  catch { return { ...CONFIG_PADRAO }; }
}

function salvarConfig(parcial) {
  const novo = { ...lerConfig(), ...parcial };
  fs.mkdirSync(PASTA_CONFIG, { recursive: true });
  fs.writeFileSync(ARQ_CONFIG, JSON.stringify(novo, null, 2));
  return novo;
}

module.exports = { CONFIG_PADRAO, lerConfig, salvarConfig };
