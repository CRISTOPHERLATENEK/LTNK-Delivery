/**
 * Editor do Cupom Fiscal — GET /editor. HTML autocontido, sem build step.
 *
 * ESTA PÁGINA E A ABA "CUPOM FISCAL" DA JANELA fazem a mesma coisa: editam o
 * config.json deste computador. A página existe pra ser aberta direto pelo
 * navegador, sem depender da janela do Electron (útil no suporte remoto e quando
 * o agente roda via `npm run servidor`, sem interface).
 *
 * A prévia NÃO é escrita aqui: vem de paginas/cupom-previa.js, a mesma que a
 * janela usa. Antes eram duas prévias do mesmo documento — e como as duas telas
 * salvam no MESMO arquivo, o lojista via uma forma aqui, outra na janela e uma
 * terceira no papel. Prévia que não bate com a impressão é pior que não ter
 * prévia, porque ela promete.
 *
 * Visual igual ao do resto do app (ver paginas/status.js): sem emoji, grafite em
 * vez de laranja, monoespaçada em todo dado técnico, aviso com filete à esquerda
 * em vez de caixa amarela — caixa amarela grita "erro" numa frase que é só uma
 * observação.
 */
'use strict';

const { PREVIA_CSS, previaCupomHtml, PREVIA_JS } = require('./cupom-previa');

