/**
 * Manual do usuário — GET /manual. Aberto no navegador padrão (link "Precisa
 * de ajuda?" no rodapé do app). Autocontido, sem depender de nada externo.
 */
'use strict';

function paginaManual({ versao }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Manual — LTNK Software de Impressão</title>
<style>
  :root{ --laranja:#ea580c; --laranja-esc:#c2410c; }
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;background:#f4f4f2;margin:0;color:#1f1f1f;line-height:1.6}
  .capa{background:linear-gradient(135deg,var(--laranja),var(--laranja-esc));color:#fff;
    padding:40px 20px 32px;text-align:center}
  .capa .icone{font-size:40px}
  .capa h1{font-size:22px;margin:8px 0 4px}
  .capa p{margin:0;opacity:.9;font-size:13px}
  .conteudo{max-width:720px;margin:0 auto;padding:28px 20px 60px}
  .indice{background:#fff;border:1px solid #ececec;border-radius:14px;padding:18px 20px;margin-bottom:28px}
  .indice h2{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#8a8a8a;margin:0 0 10px}
  .indice ol{margin:0;padding-left:20px;font-size:13.5px}
  .indice a{color:var(--laranja);text-decoration:none;font-weight:600}
  .indice a:hover{text-decoration:underline}
  section{margin-bottom:32px}
  section h2{display:flex;align-items:center;gap:8px;font-size:17px;margin:0 0 12px;
    padding-bottom:8px;border-bottom:2px solid #f0e6dd}
  section h2 .num{display:inline-flex;align-items:center;justify-content:center;
    width:26px;height:26px;border-radius:8px;background:var(--laranja);color:#fff;
    font-size:13px;font-weight:800;flex-shrink:0}
  .card{background:#fff;border:1px solid #ececec;border-radius:14px;padding:16px 18px;
    box-shadow:0 1px 3px rgba(0,0,0,.04);margin-bottom:12px}
  .card b{display:block;margin-bottom:3px}
  .passos{padding-left:20px}
  .passos li{margin-bottom:8px}
  .dica{background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px 14px;
    font-size:13px;color:#9a3412;margin-top:10px}
  .dica b{color:#7c2d12}
  code{background:#f0f0ee;padding:1px 6px;border-radius:5px;font-size:12.5px;font-family:'Courier New',monospace}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #ececec}
  th{color:#8a8a8a;font-weight:700;font-size:11px;text-transform:uppercase}
  .rodape{text-align:center;font-size:12px;color:#aaa;padding:20px}
  .voltar{display:inline-block;margin-top:6px;color:#fff;opacity:.85;font-size:12.5px;text-decoration:none}
</style></head><body>

  <div class="capa">
    <div class="icone">🖨️</div>
    <h1>Manual — Software de Impressão LTNK</h1>
    <p>Versão ${versao} · Guia rápido pra lojistas e caixas</p>
  </div>

  <div class="conteudo">

    <div class="indice">
      <h2>Neste manual</h2>
      <ol>
        <li><a href="#instalar">Instalar</a></li>
        <li><a href="#escolher">Escolher a impressora</a></li>
        <li><a href="#painel">Vincular no painel da loja</a></li>
        <li><a href="#testar">Testar a impressão</a></li>
        <li><a href="#setores">Setores (Cozinha/Bar)</a></li>
        <li><a href="#cupom-fiscal">Personalizar o cupom fiscal</a></li>
        <li><a href="#bandeja">Ícone da bandeja</a></li>
        <li><a href="#problemas">Problemas comuns</a></li>
      </ol>
    </div>

    <section id="instalar">
      <h2><span class="num">1</span> Instalar</h2>
      <div class="card">
        Baixe o instalador (<code>AgenteImpressao-Instalador.exe</code>) no painel da loja, aba
        <b>Config → Impressão</b>, e rode no computador do caixa. Siga o assistente — pode manter
        as opções padrão (cria atalho na área de trabalho e inicia com o Windows).
      </div>
      <div class="dica"><b>Importante:</b> instale no computador que está FISICAMENTE ligado à
        impressora térmica (USB ou rede), não em outro PC da loja.</div>
    </section>

    <section id="escolher">
      <h2><span class="num">2</span> Escolher a impressora</h2>
      <ol class="passos">
        <li>Abra o LTNK (ícone na área de trabalho ou na bandeja, perto do relógio).</li>
        <li>Clique em <b>Impressoras</b> no menu lateral.</li>
        <li>Sua térmica deve aparecer na lista automaticamente — o Windows já precisa
          reconhecê-la (driver instalado) antes disso.</li>
      </ol>
      <div class="dica">Se a impressora não aparecer, confira se ela está ligada, conectada, e
        instalada no Windows (Painel de Controle → Dispositivos e Impressoras). Depois clique em
        <b>Atualizar lista</b>.</div>
    </section>

    <section id="painel">
      <h2><span class="num">3</span> Vincular no painel da loja</h2>
      <ol class="passos">
        <li>No navegador, abra o painel do lojista → <b>Config → Impressão</b>.</li>
        <li>Em "Software de Impressão", clique em <b>Procurar impressoras</b>.</li>
        <li>Escolha a térmica na lista — fica salva neste computador (cada caixa escolhe a sua).</li>
      </ol>
    </section>

    <section id="testar">
      <h2><span class="num">4</span> Testar a impressão</h2>
      <div class="card">
        Na tela <b>Impressoras</b> do app, clique em <b>Testar</b> ao lado da impressora — sai um
        cupom de teste na hora. Se sair certinho, está tudo pronto pro dia a dia.
      </div>
    </section>

    <section id="setores">
      <h2><span class="num">5</span> Setores (Cozinha/Bar)</h2>
      <div class="card">
        Se a loja usa mais de uma impressora (ex.: uma na cozinha, outra no bar), configure os
        setores na aba <b>Categorias</b> do painel (quais categorias pertencem a qual setor), e
        depois vincule cada setor à impressora correspondente em <b>Config → Impressão → Setores
        → impressora</b>. A partir daí, cada pedido sai dividido automaticamente.
      </div>
    </section>

    <section id="cupom-fiscal">
      <h2><span class="num">6</span> Personalizar o cupom fiscal</h2>
      <div class="card">
        Na aba <b>Configurações</b> do app (ou pelo botão "Editor do cupom fiscal"), dá pra
        adicionar uma mensagem no cabeçalho/rodapé do cupom, mostrar ou ocultar o QR Code e o
        endereço, e aumentar a fonte. As mudanças valem só pra este computador.
      </div>
    </section>

    <section id="bandeja">
      <h2><span class="num">7</span> Ícone da bandeja</h2>
      <table>
        <tr><th>Ação</th><th>O que faz</th></tr>
        <tr><td>Fechar pelo <b>X</b> da janela</td><td>Minimiza — o agente continua rodando (precisa disso pra imprimir).</td></tr>
        <tr><td>Clique no ícone da bandeja</td><td>Mostra/esconde a janela.</td></tr>
        <tr><td>Clique direito → Sair</td><td>Encerra o agente de verdade (a loja para de imprimir automático até abrir de novo).</td></tr>
      </table>
    </section>

    <section id="problemas">
      <h2><span class="num">8</span> Problemas comuns</h2>
      <div class="card"><b>Não imprime nada</b><br>Confira se o app está aberto (ícone na bandeja)
        e se a impressora certa foi escolhida no painel da loja, neste computador.</div>
      <div class="card"><b>"Já existe uma cópia rodando"</b><br>Só pode ter uma cópia do app aberta
        por vez neste PC. Verifique o ícone da bandeja antes de abrir de novo.</div>
      <div class="card"><b>Impressora não aparece na lista</b><br>Ela precisa estar instalada no
        Windows primeiro (fora do LTNK). Instale o driver do fabricante, depois clique em
        <b>Atualizar lista</b> no app.</div>
      <div class="card"><b>Cupom sai cortado ou com acentos errados</b><br>Confira a largura do
        papel (58mm/80mm) no painel da loja, em Config → Impressão.</div>
    </section>

  </div>
  <div class="rodape">LTNK Software de Impressão · v${versao}</div>
</body></html>`;
}

module.exports = { paginaManual };
