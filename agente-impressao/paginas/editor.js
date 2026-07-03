/**
 * Página do Editor do Cupom Fiscal — HTML autocontido (sem build step),
 * servido pelo próprio agente em GET /editor. Preview segue FIELMENTE o
 * layout OFICIAL da NFC-e do sistema (mesmo do DANFE real impresso), pra não
 * divergir do que sai na térmica de verdade — ver montarBlocosDanfe no painel
 * e lib/fiscal.js (mesmo ponto de inserção de cabeçalho/rodapé aqui usado).
 */
'use strict';

function paginaEditor() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Editor do Cupom Fiscal</title>
<style>
  :root{ --laranja:#ea580c; --laranja-esc:#c2410c; }
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;background:#f4f4f2;margin:0;padding:32px 16px;color:#1f1f1f}
  .wrap{max-width:920px;margin:0 auto;display:grid;grid-template-columns:1fr 340px;gap:32px;align-items:start}
  @media (max-width:820px){.wrap{grid-template-columns:1fr}}
  h1{font-size:20px;margin:0 0 4px;display:flex;align-items:center;gap:8px}
  .sub{color:#666;font-size:13px;margin:0 0 24px}
  .card{background:#fff;border-radius:14px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1px solid #ececec}
  label{display:block;font-weight:600;font-size:13px;margin:18px 0 6px}
  label:first-of-type{margin-top:0}
  textarea,input[type=text]{width:100%;padding:9px 10px;border:1px solid #d8d8d8;border-radius:9px;font-size:14px;font-family:inherit}
  textarea{resize:vertical;min-height:56px}
  textarea:focus,input:focus{outline:2px solid var(--laranja);outline-offset:1px;border-color:var(--laranja)}
  .linha{display:flex;align-items:center;gap:9px;margin:14px 0}
  .linha label{margin:0;font-weight:500}
  .linha input[type=checkbox]{width:18px;height:18px;accent-color:var(--laranja);cursor:pointer}
  .dica{font-size:11.5px;color:#8a8a8a;margin-top:3px}
  button{margin-top:22px;background:var(--laranja);color:#fff;border:0;padding:11px 20px;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;transition:background .15s}
  button:hover{background:var(--laranja-esc)}
  #msg{margin-top:12px;font-size:13px;font-weight:600;min-height:18px}
  .avisin{background:#fff7ed;border:1px solid #fed7aa;border-radius:9px;padding:10px 12px;font-size:12px;color:#9a3412;margin-bottom:18px}

  /* Preview — segue o layout OFICIAL do DANFE (bobina térmica) */
  .preview-titulo{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#999;margin:0 0 10px;text-align:center}
  .receipt{width:300px;margin:0 auto;background:#fffdf7;padding:18px 16px 4px;
    font-family:'Courier New',monospace;font-size:11.5px;line-height:1.55;color:#111;
    box-shadow:0 6px 18px rgba(0,0,0,.14);}
  .receipt.grande{font-size:13px}
  .r-center{text-align:center}
  .r-b{font-weight:700}
  .r-nome{font-size:15px}
  .receipt.grande .r-nome{font-size:16.5px}
  .r-sep{border:0;border-top:1.5px dashed #b8b8b0;margin:7px 0}
  .r-row{display:flex;justify-content:space-between;gap:8px}
  .r-total{font-weight:700;font-size:13.5px}
  .receipt.grande .r-total{font-size:15px}
  .r-qr{width:70px;height:70px;margin:8px auto 4px;
    background:repeating-conic-gradient(#111 0% 25%, transparent 0% 50%) 0 0/9px 9px;
    border:6px solid #fffdf7;outline:1px solid #ddd}
  .r-item-desc{margin-top:5px}
  .r-item-linha{color:#333}
  .r-quebra{word-break:break-all}
  .zigzag{height:11px;width:300px;margin:0 auto;
    background:linear-gradient(-45deg,transparent 8px,#f4f4f2 0) 0 0,linear-gradient(45deg,transparent 8px,#f4f4f2 0) 0 0;
    background-size:16px 16px;background-repeat:repeat-x;background-color:#fffdf7}
</style></head><body>
<div class="wrap">

  <div>
    <h1>🧾 Editor do Cupom Fiscal</h1>
    <p class="sub">Personaliza o DANFE (cupom fiscal) desta impressora/PC — segue o layout oficial da NFC-e do sistema.</p>
    <div class="avisin">A prévia ao lado é o mesmo layout que sai na SEFAZ/impressora real — cabeçalho e rodapé entram nos mesmos pontos aqui e na impressão de verdade.</div>

    <div class="card">
      <label>Mensagem extra no cabeçalho</label>
      <textarea id="cabecalho" placeholder="Ex.: Promoção: compre 2, leve 3!"></textarea>
      <p class="dica">Aparece logo abaixo dos dados da loja, antes do título "DANFE NFC-e".</p>

      <label>Mensagem extra no rodapé</label>
      <textarea id="rodape" placeholder="Ex.: Siga-nos no Instagram @sualoja"></textarea>
      <p class="dica">Aparece no fim do cupom, depois do QR Code, antes do corte.</p>

      <div class="linha"><input type="checkbox" id="mostrarEndereco"><label for="mostrarEndereco">Imprimir endereço da loja</label></div>
      <div class="linha"><input type="checkbox" id="mostrarQr"><label for="mostrarQr">Imprimir QR Code de consulta</label></div>
      <div class="linha"><input type="checkbox" id="fonteGrande"><label for="fonteGrande">Fonte maior (recomendado bobina 80mm)</label></div>

      <button onclick="salvar()">Salvar</button>
      <div id="msg"></div>
    </div>
  </div>

  <div>
    <p class="preview-titulo">Prévia do DANFE NFC-e</p>
    <div class="receipt" id="receipt">
      <div class="r-center r-b r-nome">Sua Loja</div>
      <div class="r-center">Sua Loja LTDA - ME</div>
      <div class="r-center">CNPJ 00.000.000/0001-00</div>
      <div class="r-center" id="pv-endereco">Rua Exemplo, 123 — Centro — Cidade/UF</div>
      <div class="r-center r-b" id="pv-cabecalho"></div>
      <hr class="r-sep">
      <div class="r-center">DANFE NFC-e - Documento Auxiliar da</div>
      <div class="r-center">Nota Fiscal de Consumidor Eletrônica</div>
      <hr class="r-sep">

      <div class="r-item-desc">1 Produto exemplo</div>
      <div class="r-item-linha">1 UN x R$ 10,00 = R$ 10,00</div>
      <div class="r-item-desc">2 Refrigerante 350ml</div>
      <div class="r-item-linha">2 UN x R$ 4,00 = R$ 8,00</div>
      <hr class="r-sep">

      <div class="r-row"><span>Qtde. total de itens</span><span>2</span></div>
      <div class="r-row r-total"><span>VALOR TOTAL</span><span>R$ 18,00</span></div>
      <hr class="r-sep">
      <div class="r-center">FORMA DE PAGAMENTO</div>
      <div class="r-row"><span>Dinheiro</span><span>R$ 18,00</span></div>
      <hr class="r-sep">

      <div class="r-center">NFC-e nº 22 série 110</div>
      <hr class="r-sep">
      <div class="r-center r-b">EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO</div>
      <div class="r-center r-b">SEM VALOR FISCAL</div>
      <hr class="r-sep">

      <div class="r-center">Consulte pela chave de acesso em:</div>
      <div class="r-center r-quebra">https://hom.sat.sef.sc.gov.br/nfce/consulta</div>
      <div class="r-center r-quebra">4226 0748 9353 2800 0126 6511 0000 0000 2219 3396 8794</div>
      <div class="r-center" id="pv-qr-wrap"><div class="r-qr"></div></div>
      <hr class="r-sep">
      <div class="r-center r-b">TESTE LOCAL - NAO TRANSMITIDA A SEFAZ</div>
      <hr class="r-sep">

      <div class="r-center" id="pv-rodape" style="margin-top:2px"></div>
      <div style="height:10px"></div>
    </div>
    <div class="zigzag"></div>
  </div>

</div>

<script>
function el(id){ return document.getElementById(id); }

async function carregar() {
  const c = await (await fetch('/config')).json();
  el('cabecalho').value = c.cabecalho || '';
  el('rodape').value = c.rodape || '';
  el('mostrarQr').checked = c.mostrarQr !== false;
  el('mostrarEndereco').checked = c.mostrarEndereco !== false;
  el('fonteGrande').checked = !!c.fonteGrande;
  atualizarPreview();
}

async function salvar() {
  const corpo = lerFormulario();
  const r = await fetch('/config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(corpo) });
  el('msg').textContent = r.ok ? '✔ Salvo! Vale para a próxima impressão fiscal.' : 'Erro ao salvar.';
  el('msg').style.color = r.ok ? '#0a7a3d' : '#c0392b';
}

function lerFormulario() {
  return {
    cabecalho: el('cabecalho').value,
    rodape: el('rodape').value,
    mostrarQr: el('mostrarQr').checked,
    mostrarEndereco: el('mostrarEndereco').checked,
    fonteGrande: el('fonteGrande').checked,
  };
}

function atualizarPreview() {
  const c = lerFormulario();
  el('receipt').className = 'receipt' + (c.fonteGrande ? ' grande' : '');

  el('pv-endereco').style.display = c.mostrarEndereco ? '' : 'none';

  const cab = el('pv-cabecalho');
  cab.textContent = c.cabecalho.trim();
  cab.style.display = c.cabecalho.trim() ? '' : 'none';

  el('pv-qr-wrap').style.display = c.mostrarQr ? '' : 'none';

  const rod = el('pv-rodape');
  rod.textContent = c.rodape.trim();
  rod.style.display = c.rodape.trim() ? '' : 'none';
}

['cabecalho','rodape','mostrarQr','mostrarEndereco','fonteGrande'].forEach(id => {
  el(id).addEventListener('input', atualizarPreview);
  el(id).addEventListener('change', atualizarPreview);
});

carregar();
</script>
</body></html>`;
}

module.exports = { paginaEditor };