function paginaEditor() {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cupom fiscal — LTNK</title>
<style>
  :root{
    --fundo:#E8E6E1;      --superficie:#FFFFFF;
    --barra:#FBFAF9;      --hairline:#E7E5E1;   --hairline-fraca:#F5F4F1;
    --texto:#1C1917;      --sec:#78716C;        --sec-2:#8C8783;
    --terc:#A8A29E;       --grafite:#1C1917;
    --ok:#3F8F62;         --inativo:#C6C1BB;
    --ui:'Inter','Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;
    --mono:'JetBrains Mono','Cascadia Mono','Consolas','DejaVu Sans Mono',monospace;
    --cupom-larg:300px;
  }
  *{box-sizing:border-box}
  body{margin:0;padding:34px 18px 60px;font-family:var(--ui);background:var(--fundo);
    color:var(--texto);font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased}
  button,input,textarea{font-family:inherit;font-size:inherit;color:inherit}

  .wrap{max-width:900px;margin:0 auto;display:grid;grid-template-columns:1fr 340px;gap:30px;
    align-items:start}
  @media (max-width:820px){ .wrap{grid-template-columns:1fr} }

  .eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;
    color:var(--terc);margin:0 0 6px}
  h1{font-size:22px;font-weight:600;margin:0;letter-spacing:-.01em}
  .sub{color:var(--sec);font-size:13px;margin:7px 0 0;max-width:52ch}

  .nota{border-left:2px solid var(--hairline);padding:2px 0 2px 13px;margin:18px 0 22px;
    color:var(--sec);font-size:12.5px;max-width:56ch}

  .card{background:var(--superficie);border:1px solid var(--hairline);border-radius:6px;padding:20px}
  .campo{margin-bottom:18px}
  .campo > label{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.06em;
    text-transform:uppercase;color:var(--terc);margin-bottom:6px}
  textarea{width:100%;padding:8px 10px;border:1px solid var(--hairline);border-radius:4px;
    resize:vertical;min-height:56px;background:var(--superficie)}
  textarea:focus{outline:0;border-color:var(--grafite)}
  .hint{font-size:11px;color:var(--sec-2);margin:5px 0 0}

  .toggle-linha{display:flex;align-items:center;justify-content:space-between;gap:14px;
    padding:12px 0;border-top:1px solid var(--hairline-fraca)}
  .toggle-linha .txt b{display:block;font-size:12.5px;font-weight:500}
  .toggle-linha .txt span{display:block;font-size:11px;color:var(--sec-2)}
  .switch{position:relative;width:32px;height:18px;border-radius:99px;background:var(--inativo);
    border:0;cursor:pointer;flex:none;transition:background .13s}
  .switch::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;
    border-radius:50%;background:#fff;transition:left .13s}
  .switch.on{background:var(--grafite)}
  .switch.on::after{left:16px}

  /* Aqui o Salvar FICA no formulário, ao contrário da janela.
     Na janela ele foi pra barra de status porque existe uma barra de status
     permanente; esta página não tem barra nenhuma, e botão flutuando no rodapé
     de uma página que rola é pior que botão no fim do formulário. */
  .acoes{display:flex;align-items:center;gap:10px;margin-top:20px;
    padding-top:18px;border-top:1px solid var(--hairline-fraca)}
  .btn{display:inline-flex;align-items:center;justify-content:center;background:var(--grafite);
    color:#fff;border:1px solid var(--grafite);padding:0 14px;height:32px;border-radius:4px;
    font-weight:500;font-size:12.5px;cursor:pointer;white-space:nowrap}
  .btn:hover{background:#332E2B;border-color:#332E2B}
  .btn.outline{background:transparent;color:var(--texto);border-color:var(--hairline)}
  .btn.outline:hover{background:var(--hairline-fraca)}
  .btn:disabled{opacity:.45;cursor:default}
  .aviso{font-size:12px;white-space:nowrap}
  .aviso.ok{color:var(--ok)} .aviso.erro{color:#A33A32}

  .previa-cab{display:flex;align-items:center;justify-content:space-between;
    font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;
    color:var(--terc);margin:0 auto 10px;width:var(--cupom-larg)}
${PREVIA_CSS}
</style></head><body>
<div class="wrap">

  <div>
    <p class="eyebrow">DANFE NFC-e</p>
    <h1>Cupom fiscal</h1>
    <p class="sub">O que aparece impresso no cupom deste computador. Vale a partir da próxima
      impressão fiscal.</p>

    <p class="nota">A prévia ao lado segue o layout oficial da NFC-e — cabeçalho e rodapé entram
      nos mesmos pontos aqui e na impressão de verdade.</p>

    <div class="card">
      <div class="campo">
        <label for="cabecalho">Mensagem no cabeçalho</label>
        <textarea id="cabecalho" placeholder="Ex.: Promoção: compre 2, leve 3"></textarea>
        <p class="hint">Entra abaixo dos dados da loja, antes do título DANFE NFC-e.</p>
      </div>
      <div class="campo">
        <label for="rodape">Mensagem no rodapé</label>
        <textarea id="rodape" placeholder="Ex.: Siga @sualoja no Instagram"></textarea>
        <p class="hint">Entra no fim do cupom, depois do QR Code, antes do corte.</p>
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

      <div class="acoes">
        <button class="btn" id="btn-salvar">Salvar</button>
        <button class="btn outline" id="btn-descartar">Descartar</button>
        <span class="aviso" id="aviso"></span>
      </div>
    </div>
  </div>

  <div>
    <div class="previa-cab"><span>Prévia</span><span>80mm</span></div>
    ${previaCupomHtml()}
  </div>

</div>

<script>
${PREVIA_JS}
function el(id){ return document.getElementById(id); }
var switches = { mostrarEndereco:'sw-endereco', mostrarQr:'sw-qr', fonteGrande:'sw-fonte' };
var salvo = null;

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
    // mostrarQr e mostrarEndereco são ligados por padrão (só desligam se vierem
    // explicitamente false); fonteGrande é o contrário.
    var ligado = k === 'fonteGrande' ? !!c[k] : c[k] !== false;
    var b = el(switches[k]);
    b.classList.toggle('on', ligado);
    b.setAttribute('aria-checked', ligado ? 'true' : 'false');
  });
}
function aoMudar(){ atualizarPreviaCupom(lerFormulario()); }

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
  el('aviso').textContent = '';
});

el('btn-salvar').addEventListener('click', async function(){
  var b = el('btn-salvar');
  var aviso = el('aviso');
  b.disabled = true; b.textContent = 'Salvando…';
  try {
    var corpo = lerFormulario();
    var r = await fetch('/config', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(corpo) });
    if (r.ok){
      salvo = corpo;
      aviso.textContent = 'Salvo. Vale da próxima impressão fiscal em diante.';
      aviso.className = 'aviso ok';
    } else {
      aviso.textContent = 'Não foi possível salvar (HTTP ' + r.status + ').';
      aviso.className = 'aviso erro';
    }
  } catch (e) {
    aviso.textContent = 'Não foi possível salvar: ' + e.message;
    aviso.className = 'aviso erro';
  } finally {
    b.disabled = false; b.textContent = 'Salvar';
  }
});

(async function carregar(){
  try {
    var c = await (await fetch('/config')).json();
    escreverFormulario(c);
  } catch (e) {
    el('aviso').textContent = 'Não foi possível ler a configuração deste computador.';
    el('aviso').className = 'aviso erro';
  }
  salvo = lerFormulario();
  aoMudar();
})();
</script>
</body></html>`;
}

module.exports = { paginaEditor };
