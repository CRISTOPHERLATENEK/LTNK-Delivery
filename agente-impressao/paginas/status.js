/** Página raiz — confirma visualmente que o agente está rodando. */
'use strict';

function paginaStatus({ versao, impressoras }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Agente de Impressão</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;color:#222}
h1{font-size:20px}.ok{color:#0a7a3d;font-weight:600}ul{padding-left:20px}li{margin:4px 0}
.tag{display:inline-block;background:#f0f0f0;border-radius:6px;padding:2px 8px;font-size:12px;margin-left:6px}
a{color:#ea580c}</style>
</head><body>
<h1>🖨️ Agente de Impressão <span class="tag">v${versao}</span></h1>
<p class="ok">✔ Rodando — pode fechar esta aba e deixar a janela do agente aberta.</p>
<p>Impressoras detectadas:</p>
<ul>${impressoras.map(n => `<li>${n}</li>`).join('') || '<li>(nenhuma encontrada)</li>'}</ul>
<p>No painel: <strong>Config → Impressão → Agente de Impressão → Procurar impressoras</strong>.</p>
<p>Personalizar o cupom fiscal: <a href="/editor">Editor do Cupom Fiscal</a></p>
</body></html>`;
}

module.exports = { paginaStatus };
