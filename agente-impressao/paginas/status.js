/**
 * Dashboard principal (GET /) — casca do app inteiro: barra lateral +
 * 4 telas (Início / Impressoras / Cupom fiscal / Sobre), tudo num HTML só,
 * sem build step. Troca de tela é só JS (mostra/esconde), sem recarregar —
 * os dados vêm dos mesmos endpoints que o resto do agente já expõe.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DECISÕES DE INTERFACE QUE NÃO SÃO ÓBVIAS NO CÓDIGO
 *
 * SEM EMOJI, EM LUGAR NENHUM. Emoji num app de balcão envelhece a tela e
 * renderiza diferente em cada versão do Windows — o nome do item já diz o que
 * ele é. O único desenho é o ícone real do produto (icone.svg embutido abaixo),
 * em grafite: laranja fica no instalador e na bandeja, não na interface.
 *
 * FONTES SEM DOWNLOAD. A especificação pede Inter e JetBrains Mono, mas este é
 * um agente que roda offline no balcão: um <link> pro Google Fonts trava a
 * renderização até dar timeout quando não há internet. Então as duas entram por
 * pilha de fallback — quem tiver as fontes instaladas vê elas, quem não tiver cai
 * em system-ui e Consolas, que existem em todo Windows. Nada de webfont.
 *
 * MONOESPAÇADA EM TODO DADO TÉCNICO (versão, porta, horário, valor, número de
 * documento). Não é estética: em fonte proporcional os dígitos têm larguras
 * diferentes, então uma coluna de horários ou de valores não alinha e o olho
 * perde a referência ao varrer a lista de cima pra baixo.
 * ─────────────────────────────────────────────────────────────────────────
 */
'use strict';

/*
 * O ícone do produto, embutido. É o mesmo `icone.svg` do projeto, com o `fill`
 * laranja trocado por grafite e sem o `rect` de fundo — dentro de um quadrado já
 * grafite, o fundo colorido do arquivo original viraria um bloco chapado.
 *
 * Embutido e não <img src="/icone.svg"> porque o agente não serve arquivo
 * estático: só existem as rotas de JSON e as três páginas HTML. Servir o arquivo
 * exigiria uma rota nova, e a regra aqui é não mexer em rota.
 */
const { PREVIA_CSS, previaCupomHtml, PREVIA_JS } = require('./cupom-previa');

const LOGO_SVG = `<svg viewBox="0 0 256 256" width="19" height="19" aria-hidden="true">
  <rect x="48" y="96" width="160" height="88" rx="14" fill="#ffffff"/>
  <rect x="72" y="56" width="112" height="56" rx="6" fill="#ffffff"/>
  <rect x="86" y="72" width="84" height="8" rx="4" fill="#1C1917"/>
  <rect x="86" y="88" width="60" height="8" rx="4" fill="#1C1917"/>
  <rect x="70" y="116" width="46" height="24" rx="5" fill="#1C1917"/>
  <circle cx="182" cy="128" r="10" fill="#1C1917"/>
  <rect x="80" y="176" width="96" height="52" rx="4" fill="#ffffff" stroke="#1C1917" stroke-width="8"/>
  <rect x="94" y="192" width="68" height="6" rx="3" fill="#1C1917"/>
  <rect x="94" y="206" width="68" height="6" rx="3" fill="#1C1917"/>
</svg>`;

