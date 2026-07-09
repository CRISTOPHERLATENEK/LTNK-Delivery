/**
 * "Abrir na inicialização" (iniciar com o Windows) — só existe quando rodando
 * DENTRO do Electron (main.js). Rodando via `node agente.js`/`npm run servidor`
 * (sem Electron), fica desativado com segurança: NUNCA fazer `require('electron')`
 * fora de um processo Electron — isso devolve uma STRING (caminho do binário),
 * não a API, e quebraria tudo.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// Marca se já decidimos o padrão de "abrir na inicialização" alguma vez —
// sem isso, forçaríamos openAtLogin=true TODA hora que o app abrisse, e o
// usuário nunca conseguiria desligar de vez pela tela de Configurações.
const ARQ_MARCA = path.join(os.homedir(), '.delivery-agente', 'inicializacao-configurada');

function primeiraVez() {
  return !fs.existsSync(ARQ_MARCA);
}

function marcarConfigurada() {
  try { fs.mkdirSync(path.dirname(ARQ_MARCA), { recursive: true }); fs.writeFileSync(ARQ_MARCA, '1'); }
  catch { /* ignore */ }
}

function suportado() {
  return !!process.versions.electron;
}

function estaAtiva() {
  if (!suportado()) return false;
  try { return !!require('electron').app.getLoginItemSettings().openAtLogin; }
  catch { return false; }
}

function definir(ativa) {
  if (!suportado()) return false;
  try {
    require('electron').app.setLoginItemSettings({ openAtLogin: !!ativa, path: process.execPath });
    marcarConfigurada();
    return true;
  } catch { return false; }
}

module.exports = { suportado, estaAtiva, definir, primeiraVez, marcarConfigurada };
