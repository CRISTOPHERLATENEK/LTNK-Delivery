/**
 * Página raiz (GET /) — dashboard de status do agente. Servida pelo próprio
 * agente e mostrada tanto dentro da janela Electron quanto se alguém abrir
 * http://localhost:9110 num navegador comum (os dois cenários funcionam).
 */
'use strict';

function paginaStatus({ versao, impressoras }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>LTNK — Software de Impressão</title>
<style>
  :root{ --laranja:#ea580c; --laranja-esc:#c2410c; --verde:#0a7a3d; }
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;background:#f4f4f2;margin:0;padding:22px 20px 28px;color:#1f1f1f}
  .topo{display:flex;align-items:center;gap:10px;margin-bottom:18px}
  .topo .emoji{font-size:26px}
  h1{font-size:17px;margin:0;line-height:1.2}
  .versao{font-size:11px;color:#999;font-weight:500}

  .status{display:flex;align-items:center;gap:9px;background:#fff;border:1px solid #ececec;
    border-radius:14px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.06);margin-bottom:16px}
  .bolinha{width:11px;height:11px;border-radius:50%;background:var(--verde);flex-shrink:0;
    box-shadow:0 0 0 4px rgba(10,122,61,.15)}
  .status b{display:block;font-size:14px}
  .status span{font-size:12px;color:#777}

  .card{background:#fff;border-radius:14px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.06);
    border:1px solid #ececec;margin-bottom:14px}
  .card h2{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:#8a8a8a;margin:0 0 12px}

  .impressora{display:flex;align-items:center;justify-content:space-between;gap:10px;
    padding:10px 12px;border-radius:10px;border:1px solid #ececec;margin-bottom:8px;font-size:13.5px}
  .impressora:last-child{margin-bottom:0}
  .impressora .nome{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .btn-mini{border:1px solid #ddd;background:#fafafa;color:#444;font-size:11.5px;font-weight:600;
    padding:5px 10px;border-radius:8px;cursor:pointer;flex-shrink:0;transition:.15s}
  .btn-mini:hover{background:#f0f0f0}
  .btn-mini:disabled{opacity:.5;cursor:default}
  .vazio{color:#999;font-size:13px;padding:6px 2px}

  .acoes{display:flex;flex-direction:column;gap:8px}
  a.btn, button.btn{display:flex;align-items:center;justify-content:center;gap:8px;
    text-decoration:none;background:var(--laranja);color:#fff;border:0;padding:11px 16px;
    border-radius:11px;font-weight:700;font-size:13.5px;cursor:pointer;transition:background .15s}
  a.btn:hover, button.btn:hover{background:var(--laranja-esc)}
  a.btn.outline, button.btn.outline{background:#fff;color:var(--laranja);border:1.5px solid var(--laranja)}
  a.btn.outline:hover, button.btn.outline:hover{background:#fff7ed}

  .rodape{text-align:center;font-size:11px;color:#aaa;margin-top:18px;line-height:1.6}
  #msg{text-align:center;font-size:12px;font-weight:600;min-height:16px;margin-top:6px}
</style></head><body>

  <div class="topo">
    <span class="emoji">🖨️</span>
    <div>
      <h1>Software de Impressão</h1>
      <div class="versao">v${versao} · LTNK</div>
    </div>
  </div>

  <div class="status">
    <span class="bolinha"></span>
    <div>
      <b>Ativo em segundo plano</b>
      <span>Pode fechar esta janela — o ícone continua na bandeja, perto do relógio.</span>
    </div>
  </div>

  <div class="card">
    <h2>Impressoras detectadas</h2>
    ${impressoras.length
      ? impressoras.map(n => `
        <div class="impressora">
          <span class="nome" title="${escapar(n)}">${escapar(n)}</span>
          <button class="btn-mini" data-nome="${escapar(n)}">Testar</button>
        </div>`).join('')
      : `<div class="vazio">Nenhuma impressora encontrada neste computador.</div>`}
  </div>

  <div class="card">
    <h2>Ações</h2>
    <div class="acoes">
      <a class="btn outline" href="/editor" target="_blank" rel="noopener">🧾 Editor do cupom fiscal</a>
      <button class="btn outline" onclick="location.reload()">🔄 Atualizar lista de impressoras</button>
    </div>
    <div id="msg"></div>
  </div>

  <div class="rodape">
    No painel: <b>Config → Impressão → Procurar impressoras</b><br>
    Feche pelo X pra minimizar. Pra sair de vez, use o ícone da bandeja.
  </div>

<script>
document.querySelectorAll('.btn-mini[data-nome]').forEach(botao => {
  botao.addEventListener('click', () => testar(botao.dataset.nome, botao));
});

async function testar(nome, botao) {
  const original = botao.textContent;
  botao.disabled = true; botao.textContent = 'Imprimindo…';
  const msg = document.getElementById('msg');
  try {
    const blocos = [
      { t: 'titulo', txt: 'TESTE DE IMPRESSÃO' },
      { t: 'center', txt: new Date().toLocaleString('pt-BR') },
      { t: 'linha' },
      { t: 'texto', txt: 'Se você está lendo isto,' },
      { t: 'texto', txt: 'a impressora "' + nome + '" está OK.' },
      { t: 'corte' },
    ];
    const r = await fetch('/imprimir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ impressora: nome, largura: 80, blocos }),
    });
    const j = await r.json().catch(() => ({}));
    msg.textContent = r.ok ? '✔ Enviado para ' + nome : ('Erro: ' + (j.erro || 'falha desconhecida'));
    msg.style.color = r.ok ? '#0a7a3d' : '#c0392b';
  } catch (e) {
    msg.textContent = 'Erro: ' + e.message;
    msg.style.color = '#c0392b';
  } finally {
    botao.disabled = false; botao.textContent = original;
    setTimeout(() => { msg.textContent = ''; }, 4000);
  }
}
</script>
</body></html>`;
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
}

module.exports = { paginaStatus };