function paginaStatus({ versao }) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>LTNK — Software de Impressão</title>
<style>
  :root{
    --fundo:#E8E6E1;      --superficie:#FFFFFF;
    --barra:#FBFAF9;      --hairline:#E7E5E1;   --hairline-fraca:#F5F4F1;
    --texto:#1C1917;      --sec:#78716C;        --sec-2:#8C8783;
    --terc:#A8A29E;       --grafite:#1C1917;
    --ok:#3F8F62;         --atencao:#B08442;    --atencao-esc:#8A6431;
    --inativo:#C6C1BB;
    --ui:'Inter','Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;
    --mono:'JetBrains Mono','Cascadia Mono','Consolas','DejaVu Sans Mono',monospace;
    --cupom-larg:252px;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;font-family:var(--ui);color:var(--texto);background:var(--fundo);
    font-size:13px;line-height:1.45;-webkit-font-smoothing:antialiased}
  button,input,textarea{font-family:inherit;font-size:inherit;color:inherit}

  /* A janela tem largura fixa. 'margin:auto' num filho que não encolhe centraliza
     E preserva o lado esquerdo quando não cabe; 'justify-content:center' no pai
     corta a esquerda, porque o overflow negativo fica inalcançável pelo scroll. */
  .wrap{height:100%;overflow:auto;display:flex;padding:0}
  .shell{flex:none;margin:auto;width:100%;min-width:900px;min-height:100%;
    background:var(--superficie);display:flex;flex-direction:column}

  /* ───── Barra de título ───── */
  .titlebar{flex:none;height:36px;display:flex;align-items:center;justify-content:center;
    background:#F7F6F4;border-bottom:1px solid var(--hairline);
    font-size:11.5px;color:var(--sec);white-space:nowrap;user-select:none}

  .corpo{flex:1;display:flex;min-height:0}

  /* ───── Sidebar ───── */
  .sidebar{width:220px;flex:none;background:var(--barra);border-right:1px solid var(--hairline);
    display:flex;flex-direction:column;padding:16px 12px}
  .marca{display:flex;align-items:center;gap:9px;padding:2px 4px 18px}
  .marca .logo{width:30px;height:30px;border-radius:7px;background:var(--grafite);flex:none;
    display:flex;align-items:center;justify-content:center}
  .marca b{display:block;font-size:13px;font-weight:600;line-height:1.2}
  .marca .ver{font-family:var(--mono);font-size:10px;color:var(--terc);line-height:1.4}

  nav{display:flex;flex-direction:column;gap:1px}
  nav button{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;
    background:none;border:0;border-radius:4px;padding:7px 10px;font-size:13px;font-weight:400;
    color:var(--sec);cursor:pointer;white-space:nowrap}
  nav button:hover{background:var(--hairline-fraca);color:var(--texto)}
  nav button.ativo{background:#EFEDEA;color:var(--texto);font-weight:600}
  nav button .cont{font-family:var(--mono);font-size:10.5px;color:var(--terc)}
  nav button.ativo .cont{color:var(--sec)}

  .sidebar-fim{margin-top:auto;padding-top:14px}
  .rodape-status{display:flex;align-items:flex-start;gap:7px;padding:0 4px}
  .rodape-status b{display:block;font-size:11.5px;font-weight:600}
  .rodape-status span{display:block;font-size:10.5px;color:var(--sec-2);line-height:1.35}
  .linha-switch{display:flex;align-items:center;justify-content:space-between;gap:6px;
    margin-top:12px;padding:10px 4px 0;border-top:1px solid var(--hairline)}
  .linha-switch label{font-size:11.5px;color:var(--sec);white-space:nowrap}
  .switch{position:relative;width:32px;height:18px;border-radius:99px;background:var(--inativo);
    border:0;cursor:pointer;flex:none;transition:background .13s}
  .switch::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;transition:left .13s}
  .switch.on{background:var(--grafite)}
  .switch.on::after{left:16px}
  .switch:disabled{opacity:.45;cursor:default}

  .dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--ok);margin-top:5px}
  .dot.mini{margin-top:0}
  .dot.ok{background:var(--ok)} .dot.atencao{background:var(--atencao)} .dot.off{background:var(--inativo)}

  /* ───── Conteúdo ───── */
  main{flex:1;min-width:0;overflow-y:auto;padding:24px 28px 30px}
  .view{display:none}
  .view.ativa{display:block}
  .eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;
    color:var(--terc);margin:0 0 6px}
  h1{font-size:22px;font-weight:600;margin:0;letter-spacing:-.01em}
  .sub{margin:6px 0 0;color:var(--sec);max-width:44ch}
  .cab{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px}

  /* ───── Botões ───── */
  .btn{display:inline-flex;align-items:center;justify-content:center;background:var(--grafite);
    color:#fff;border:1px solid var(--grafite);padding:0 13px;height:30px;border-radius:4px;
    font-weight:500;font-size:12px;cursor:pointer;white-space:nowrap;text-decoration:none}
  .btn:hover{background:#332E2B;border-color:#332E2B}
  .btn.outline{background:transparent;color:var(--texto);border-color:var(--hairline)}
  .btn.outline:hover{background:var(--hairline-fraca);border-color:#D9D5D0}
  .btn.mini{height:26px;padding:0 10px;font-size:11.5px}
  .btn.barra{height:24px;padding:0 10px;font-size:11px}
  .btn:disabled{opacity:.45;cursor:default}

  /* ───── Faixa de métricas: um bloco, divisores internos ───── */
  .metricas{display:flex;border:1px solid var(--hairline);border-radius:6px;margin-bottom:16px;
    background:var(--superficie)}
  .metrica{flex:1;padding:14px 16px;border-left:1px solid var(--hairline-fraca);min-width:0}
  .metrica:first-child{border-left:0}
  .metrica .n{font-family:var(--mono);font-size:26px;font-weight:500;line-height:1.1;
    letter-spacing:-.02em}
  .metrica .l{font-size:11.5px;color:var(--sec);margin-top:3px}

  .bloco{border:1px solid var(--hairline);border-radius:6px;background:var(--superficie);
    margin-bottom:16px}
  .bloco-cab{display:flex;align-items:center;justify-content:space-between;gap:12px;
    padding:11px 16px;border-bottom:1px solid var(--hairline-fraca)}
  .bloco-cab h2{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;
    color:var(--terc);font-weight:400;margin:0}
  .bloco-corpo{padding:14px 16px}

  /* ───── Tabelas de hairline ───── */
  .linha{display:flex;align-items:center;gap:12px;padding:10px 16px;
    border-top:1px solid var(--hairline-fraca)}
  .linha:first-child{border-top:0}
  .linha.padrao{background:var(--barra)}
  .cel-nome{flex:1;min-width:0}
  .cel-nome b{display:block;font-size:13.5px;font-weight:600;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .cel-nome .tec{font-family:var(--mono);font-size:11px;color:var(--sec-2);white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
  .selo{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;border:1px solid var(--hairline);
    border-radius:3px;padding:1px 5px;color:var(--sec);margin-left:7px;vertical-align:1px;
    white-space:nowrap;font-weight:400}
  .cel-status{display:flex;align-items:center;gap:6px;width:112px;flex:none;font-size:12px;
    white-space:nowrap;color:var(--sec)}
  .cel-status.ok{color:var(--ok)} .cel-status.atencao{color:var(--atencao-esc)}
  .cel-hora{font-family:var(--mono);font-size:11.5px;color:var(--sec-2);width:52px;flex:none}
  .cel-doc{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cel-destino{font-family:var(--mono);font-size:11.5px;color:var(--sec-2);width:150px;flex:none;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cel-res{width:78px;flex:none;font-size:11.5px;white-space:nowrap;text-align:right}
  .cel-res.ok{color:var(--ok)} .cel-res.refeito{color:var(--atencao-esc)}
  .radio{width:14px;height:14px;flex:none;accent-color:var(--grafite);cursor:pointer;margin:0}
  .vazio{padding:18px 16px;color:var(--terc);font-size:12.5px;text-align:center}

  /* Nota: filete à esquerda, não caixa colorida — aviso não é alerta. */
  .nota{border-left:2px solid var(--hairline);padding:2px 0 2px 12px;color:var(--sec);
    font-size:12px;max-width:56ch}

  /* ───── Cupom fiscal: formulário + prévia ───── */
  .split{display:flex;gap:20px;align-items:flex-start}
  .split .form{flex:1;min-width:0}
  .previa{width:284px;flex:none;border:1px solid var(--hairline);border-radius:6px;
    background:var(--barra);overflow:hidden;padding-bottom:12px}
  .previa-cab{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;
    border-bottom:1px solid var(--hairline);font-family:var(--mono);font-size:10px;
    letter-spacing:.08em;color:var(--terc);margin-bottom:12px}
${PREVIA_CSS}
  .campo{margin-bottom:18px}
  .campo > label{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.06em;
    text-transform:uppercase;color:var(--terc);margin-bottom:6px}
  textarea{width:100%;padding:8px 10px;border:1px solid var(--hairline);border-radius:4px;
    resize:vertical;min-height:56px;background:var(--superficie)}
  textarea:focus{outline:0;border-color:var(--grafite)}
  .hint{font-size:11px;color:var(--sec-2);margin:5px 0 0}
  .toggle-linha{display:flex;align-items:center;justify-content:space-between;gap:14px;
    padding:12px 0;border-top:1px solid var(--hairline-fraca)}
  .toggle-linha .txt{min-width:0}
  .toggle-linha .txt b{display:block;font-size:12.5px;font-weight:500}
  .toggle-linha .txt span{display:block;font-size:11px;color:var(--sec-2)}

  /* ───── Sobre: tabela chave → valor ───── */
  .kv{border-top:1px solid var(--hairline-fraca)}
  .kv div{display:flex;justify-content:space-between;gap:16px;padding:9px 0;
    border-bottom:1px solid var(--hairline-fraca)}
  .kv dt{color:var(--sec);font-size:12.5px}
  .kv dd{margin:0;font-family:var(--mono);font-size:11.5px;text-align:right;
    max-width:60%;overflow-wrap:anywhere}

  /* ───── Barra de status (estilo IDE) ───── */
  .statusbar{flex:none;height:34px;display:flex;align-items:center;justify-content:space-between;
    gap:12px;padding:0 14px;background:var(--barra);border-top:1px solid var(--hairline)}
  .statusbar .esq{display:flex;align-items:center;gap:7px;font-family:var(--mono);font-size:10.5px;
    color:var(--sec);white-space:nowrap}
  .statusbar .dir{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:10.5px;
    color:var(--terc);white-space:nowrap}
  .statusbar .sujo{display:none;align-items:center;gap:8px}
  .statusbar .sujo.on{display:flex}
  .statusbar .sujo em{font-style:normal;font-size:10.5px;color:var(--atencao-esc);white-space:nowrap}
  .statusbar .versao.escondida{display:none}
  .aviso{font-size:11.5px;white-space:nowrap}
  .aviso.ok{color:var(--ok)} .aviso.erro{color:#A33A32}
</style></head><body>
<div class="wrap"><div class="shell">

  <div class="titlebar">LTNK — Software de Impressão</div>

  <div class="corpo">
    <aside class="sidebar">
      <div class="marca">
        <div class="logo">${LOGO_SVG}</div>
        <div>
          <b>LTNK</b>
          <div class="ver">v${versao}</div>
        </div>
      </div>

      <nav>
        <button data-view="inicio" class="ativo">Início</button>
        <button data-view="impressoras">Impressoras <span class="cont" id="nav-cont"></span></button>
        <button data-view="cupom">Cupom fiscal</button>
        <button data-view="sobre">Sobre</button>
      </nav>

      <div class="sidebar-fim">
        <div class="rodape-status">
          <span class="dot"></span>
          <div>
            <b>Ativo em segundo plano</b>
            <span>Fechar a janela não interrompe a impressão.</span>
          </div>
        </div>
        <div class="linha-switch" id="linha-inicializacao" style="display:none">
          <label for="switch-inicializacao">Abrir com o Windows</label>
          <button class="switch" id="switch-inicializacao" role="switch"
                  aria-checked="false" aria-label="Abrir com o Windows"></button>
        </div>
      </div>
    </aside>

    <main>
      <!-- ───────── Início ───────── -->
      <section class="view ativa" data-view="inicio">
        <p class="eyebrow">Agente local</p>
        <h1>Início</h1>

        <div class="metricas" style="margin-top:18px">
          <div class="metrica"><div class="n" id="m-total">—</div><div class="l">Impressoras detectadas</div></div>
          <div class="metrica"><div class="n" id="m-prontas">—</div><div class="l">Prontas para uso</div></div>
          <div class="metrica"><div class="n" id="m-sessao">0</div><div class="l">Impressões nesta sessão</div></div>
        </div>

        <div class="bloco">
          <div class="bloco-cab"><h2>Impressão padrão</h2></div>
          <div class="bloco-corpo" id="cartao-padrao">
            <div style="color:var(--terc);font-size:12.5px">Carregando…</div>
          </div>
        </div>

        <div class="bloco">
          <div class="bloco-cab"><h2>Últimas impressões</h2></div>
          <div id="historico"><div class="vazio">Nenhuma impressão nesta sessão.</div></div>
        </div>
      </section>

      <!-- ───────── Impressoras ───────── -->
      <section class="view" data-view="impressoras">
        <div class="cab">
          <div>
            <p class="eyebrow">Windows</p>
            <h1>Impressoras</h1>
            <p class="sub">As impressoras instaladas neste computador. Escolha qual é a padrão e teste antes de usar no balcão.</p>
          </div>
          <button class="btn outline" id="btn-atualizar">Atualizar lista</button>
        </div>

        <div class="bloco">
          <div id="lista-impressoras"><div class="vazio">Carregando…</div></div>
        </div>

        <div id="aviso-teste" class="aviso" style="min-height:17px;margin-bottom:14px"></div>
        <p class="nota">A impressora precisa estar instalada no Windows antes de aparecer aqui.</p>
      </section>

      <!-- ───────── Cupom fiscal ───────── -->
      <section class="view" data-view="cupom">
        <p class="eyebrow">DANFE NFC-e</p>
        <h1>Cupom fiscal</h1>
        <p class="sub" style="margin-bottom:20px">O que aparece impresso no cupom deste computador. A prévia ao lado
          acompanha as alterações; salvar vale a partir da próxima impressão.</p>

        <div class="split">
          <div class="form">
            <div class="campo">
              <label for="cabecalho">Mensagem no cabeçalho</label>
              <textarea id="cabecalho" placeholder="Ex.: Promoção: compre 2, leve 3"></textarea>
              <p class="hint">Entra abaixo dos dados da loja, antes do título DANFE NFC-e.</p>
            </div>
            <div class="campo">
              <label for="rodape">Mensagem no rodapé</label>
              <textarea id="rodape" placeholder="Ex.: Siga @sualoja no Instagram"></textarea>
              <p class="hint">Entra no fim do cupom, depois do QR Code.</p>
            </div>

            <div class="toggle-linha">
              <div class="txt"><b>Endereço da loja</b><span>Imprime o endereço do emitente no topo.</span></div>
              <button class="switch" id="sw-endereco" role="switch" aria-checked="false" aria-label="Endereço da loja"></button>
            </div>
            <div class="toggle-linha">
              <div class="txt"><b>QR Code</b><span>Permite consultar a nota no site da Sefaz.</span></div>
              <button class="switch" id="sw-qr" role="switch" aria-checked="false" aria-label="QR Code"></button>
            </div>
            <div class="toggle-linha">
              <div class="txt"><b>Fonte maior</b><span>Recomendado para bobina de 80mm.</span></div>
              <button class="switch" id="sw-fonte" role="switch" aria-checked="false" aria-label="Fonte maior"></button>
            </div>
          </div>

          <div class="previa">
            <div class="previa-cab"><span>Prévia</span><span>80mm</span></div>
            ${previaCupomHtml()}
          </div>
        </div>
      </section>

      <!-- ───────── Sobre ───────── -->
      <section class="view" data-view="sobre">
        <p class="eyebrow">Sobre</p>
        <h1>LTNK</h1>
        <p class="sub" style="margin-bottom:22px">Agente local que imprime cupons e DANFE NFC-e direto na impressora
          térmica, sem o diálogo do navegador. Roda em segundo plano e conversa com o painel da loja pela rede local.</p>

        <dl class="kv">
          <div><dt>Versão</dt><dd>${versao}</dd></div>
          <div><dt>Endereço local</dt><dd>localhost:9110</dd></div>
          <div><dt>Protocolo</dt><dd>ESC/POS via spooler RAW</dd></div>
          <div><dt>Documentos</dt><dd>Pedido, comanda, DANFE NFC-e</dd></div>
          <div><dt>Setores</dt><dd>Roteia por categoria (cozinha, bar)</dd></div>
        </dl>

        <div style="display:flex;gap:8px;margin-top:22px">
          <a class="btn outline" href="/manual" target="_blank" rel="noopener">Abrir manual</a>
          <button class="btn outline" id="btn-diagnostico">Copiar diagnóstico</button>
        </div>
        <div id="aviso-diag" class="aviso" style="min-height:17px;margin-top:10px"></div>
      </section>
    </main>
  </div>

  <div class="statusbar">
    <div class="esq"><span class="dot mini ok"></span> localhost:9110 · conectado</div>
    <div class="dir">
      <span class="versao" id="sb-versao">v${versao}</span>
      <span class="sujo" id="sb-sujo">
        <em>Alterações não salvas</em>
        <button class="btn outline barra" id="btn-descartar">Descartar</button>
        <button class="btn barra" id="btn-salvar">Salvar</button>
      </span>
    </div>
  </div>

</div></div>

<script>
${PREVIA_JS}
function el(id){ return document.getElementById(id); }
function escapar(s){ return String(s).replace(/[&<>"]/g, function(c){
  return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
function hhmm(d){ return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }

var ultimoErro = '';

/* ───── Navegação ───── */
document.querySelectorAll('nav button[data-view]').forEach(function(btn){
  btn.addEventListener('click', function(){ mostrarView(btn.dataset.view); });
});
function mostrarView(nome){
  document.querySelectorAll('nav button[data-view]').forEach(function(b){
    b.classList.toggle('ativo', b.dataset.view === nome);
  });
  document.querySelectorAll('.view').forEach(function(v){
    v.classList.toggle('ativa', v.dataset.view === nome);
  });
  if (nome === 'impressoras') carregarImpressoras();
}

/*
 * A tela abre pelo endereço: /#cupom cai direto na aba do cupom fiscal.
 *
 * Existe porque a página /editor foi removida — ela era uma segunda tela pro
 * mesmo config.json. Quem apontava pra lá (o menu da bandeja e o botão
 * "Editar cupom fiscal" do painel do lojista) agora aponta pra cá, e sem isto
 * os dois cairiam no Início e a pessoa teria que adivinhar o próximo clique.
 *
 * 'hashchange' além do load: o menu da bandeja troca o hash de uma janela que
 * já está aberta, então não há carregamento pra disparar nada.
 */
function abrirPeloHash(){
  var nome = (location.hash || '').replace('#', '');
  if (document.querySelector('.view[data-view=' + JSON.stringify(nome) + ']')) mostrarView(nome);
}
window.addEventListener('hashchange', abrirPeloHash);

/* ─────────────────────────────────────────────────────────────
 * HISTÓRICO DA SESSÃO — e por que a métrica não se chama "hoje".
 *
 * O agente não guarda histórico: cada POST /imprimir é atendido e esquecido.
 * Então o que existe aqui são as impressões que ESTA JANELA viu acontecer.
 *
 * Por isso a métrica diz "Impressões nesta sessão" e não "Cupons hoje": a
 * janela normalmente fica fechada (o agente vive na bandeja), então um contador
 * chamado "hoje" mostraria 0 depois de cinquenta cupons impressos. Métrica que
 * mente é pior que métrica que falta.
 * ───────────────────────────────────────────────────────────── */
var historico = [];
function registrarImpressao(documento, destino, resultado){
  historico.unshift({ hora: hhmm(new Date()), documento: documento, destino: destino, resultado: resultado });
  historico = historico.slice(0, 10);
  el('m-sessao').textContent = historico.length;
  desenharHistorico();
  desenharCartaoPadrao();
}
function desenharHistorico(){
  var alvo = el('historico');
  if (!historico.length){ alvo.innerHTML = '<div class="vazio">Nenhuma impressão nesta sessão.</div>'; return; }
  alvo.innerHTML = historico.map(function(h){
    var cls = h.resultado === 'Impresso' ? 'ok' : 'refeito';
    return '<div class="linha">'
      + '<span class="cel-hora">' + h.hora + '</span>'
      + '<span class="cel-doc">' + escapar(h.documento) + '</span>'
      + '<span class="cel-destino">' + escapar(h.destino) + '</span>'
      + '<span class="cel-res ' + cls + '">' + h.resultado + '</span>'
      + '</div>';
  }).join('');
}

/* ───── Impressoras ───── */
var STATUS_TXT = { pronta:'Pronta', atencao:'Atenção', offline:'Offline' };
var STATUS_CLS = { pronta:'ok', atencao:'atencao', offline:'' };
var DOT_CLS = { pronta:'ok', atencao:'atencao', offline:'off' };
var impressoras = [];
var padraoEscolhida = null;

async function carregarImpressoras(){
  var lista = el('lista-impressoras');
  try {
    var r = await (await fetch('/impressoras/detalhado')).json();
    impressoras = r.impressoras || [];
    el('m-total').textContent = impressoras.length;
    el('m-prontas').textContent = impressoras.filter(function(p){ return p.status === 'pronta'; }).length;
    el('nav-cont').textContent = impressoras.length ? impressoras.length : '';

    if (!impressoras.length){
      lista.innerHTML = '<div class="vazio">Nenhuma impressora instalada neste computador.</div>';
      desenharCartaoPadrao();
      return;
    }
    lista.innerHTML = impressoras.map(function(p, i){
      var ehPadrao = nomePadrao() === p.nome;
      return '<div class="linha' + (ehPadrao ? ' padrao' : '') + '">'
        + '<input class="radio" type="radio" name="padrao" value="' + escapar(p.nome) + '"'
        +   (ehPadrao ? ' checked' : '') + ' aria-label="Definir ' + escapar(p.nome) + ' como padrão">'
        + '<span class="cel-nome"><b title="' + escapar(p.nome) + '">' + escapar(p.nome)
        +   (ehPadrao ? '<span class="selo">PADRÃO</span>' : '') + '</b>'
        +   '<span class="tec">' + escapar(detalheTecnico(p)) + '</span></span>'
        + '<span class="cel-status ' + STATUS_CLS[p.status] + '">'
        +   '<span class="dot mini ' + DOT_CLS[p.status] + '"></span>' + (STATUS_TXT[p.status] || p.status) + '</span>'
        + '<button class="btn outline mini" data-testar="' + escapar(p.nome) + '">Testar</button>'
        + '</div>';
    }).join('');

    lista.querySelectorAll('[data-testar]').forEach(function(b){
      b.addEventListener('click', function(){ testar(b.dataset.testar, b); });
    });
    lista.querySelectorAll('input[name=padrao]').forEach(function(rd){
      rd.addEventListener('change', function(){ definirPadrao(rd.value); });
    });
    desenharCartaoPadrao();
  } catch (e) {
    ultimoErro = 'GET /impressoras/detalhado: ' + e.message;
    lista.innerHTML = '<div class="vazio">Não foi possível ler as impressoras do Windows.</div>';
  }
}

/*
 * A linha técnica mostra o que o agente REALMENTE sabe.
 *
 * O desenho pedia porta/IP aqui (ex.: "USB001"), mas /impressoras/detalhado
 * devolve só { nome, status, motivo, padrao } — o Get-Printer é consultado sem
 * PortName. Preencher com um valor plausível seria inventar dado sobre hardware,
 * que é exatamente o tipo de mentira que faz alguém trocar o cabo da impressora
 * errada. Então mostra o motivo do status quando existe, e "80mm" quando não há
 * nada a dizer. Se um dia PortName entrar na resposta, 'p.porta' aparece aqui
 * sozinho, sem mexer no resto.
 */
function detalheTecnico(p){
  var partes = ['80mm'];
  if (p.porta) partes.push(p.porta);
  if (p.motivo && p.motivo !== 'Normal') partes.push(p.motivo);
  if (p.padrao) partes.push('padrão do Windows');
  return partes.join(' · ');
}

function nomePadrao(){
  if (padraoEscolhida) return padraoEscolhida;
  var doWindows = impressoras.filter(function(p){ return p.padrao; })[0];
  return doWindows ? doWindows.nome : (impressoras[0] ? impressoras[0].nome : null);
}

/*
 * Guarda a escolha em /config, o endpoint que já existe.
 *
 * 'salvarConfig' faz merge do que recebe com o que já está no arquivo, então uma
 * chave nova persiste sem alterar nada do que a impressão fiscal lê — não precisa
 * de rota nova nem de mudança no backend. É a escolha desta máquina, salva onde
 * o resto das preferências desta máquina já mora.
 */
async function definirPadrao(nome){
  padraoEscolhida = nome;
  carregarImpressoras();
  try {
    await fetch('/config', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ impressoraPadrao: nome }) });
  } catch (e) { ultimoErro = 'POST /config (impressoraPadrao): ' + e.message; }
}

function desenharCartaoPadrao(){
  var alvo = el('cartao-padrao');
  var nome = nomePadrao();
  if (!nome){
    alvo.innerHTML = '<div style="color:var(--terc);font-size:12.5px">Nenhuma impressora para usar como padrão.</div>';
    return;
  }
  var p = impressoras.filter(function(x){ return x.nome === nome; })[0] || { status:'pronta' };
  var ultima = historico.filter(function(h){ return h.destino === nome; })[0];
  var tec = detalheTecnico(p) + (ultima ? ' · última impressão ' + ultima.hora : '');
  alvo.innerHTML = '<div style="display:flex;align-items:center;gap:12px">'
    + '<span class="dot mini ' + DOT_CLS[p.status] + '"></span>'
    + '<span class="cel-nome"><b>' + escapar(nome) + '</b><span class="tec">' + escapar(tec) + '</span></span>'
    + '<button class="btn outline mini" id="btn-teste-padrao">Imprimir teste</button></div>';
  el('btn-teste-padrao').addEventListener('click', function(){ testar(nome, el('btn-teste-padrao')); });
}

async function testar(nome, botao){
  var original = botao.textContent;
  botao.disabled = true; botao.textContent = 'Enviando…';
  var aviso = el('aviso-teste');
  try {
    var blocos = [
      { t:'titulo', txt:'TESTE DE IMPRESSAO' },
      { t:'center', txt:new Date().toLocaleString('pt-BR') },
      { t:'linha' },
      { t:'texto', txt:'Se você está lendo isto,' },
      { t:'texto', txt:'a impressora "' + nome + '" está OK.' },
      { t:'corte' },
    ];
    var r = await fetch('/imprimir', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ impressora: nome, largura: 80, blocos: blocos }) });
    var j = await r.json().catch(function(){ return {}; });
    if (r.ok){
      aviso.textContent = 'Enviado para ' + nome;
      aviso.className = 'aviso ok';
      registrarImpressao('Teste de impressão', nome, 'Impresso');
    } else {
      ultimoErro = 'POST /imprimir: ' + (j.erro || 'falha desconhecida');
      aviso.textContent = j.erro || 'Não foi possível imprimir.';
      aviso.className = 'aviso erro';
    }
  } catch (e) {
    ultimoErro = 'POST /imprimir: ' + e.message;
    aviso.textContent = e.message;
    aviso.className = 'aviso erro';
  } finally {
    botao.disabled = false; botao.textContent = original;
    setTimeout(function(){ aviso.textContent = ''; }, 5000);
  }
}
el('btn-atualizar').addEventListener('click', carregarImpressoras);

/* ─────────────────────────────────────────────────────────────
 * CUPOM FISCAL — estado sujo na barra de status.
 *
 * O botão "Salvar" no fim do formulário obrigava a rolar pra descobrir se havia
 * algo pendente. Na barra, o aviso fica visível de qualquer tela e nas duas
 * pontas do formulário. 'salvo' é a referência do que está no disco — o que
 * decide se há alteração é a comparação, não um flag que alguém esquece de
 * limpar depois de salvar.
 * ───────────────────────────────────────────────────────────── */
var salvo = null;
var switches = { mostrarEndereco:'sw-endereco', mostrarQr:'sw-qr', fonteGrande:'sw-fonte' };

function lerFormulario(){
  return {
    cabecalho: el('cabecalho').value,
    rodape: el('rodape').value,
    mostrarEndereco: el('sw-endereco').classList.contains('on'),
    mostrarQr: el('sw-qr').classList.contains('on'),
    fonteGrande: el('sw-fonte').classList.contains('on'),
  };
}
function escreverFormulario(c){
  el('cabecalho').value = c.cabecalho || '';
  el('rodape').value = c.rodape || '';
  Object.keys(switches).forEach(function(k){
    var ligado = k === 'fonteGrande' ? !!c[k] : c[k] !== false;
    var b = el(switches[k]);
    b.classList.toggle('on', ligado);
    b.setAttribute('aria-checked', ligado ? 'true' : 'false');
  });
}
function sujo(){
  if (!salvo) return false;
  var a = lerFormulario();
  return Object.keys(a).some(function(k){ return a[k] !== salvo[k]; });
}
function atualizarBarra(){
  var s = sujo();
  el('sb-sujo').classList.toggle('on', s);
  el('sb-versao').classList.toggle('escondida', s);
}
function aoMudar(){ atualizarBarra(); atualizarPreviaCupom(lerFormulario()); }

['cabecalho','rodape'].forEach(function(id){ el(id).addEventListener('input', aoMudar); });
Object.keys(switches).forEach(function(k){
  var b = el(switches[k]);
  b.addEventListener('click', function(){
    var ligado = !b.classList.contains('on');
    b.classList.toggle('on', ligado);
    b.setAttribute('aria-checked', ligado ? 'true' : 'false');
    aoMudar();
  });
});

el('btn-descartar').addEventListener('click', function(){
  if (salvo) escreverFormulario(salvo);
  aoMudar();
});
el('btn-salvar').addEventListener('click', async function(){
  var b = el('btn-salvar');
  b.disabled = true; b.textContent = 'Salvando…';
  try {
    var corpo = lerFormulario();
    var r = await fetch('/config', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(corpo) });
    if (r.ok) salvo = corpo;
    else ultimoErro = 'POST /config: HTTP ' + r.status;
  } catch (e) {
    ultimoErro = 'POST /config: ' + e.message;
  } finally {
    b.disabled = false; b.textContent = 'Salvar';
    atualizarBarra();
  }
});

async function carregarConfig(){
  try {
    var c = await (await fetch('/config')).json();
    escreverFormulario(c);
    salvo = lerFormulario();
    if (c.impressoraPadrao) padraoEscolhida = c.impressoraPadrao;
  } catch (e) {
    ultimoErro = 'GET /config: ' + e.message;
    salvo = lerFormulario();
  }
  atualizarBarra();
  aoMudar();
}

/* ───── Abrir com o Windows ───── */
async function carregarInicializacao(){
  try {
    var r = await (await fetch('/inicializacao')).json();
    if (!r.suportado) return; // fora do Electron (npm run servidor): o controle nem aparece
    el('linha-inicializacao').style.display = '';
    var t = el('switch-inicializacao');
    t.classList.toggle('on', !!r.ativa);
    t.setAttribute('aria-checked', r.ativa ? 'true' : 'false');
    t.addEventListener('click', async function(){
      var novo = !t.classList.contains('on');
      t.disabled = true;
      var rr = await fetch('/inicializacao', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ativa: novo }) }).then(function(x){ return x.json(); }).catch(function(){ return null; });
      t.disabled = false;
      if (rr && rr.ok){
        t.classList.toggle('on', !!rr.ativa);
        t.setAttribute('aria-checked', rr.ativa ? 'true' : 'false');
      }
    });
  } catch (e) { /* best-effort: sem o controle, o app funciona igual */ }
}

