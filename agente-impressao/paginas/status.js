/**
 * Dashboard principal (GET /) — casca do app inteiro: barra lateral +
 * 4 telas (Início / Impressoras / Configurações / Sobre), tudo num HTML só,
 * sem build step. Troca de tela é só JS (mostra/esconde), sem recarregar —
 * os dados vêm dos mesmos endpoints que o resto do agente já expõe.
 */
'use strict';

function paginaStatus({ versao }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>LTNK — Software de Impressão</title>
<style>
  :root{ --laranja:#ea580c; --laranja-esc:#c2410c; --verde:#0a7a3d; --amarelo:#b45309; --vermelho:#b91c1c; }
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;margin:0;color:#1f1f1f;background:#fff;
    display:flex;flex-direction:column;height:100vh;overflow:hidden}
  button{font-family:inherit}

  .app{flex:1;display:flex;min-height:0}

  /* ───── Sidebar ───── */
  .sidebar{width:230px;flex-shrink:0;background:#fafaf9;border-right:1px solid #ececec;
    display:flex;flex-direction:column;padding:18px 14px}
  .marca{display:flex;align-items:center;gap:10px;padding:6px 6px 18px}
  .marca .logo{width:38px;height:38px;border-radius:11px;background:var(--laranja);
    display:flex;align-items:center;justify-content:center;font-size:19px;flex-shrink:0}
  .marca b{display:block;font-size:15px;line-height:1.15}
  .marca .sub{font-size:11px;color:#8a8a8a}
  .marca .ver{font-size:10px;color:#bbb}

  nav{display:flex;flex-direction:column;gap:2px}
  nav button{display:flex;align-items:center;gap:10px;text-align:left;background:none;border:0;
    border-radius:10px;padding:10px 12px;font-size:13.5px;font-weight:600;color:#555;
    cursor:pointer;transition:.12s;border-left:3px solid transparent}
  nav button:hover{background:#f0f0ee}
  nav button.ativo{background:#fff3ea;color:var(--laranja);border-left-color:var(--laranja)}
  nav button .ic{font-size:15px;width:18px;text-align:center}

  .sidebar-fim{margin-top:auto;padding-top:14px}
  .status-card{background:#fff;border:1px solid #ececec;border-radius:12px;padding:12px}
  .status-card .linha{display:flex;align-items:flex-start;gap:8px}
  .bolinha{width:9px;height:9px;border-radius:50%;background:var(--verde);flex-shrink:0;margin-top:4px;
    box-shadow:0 0 0 3px rgba(10,122,61,.15)}
  .status-card b{display:block;font-size:12.5px}
  .status-card span{font-size:11px;color:#888;line-height:1.4}
  .toggle-linha{display:flex;align-items:center;justify-content:space-between;gap:6px;
    margin-top:10px;padding-top:10px;border-top:1px solid #f0f0ee}
  .toggle-linha span{font-size:12px;font-weight:600;color:#444}
  .toggle{position:relative;width:36px;height:20px;border-radius:99px;background:#ddd;border:0;
    cursor:pointer;transition:.15s;flex-shrink:0}
  .toggle::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;
    background:#fff;transition:.15s;box-shadow:0 1px 2px rgba(0,0,0,.25)}
  .toggle.on{background:var(--laranja)}
  .toggle.on::after{left:18px}
  .toggle:disabled{opacity:.4;cursor:default}

  /* ───── Conteúdo ───── */
  main{flex:1;min-width:0;overflow-y:auto;padding:26px 30px}
  .cab{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px}
  .cab h1{font-size:21px;margin:0}
  .cab p{margin:3px 0 0;color:#888;font-size:13px}
  .view{display:none}
  .view.ativa{display:block}

  .btn{display:inline-flex;align-items:center;gap:7px;background:var(--laranja);color:#fff;border:0;
    padding:9px 15px;border-radius:10px;font-weight:700;font-size:12.5px;cursor:pointer;transition:.15s;
    text-decoration:none;white-space:nowrap}
  .btn:hover{background:var(--laranja-esc)}
  .btn.outline{background:#fff;color:var(--laranja);border:1.5px solid var(--laranja)}
  .btn.outline:hover{background:#fff7ed}
  .btn.mini{padding:6px 12px;font-size:11.5px;border-radius:8px}
  .btn:disabled{opacity:.5;cursor:default}

  .card{background:#fff;border:1px solid #ececec;border-radius:14px;padding:18px;
    box-shadow:0 1px 3px rgba(0,0,0,.04);margin-bottom:16px}
  .card h2{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:#8a8a8a;margin:0 0 12px}

  /* Lista de impressoras */
  .impressora{display:flex;align-items:center;gap:14px;padding:13px 6px;border-bottom:1px solid #f2f2f0}
  .impressora:last-child{border-bottom:0}
  .impressora .icone{width:42px;height:42px;border-radius:11px;flex-shrink:0;
    display:flex;align-items:center;justify-content:center;font-size:19px;background:#f4f4f2}
  .impressora .info{flex:1;min-width:0}
  .impressora .info b{display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .impressora .linha-status{display:flex;align-items:center;gap:5px;font-size:12px;color:#888;margin-top:1px}
  .impressora .linha-status .ponto{width:7px;height:7px;border-radius:50%}
  .st-pronta .ponto{background:var(--verde)} .st-pronta{color:var(--verde)}
  .st-atencao .ponto{background:var(--amarelo)} .st-atencao{color:var(--amarelo)}
  .st-offline .ponto{background:var(--vermelho)} .st-offline{color:var(--vermelho)}
  .impressora .acoes{display:flex;align-items:center;gap:8px;flex-shrink:0}
  .vazio{color:#999;font-size:13px;padding:16px 6px;text-align:center}

  /* Início */
  .grid-inicio{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:18px}
  .stat{background:#fff;border:1px solid #ececec;border-radius:14px;padding:16px}
  .stat .n{font-size:24px;font-weight:800}
  .stat .l{font-size:12px;color:#888;margin-top:2px}
  .atalhos{display:flex;flex-wrap:wrap;gap:10px}

  /* Configurações (cupom fiscal) */
  label{display:block;font-weight:700;font-size:12.5px;margin:16px 0 6px}
  label:first-of-type{margin-top:0}
  textarea,input[type=text]{width:100%;padding:9px 10px;border:1px solid #d8d8d8;border-radius:9px;
    font-size:13.5px;font-family:inherit}
  textarea{resize:vertical;min-height:52px}
  textarea:focus,input:focus{outline:2px solid var(--laranja);outline-offset:1px;border-color:var(--laranja)}
  .linha-check{display:flex;align-items:center;gap:9px;margin:13px 0}
  .linha-check label{margin:0;font-weight:500;font-size:13px}
  .linha-check input[type=checkbox]{width:17px;height:17px;accent-color:var(--laranja);cursor:pointer}
  .dica-campo{font-size:11px;color:#999;margin-top:3px}
  #msg-config{margin-top:10px;font-size:12.5px;font-weight:600;min-height:16px}

  /* Sobre */
  .sobre-cab{display:flex;align-items:center;gap:14px;margin-bottom:18px}
  .sobre-cab .logo-grande{width:56px;height:56px;border-radius:16px;background:var(--laranja);
    display:flex;align-items:center;justify-content:center;font-size:28px}
  .sobre-lista{font-size:13.5px;line-height:2}
  .sobre-lista b{color:#444}

  /* Rodapé */
  footer{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:12px;
    padding:10px 20px;border-top:1px solid #ececec;background:#fafaf9;font-size:12px;color:#999}
  footer .esq{display:flex;align-items:center;gap:10px}
  footer a.ajuda{color:var(--laranja);font-weight:700;text-decoration:none;border:1.5px solid var(--laranja);
    padding:5px 12px;border-radius:8px}
  footer a.ajuda:hover{background:#fff7ed}
</style></head><body>

  <div class="app">
    <aside class="sidebar">
      <div class="marca">
        <div class="logo">🖨️</div>
        <div>
          <b>LTNK</b>
          <div class="sub">Software de Impressão</div>
          <div class="ver">v${versao}</div>
        </div>
      </div>

      <nav>
        <button data-view="inicio" class="ativo"><span class="ic">🏠</span> Início</button>
        <button data-view="impressoras"><span class="ic">🖨️</span> Impressoras</button>
        <button data-view="configuracoes"><span class="ic">⚙️</span> Configurações</button>
        <button data-view="sobre"><span class="ic">ℹ️</span> Sobre</button>
      </nav>

      <div class="sidebar-fim">
        <div class="status-card">
          <div class="linha">
            <span class="bolinha"></span>
            <div>
              <b>Ativo em segundo plano</b>
              <span>Pode fechar esta janela — o ícone continua na bandeja, perto do relógio.</span>
            </div>
          </div>
          <div class="toggle-linha" id="linha-inicializacao" style="display:none">
            <span>Abrir na inicialização</span>
            <button class="toggle" id="toggle-inicializacao" title="Abrir com o Windows"></button>
          </div>
        </div>
      </div>
    </aside>

    <main>
      <!-- Início -->
      <section class="view ativa" data-view="inicio">
        <div class="cab"><div><h1>Início</h1><p>Resumo rápido do agente neste computador.</p></div></div>
        <div class="grid-inicio">
          <div class="stat"><div class="n" id="ini-total">—</div><div class="l">Impressoras detectadas</div></div>
          <div class="stat"><div class="n" id="ini-prontas">—</div><div class="l">Prontas pra uso</div></div>
          <div class="stat"><div class="n" style="color:var(--verde)">● Ativo</div><div class="l">Status do agente</div></div>
        </div>
        <div class="card">
          <h2>Atalhos</h2>
          <div class="atalhos">
            <button class="btn" data-ir="impressoras">🖨️ Ver impressoras</button>
            <button class="btn outline" data-ir="configuracoes">🧾 Editor do cupom fiscal</button>
            <a class="btn outline" href="/manual" target="_blank" rel="noopener">📖 Abrir manual</a>
          </div>
        </div>
      </section>

      <!-- Impressoras -->
      <section class="view" data-view="impressoras">
        <div class="cab">
          <div><h1>Impressoras Detectadas</h1><p>Selecione uma impressora e teste a impressão.</p></div>
          <button class="btn outline" id="btn-atualizar">🔄 Atualizar lista</button>
        </div>
        <div class="card" style="padding:6px 12px">
          <div id="lista-impressoras"><div class="vazio">Carregando…</div></div>
        </div>
        <div id="msg-teste" style="font-size:12.5px;font-weight:600;min-height:16px"></div>
      </section>

      <!-- Configurações -->
      <section class="view" data-view="configuracoes">
        <div class="cab"><div><h1>Configurações</h1><p>Personaliza o cupom fiscal (DANFE) impresso neste computador.</p></div></div>
        <div class="card">
          <label>Mensagem extra no cabeçalho</label>
          <textarea id="cabecalho" placeholder="Ex.: Promoção: compre 2, leve 3!"></textarea>
          <p class="dica-campo">Aparece logo abaixo dos dados da loja, antes do título "DANFE NFC-e".</p>

          <label>Mensagem extra no rodapé</label>
          <textarea id="rodape" placeholder="Ex.: Siga-nos no Instagram @sualoja"></textarea>
          <p class="dica-campo">Aparece no fim do cupom, depois do QR Code.</p>

          <div class="linha-check"><input type="checkbox" id="mostrarEndereco"><label for="mostrarEndereco">Imprimir endereço da loja</label></div>
          <div class="linha-check"><input type="checkbox" id="mostrarQr"><label for="mostrarQr">Imprimir QR Code de consulta</label></div>
          <div class="linha-check"><input type="checkbox" id="fonteGrande"><label for="fonteGrande">Fonte maior (recomendado bobina 80mm)</label></div>

          <button class="btn" id="btn-salvar-config" style="margin-top:16px">💾 Salvar</button>
          <div id="msg-config"></div>
        </div>
      </section>

      <!-- Sobre -->
      <section class="view" data-view="sobre">
        <div class="cab"><div><h1>Sobre</h1></div></div>
        <div class="card">
          <div class="sobre-cab">
            <div class="logo-grande">🖨️</div>
            <div>
              <div style="font-weight:800;font-size:17px">LTNK — Software de Impressão</div>
              <div style="color:#888;font-size:13px">Versão ${versao}</div>
            </div>
          </div>
          <p style="font-size:13.5px;color:#444">
            Agente local que imprime cupons e DANFE NFC-e direto na impressora térmica, sem
            diálogo do navegador. Roda em segundo plano neste computador e conversa com o painel
            da loja pela rede local (<code>localhost:9110</code>).
          </p>
          <div class="sobre-lista">
            <div><b>Impressão:</b> ESC/POS direto no spooler do Windows (RAW)</div>
            <div><b>Fiscal:</b> DANFE NFC-e com QR Code, cabeçalho/rodapé personalizáveis</div>
            <div><b>Setores:</b> roteia pedidos por categoria (Cozinha/Bar) pra impressoras diferentes</div>
          </div>
        </div>
        <div class="card">
          <h2>Precisa de ajuda?</h2>
          <a class="btn outline" href="/manual" target="_blank" rel="noopener">📖 Abrir manual completo</a>
        </div>
      </section>
    </main>
  </div>

  <footer>
    <div class="esq">
      <span><b>LTNK Software de Impressão</b></span>
      <span>Versão ${versao}</span>
    </div>
    <a class="ajuda" href="/manual" target="_blank" rel="noopener">❓ Precisa de ajuda? Abrir manual</a>
  </footer>

<script>
function el(id){ return document.getElementById(id); }

/* ───── Navegação entre telas ───── */
document.querySelectorAll('nav button[data-view]').forEach(btn => {
  btn.addEventListener('click', () => mostrarView(btn.dataset.view));
});
document.querySelectorAll('[data-ir]').forEach(btn => {
  btn.addEventListener('click', () => mostrarView(btn.dataset.ir));
});
function mostrarView(nome) {
  document.querySelectorAll('nav button[data-view]').forEach(b => b.classList.toggle('ativo', b.dataset.view === nome));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('ativa', v.dataset.view === nome));
  if (nome === 'impressoras') carregarImpressoras();
}

/* ───── Impressoras ───── */
const ICONES = [
  [/pdf/i, '📄'], [/onenote/i, '🗒️'], [/fax/i, '📠'], [/xps|document writer/i, '📄'],
  [/barcode|etiqueta|label/i, '🏷️'],
];
function iconePara(nome) {
  const par = ICONES.find(([re]) => re.test(nome));
  return par ? par[1] : '🖨️';
}
const STATUS_LABEL = { pronta: 'Pronta', atencao: 'Atenção necessária', offline: 'Offline' };

async function carregarImpressoras() {
  const lista = el('lista-impressoras');
  try {
    const r = await (await fetch('/impressoras/detalhado')).json();
    const imps = r.impressoras || [];
    el('ini-total').textContent = imps.length;
    el('ini-prontas').textContent = imps.filter(p => p.status === 'pronta').length;
    if (!imps.length) { lista.innerHTML = '<div class="vazio">Nenhuma impressora encontrada neste computador.</div>'; return; }
    lista.innerHTML = imps.map(p => \`
      <div class="impressora">
        <div class="icone">\${iconePara(p.nome)}</div>
        <div class="info">
          <b title="\${escapar(p.nome)}">\${escapar(p.nome)}</b>
          <div class="linha-status st-\${p.status}"><span class="ponto"></span> \${STATUS_LABEL[p.status] || p.status}\${p.padrao ? ' · Padrão do sistema' : ''}</div>
        </div>
        <div class="acoes">
          <button class="btn mini outline" data-testar="\${escapar(p.nome)}">Testar</button>
        </div>
      </div>\`).join('');
    lista.querySelectorAll('[data-testar]').forEach(b => b.addEventListener('click', () => testar(b.dataset.testar, b)));
  } catch (e) {
    lista.innerHTML = '<div class="vazio">Não foi possível carregar as impressoras.</div>';
  }
}
function escapar(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function testar(nome, botao) {
  const original = botao.textContent;
  botao.disabled = true; botao.textContent = 'Imprimindo…';
  const msg = el('msg-teste');
  try {
    const blocos = [
      { t: 'titulo', txt: 'TESTE DE IMPRESSÃO' },
      { t: 'center', txt: new Date().toLocaleString('pt-BR') },
      { t: 'linha' },
      { t: 'texto', txt: 'Se você está lendo isto,' },
      { t: 'texto', txt: 'a impressora "' + nome + '" está OK.' },
      { t: 'corte' },
    ];
    const r = await fetch('/imprimir', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ impressora: nome, largura: 80, blocos }) });
    const j = await r.json().catch(() => ({}));
    msg.textContent = r.ok ? '✔ Enviado para ' + nome : ('Erro: ' + (j.erro || 'falha desconhecida'));
    msg.style.color = r.ok ? '#0a7a3d' : '#c0392b';
  } catch (e) {
    msg.textContent = 'Erro: ' + e.message; msg.style.color = '#c0392b';
  } finally {
    botao.disabled = false; botao.textContent = original;
    setTimeout(() => { msg.textContent = ''; }, 4000);
  }
}
el('btn-atualizar').addEventListener('click', carregarImpressoras);

/* ───── Configurações (cupom fiscal) ───── */
async function carregarConfig() {
  const c = await (await fetch('/config')).json();
  el('cabecalho').value = c.cabecalho || '';
  el('rodape').value = c.rodape || '';
  el('mostrarQr').checked = c.mostrarQr !== false;
  el('mostrarEndereco').checked = c.mostrarEndereco !== false;
  el('fonteGrande').checked = !!c.fonteGrande;
}
el('btn-salvar-config').addEventListener('click', async () => {
  const corpo = {
    cabecalho: el('cabecalho').value, rodape: el('rodape').value,
    mostrarQr: el('mostrarQr').checked, mostrarEndereco: el('mostrarEndereco').checked,
    fonteGrande: el('fonteGrande').checked,
  };
  const r = await fetch('/config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(corpo) });
  const msg = el('msg-config');
  msg.textContent = r.ok ? '✔ Salvo! Vale para a próxima impressão fiscal.' : 'Erro ao salvar.';
  msg.style.color = r.ok ? '#0a7a3d' : '#c0392b';
});

/* ───── Abrir na inicialização ───── */
async function carregarInicializacao() {
  try {
    const r = await (await fetch('/inicializacao')).json();
    if (!r.suportado) return; // fora do app Electron (ex.: rodando via npm run servidor) — some o controle
    el('linha-inicializacao').style.display = '';
    const t = el('toggle-inicializacao');
    t.classList.toggle('on', !!r.ativa);
    t.addEventListener('click', async () => {
      const novo = !t.classList.contains('on');
      t.disabled = true;
      const rr = await fetch('/inicializacao', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ ativa: novo }) }).then(x => x.json()).catch(() => null);
      t.disabled = false;
      if (rr && rr.ok) t.classList.toggle('on', !!rr.ativa);
    });
  } catch { /* best-effort */ }
}

carregarImpressoras();
carregarConfig();
carregarInicializacao();
</script>
</body></html>`;
}

module.exports = { paginaStatus };
