/**
 * Agente de Impressão (nosso, próprio).
 *
 * Roda no PC do caixa e escuta em http://localhost:9110. O painel (navegador
 * OU app) envia o cupom em "blocos"; o agente gera ESC/POS e manda DIRETO na
 * térmica pelo spooler do Windows (RAW), sem diálogo.
 *
 * Módulos: lib/config (persistência do editor), lib/impressora (Windows/RAW),
 * lib/fiscal (aplica a config no cupom fiscal), paginas/* (HTML servido).
 */
'use strict';
const http = require('http');
const { montarEscpos } = require('./escpos');
const { lerConfig, salvarConfig } = require('./lib/config');
const { listarImpressoras, imprimirRaw, definirRaizApp } = require('./lib/impressora');
definirRaizApp(__dirname); // __dirname aqui é confiável (agente.js = entry point do pkg)
const { aplicarConfigFiscal } = require('./lib/fiscal');
const { paginaStatus } = require('./paginas/status');
const { paginaEditor } = require('./paginas/editor');

const PORTA = Number(process.env.AGENTE_PORTA) || 9110;
const VERSAO = '1.1.0';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, code, obj) { cors(res); res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function html(res, corpo) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(corpo); }
function corpoJson(req, cb) {
  let corpo = '';
  req.on('data', c => { corpo += c; if (corpo.length > 5e6) req.destroy(); });
  req.on('end', () => cb(corpo));
}

const servidor = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
    return html(res, paginaStatus({ versao: VERSAO, impressoras: listarImpressoras() }));
  }
  if (req.method === 'GET' && req.url === '/editor') {
    return html(res, paginaEditor());
  }
  if (req.method === 'GET' && req.url === '/status') {
    return json(res, 200, { ok: true, agente: 'delivery-print', versao: VERSAO });
  }
  if (req.method === 'GET' && req.url === '/impressoras') {
    return json(res, 200, { impressoras: listarImpressoras() });
  }
  if (req.method === 'GET' && req.url === '/config') {
    return json(res, 200, lerConfig());
  }
  if (req.method === 'POST' && req.url === '/config') {
    return corpoJson(req, corpo => {
      try { json(res, 200, salvarConfig(JSON.parse(corpo || '{}'))); }
      catch (e) { json(res, 400, { erro: String((e && e.message) || e) }); }
    });
  }
  if (req.method === 'POST' && req.url === '/imprimir') {
    return corpoJson(req, corpo => {
      try {
        const { impressora, largura, blocos: recebidos, ehFiscal } = JSON.parse(corpo || '{}');
        if (!impressora) return json(res, 400, { erro: 'Informe a impressora.' });
        if (!Array.isArray(recebidos) || recebidos.length === 0) return json(res, 400, { erro: 'Nada para imprimir.' });
        const blocos = ehFiscal ? aplicarConfigFiscal(recebidos) : recebidos;
        const buffer = montarEscpos({ largura: largura || 80, blocos });
        imprimirRaw(impressora, buffer);
        json(res, 200, { ok: true, bytes: buffer.length });
      } catch (e) {
        json(res, 500, { erro: String((e && e.message) || e) });
      }
    });
  }
  json(res, 404, { erro: 'rota desconhecida' });
});

// Sem isso, um erro ao abrir a porta (ex.: já tem outra cópia do agente
// rodando) é um evento 'error' SEM listener — o Node trata isso como exceção
// não tratada e derruba o processo inteiro (a janela do Electron não tem
// chance de mostrar nada, fica em branco/"Error"). Com o listener, o erro só
// é registrado e module.exports.erroPorta fica disponível pra quem chamou
// require('./agente.js') (o main.js do Electron) decidir o que fazer.
let erroPorta = null;
servidor.on('error', (err) => {
  erroPorta = err;
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Porta ${PORTA} já está em uso — outra cópia do agente já deve estar rodando.`);
  } else {
    console.error('❌ Erro no servidor do agente:', err);
  }
});

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(` LTNK SOFTWARE v${VERSAO} rodando em http://localhost:${PORTA}`);
  console.log('   Deixe esta janela aberta. Impressoras:', listarImpressoras().join(', ') || '(nenhuma)');
});

module.exports = { servidor, PORTA, get erroPorta() { return erroPorta; } };