/* ───── Copiar diagnóstico ───── */
el('btn-diagnostico').addEventListener('click', async function(){
  var texto = [
    'LTNK — Software de Impressão',
    'Versão: ${versao}',
    'Endereço: localhost:9110',
    'Data: ' + new Date().toLocaleString('pt-BR'),
    '',
    'Impressoras (' + impressoras.length + '):',
  ].concat(impressoras.length
    ? impressoras.map(function(p){
        return '  - ' + p.nome + ' [' + (STATUS_TXT[p.status] || p.status) + ']'
          + (p.motivo && p.motivo !== 'Normal' ? ' motivo=' + p.motivo : '')
          + (p.padrao ? ' (padrão do Windows)' : '');
      })
    : ['  (nenhuma)']
  ).concat([
    '',
    'Impressora padrão escolhida: ' + (nomePadrao() || '(nenhuma)'),
    'Último erro: ' + (ultimoErro || '(nenhum)'),
  ]).join('\\n');

  var aviso = el('aviso-diag');
  try {
    await navigator.clipboard.writeText(texto);
    aviso.textContent = 'Diagnóstico copiado. Cole na conversa com o suporte.';
    aviso.className = 'aviso ok';
  } catch (e) {
    // clipboard.writeText falha quando a janela não está em foco. O caminho
    // antigo (textarea + execCommand) não depende de foco e cobre esse caso.
    var ta = document.createElement('textarea');
    ta.value = texto; document.body.appendChild(ta); ta.select();
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    aviso.textContent = ok ? 'Diagnóstico copiado.' : 'Não foi possível copiar.';
    aviso.className = 'aviso ' + (ok ? 'ok' : 'erro');
  }
  setTimeout(function(){ aviso.textContent = ''; }, 6000);
});

carregarImpressoras();
carregarConfig();
carregarInicializacao();
desenharHistorico();
abrirPeloHash();
</script>
</body></html>`;
}

module.exports = { paginaStatus };
