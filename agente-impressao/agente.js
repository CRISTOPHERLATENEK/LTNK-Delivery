/**
 * Agente de Impressão (nosso, próprio).
 *
 * Roda no PC do caixa e escuta em http://localhost:9110. O painel (navegador
 * OU app) envia o cupom em "blocos"; o agente gera ESC/POS e manda DIRETO na
 * térmica pelo spooler do Windows (RAW), sem diálogo.
 *
 * Módulos: lib/config (persistência do cupom fiscal), lib/impressora (Windows/RAW),
 * lib/fiscal (aplica a config no cupom fiscal), paginas/* (HTML servido).
 */
'use strict';
const http = require('http');
const { montarEscpos } = require('./escpos');
const { lerConfig, salvarConfig } = require('./lib/config');
const { listarImpressoras, listarImpressorasDetalhado, imprimirRaw, definirRaizApp } = require('./lib/impressora');
definirRaizApp(__dirname); // __dirname aqui é confiável (agente.js = entry point do pkg)
const { aplicarConfigFiscal } = require('./lib/fiscal');
const inicializacao = require('./lib/inicializacao');
const { paginaStatus } = require('./paginas/status');
const { paginaManual } = require('./paginas/manual');

const PORTA = Number(process.env.AGENTE_PORTA) || 9110;
/*
 * A versão vem do package.json, não de uma constante aqui.
 *
 * Eram dois números pra manter em sincronia, e no dia em que divergissem o
 * lojista veria uma versão na tela Sobre e outra no instalador — e o suporte
 * pediria "qual sua versão?" pra receber a resposta errada. package.json está
 * na lista `files` do electron-builder, então funciona também dentro do asar.
 */
const VERSAO = require('./package.json').version;

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
    return html(res, paginaStatus({ versao: VERSAO }));
  }
  /*
   * /editor era uma SEGUNDA tela pra editar o mesmo config.json que a aba
   * "Cupom fiscal" da janela já edita — duas telas, duas prévias, um arquivo.
   * A página saiu; a rota fica porque tem dois consumidores fora daqui: o menu
   * da bandeja (main.js) e o botão "Editar cupom fiscal" do painel do lojista
   * (frontend/src/lib/agente.ts). Redirecionar é o que mantém os dois
   * funcionando, inclusive nas versões do agente já instaladas por aí.
   */
  if (req.method === 'GET' && req.url === '/editor') {
    res.writeHead(302, { Location: '/#cupom' });
    return res.end();
  }
  if (req.method === 'GET' && req.url === '/manual') {
    return html(res, paginaManual({ versao: VERSAO }));
  }
  if (req.method === 'GET' && req.url === '/status') {
    return json(res, 200, { ok: true, agente: 'delivery-print', versao: VERSAO });
  }
  if (req.method === 'GET' && req.url === '/impressoras') {
    return json(res, 200, { impressoras: listarImpressoras() });
  }
  if (req.method === 'GET' && req.url === '/impressoras/detalhado') {
    return json(res, 200, { impressoras: listarImpressorasDetalhado() });
  }
  if (req.method === 'GET' && req.url === '/inicializacao') {
    return json(res, 200, { suportado: inicializacao.suportado(), ativa: inicializacao.estaAtiva() });
  }
  if (req.method === 'POST' && req.url === '/inicializacao') {
    return corpoJson(req, corpo => {
      try {
        const { ativa } = JSON.parse(corpo || '{}');
        const ok = inicializacao.definir(!!ativa);
        json(res, ok ? 200 : 400, { ok, suportado: inicializacao.suportado(), ativa: inicializacao.estaAtiva() });
      } catch (e) { json(res, 400, { erro: String((e && e.message) || e) }); }
    });
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
