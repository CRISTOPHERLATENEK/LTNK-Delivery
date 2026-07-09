/**
 * Processo principal do Electron — a "janela de verdade" do Software de
 * Impressão. Substitui o console cru que existia antes.
 *
 * O SERVIDOR (agente.js, que escuta em http://localhost:9110) continua
 * exatamente o mesmo — é só um módulo Node normal, roda igual dentro do
 * processo principal do Electron. Este arquivo só adiciona a CASCA visual:
 * uma janela mostrando o status (a mesma página HTML servida em GET /,
 * agora redesenhada) e um ícone na bandeja do Windows pra minimizar sem
 * fechar o agente.
 */
'use strict';
const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog } = require('electron');
const path = require('path');
const inicializacao = require('./lib/inicializacao');

const PORTA = Number(process.env.AGENTE_PORTA) || 9110;
const ICONE = path.join(__dirname, 'icone.ico');

// Muitos PCs de caixa/balcão rodam em ambiente virtualizado, acesso remoto
// (RDP) ou com driver de vídeo limitado — nesses casos o processo de GPU do
// Chromium falha ("GPU process exited unexpectedly") e a janela renderiza em
// branco mesmo com a página carregada certinho. Desabilitar a aceleração de
// hardware evita esse problema (usa renderização por software, mais lenta
// mas sempre funciona — a janela é simples, não precisa de GPU).
app.disableHardwareAcceleration();
// Em alguns ambientes (RDP/virtualizado no Windows) mesmo com a GPU
// desabilitada o compositor do Chromium ainda usa DirectComposition e a
// janela fica com um "buffer velho" (só as bordas repintam). Essa flag
// força o compositor por software de verdade.
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-direct-composition');

// Só uma instância — evita dois agentes brigando pela porta 9110 e dois
// ícones duplicados na bandeja.
const temLock = app.requestSingleInstanceLock();
if (!temLock) {
  app.quit();
} else {
  let janela = null;
  let bandeja = null;
  let saindoDeVerdade = false;

  app.on('second-instance', () => {
    // Alguém tentou abrir de novo (ex.: clicou no atalho outra vez) — só
    // traz a janela existente pra frente em vez de abrir uma segunda.
    if (janela) { if (janela.isMinimized()) janela.restore(); janela.show(); janela.focus(); }
  });

  function criarJanela() {
    janela = new BrowserWindow({
      width: 920,
      height: 640,
      resizable: true,
      minWidth: 680,
      minHeight: 460,
      icon: ICONE,
      title: 'LTNK — Software de Impressão',
      autoHideMenuBar: true, // esconde a barra de menu padrão do Electron (File/Edit/View...)
      backgroundColor: '#f4f4f2',
    });
    janela.loadURL(`http://localhost:${PORTA}/`);
    if (process.env.LTNK_DEBUG === '1') {
      janela.webContents.on('console-message', (_e, level, message, line, sourceId) => {
        console.log(`[renderer console:${level}] ${message} (${sourceId}:${line})`);
      });
      janela.webContents.on('did-fail-load', (_e, code, desc, url) => {
        console.log(`[did-fail-load] code=${code} desc=${desc} url=${url}`);
      });
      janela.webContents.on('did-finish-load', () => {
        console.log('[did-finish-load] ok, url=' + janela.webContents.getURL());
      });
    }

    // Links externos (ex.: "abrir painel do lojista") abrem no navegador
    // padrão, não dentro da janela do agente.
    janela.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // Fechar (X) minimiza pra bandeja em vez de encerrar — o agente precisa
    // continuar rodando em segundo plano pra imprimir os cupons. Só sai de
    // verdade pelo menu da bandeja ("Sair").
    janela.on('close', (e) => {
      if (!saindoDeVerdade) {
        e.preventDefault();
        janela.hide();
      }
    });
  }

  function criarBandeja() {
    const icone = nativeImage.createFromPath(ICONE);
    bandeja = new Tray(icone.isEmpty() ? icone : icone.resize({ width: 16, height: 16 }));
    bandeja.setToolTip('LTNK — Software de Impressão (ativo)');
    bandeja.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir', click: () => { janela.show(); janela.focus(); } },
      { label: 'Editor do cupom fiscal', click: () => shell.openExternal(`http://localhost:${PORTA}/editor`) },
      { type: 'separator' },
      { label: 'Sair', click: () => { saindoDeVerdade = true; app.quit(); } },
    ]));
    bandeja.on('click', () => { janela.isVisible() ? janela.hide() : (janela.show(), janela.focus()); });
  }

  app.whenReady().then(() => {
    const agente = require('./agente.js'); // sobe o servidor HTTP em localhost:9110 (mesmo de sempre)

    // Espera o servidor REALMENTE terminar de subir (listen é assíncrono)
    // antes de abrir a janela — carregar a URL cedo demais mostra a tela de
    // erro do Chromium ("Error" no título) mesmo quando tudo ia dar certo
    // um instante depois.
    function prosseguir() {
      if (agente.erroPorta) {
        // Outra cópia do agente já está rodando (porta 9110 ocupada) — avisa
        // com uma mensagem clara em vez de deixar a janela em branco/quebrada.
        dialog.showErrorBox(
          'LTNK já está em execução',
          'Já existe uma cópia do Software de Impressão rodando neste computador ' +
          '(porta 9110 ocupada). Verifique o ícone perto do relógio antes de abrir de novo.',
        );
        app.quit();
        return;
      }
      criarJanela();
      criarBandeja();
    }

    if (agente.servidor.listening) prosseguir();
    else {
      agente.servidor.once('listening', prosseguir);
      agente.servidor.once('error', prosseguir);
    }

    // Só define o padrão (ligado) na PRIMEIRA vez que o app abre — depois
    // disso, quem manda é o toggle "Abrir na inicialização" em Configurações.
    // Forçar isso toda vez impediria o usuário de desligar de vez.
    if (app.isPackaged && inicializacao.suportado() && inicializacao.primeiraVez()) {
      inicializacao.definir(true);
    }
  });

  // No Windows, fechar todas as janelas normalmente encerraria o app — aqui
  // NÃO queremos isso (o agente deve continuar rodando minimizado). Só o
  // menu "Sair" da bandeja realmente encerra (via app.quit() com a flag).
  app.on('window-all-closed', (e) => { e?.preventDefault?.(); });
}
