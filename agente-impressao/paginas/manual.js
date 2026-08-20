/**
 * Manual do usuário — GET /manual. Aberto no navegador padrão (botão "Abrir
 * manual" na tela Sobre). Autocontido, sem depender de nada externo.
 *
 * Mesmo tratamento visual da janela do app (ver paginas/status.js): sem emoji,
 * grafite em vez de laranja, monoespaçada em todo dado técnico, e aviso com
 * filete à esquerda em vez de caixa colorida — caixa amarela grita "erro" numa
 * frase que é só uma observação.
 *
 * A capa deixou de ser gradiente laranja: num documento que a pessoa vai LER,
 * meio palmo de cor saturada no topo empurra o texto pra baixo da dobra e não
 * informa nada. Virou capa branca com filete embaixo.
 */
'use strict';

function paginaManual({ versao }) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Manual — LTNK Software de Impressão</title>
<style>
  :root{
    --fundo:#E8E6E1;      --superficie:#FFFFFF;
    --barra:#FBFAF9;      --hairline:#E7E5E1;   --hairline-fraca:#F5F4F1;
    --texto:#1C1917;      --sec:#78716C;        --sec-2:#8C8783;
    --terc:#A8A29E;       --grafite:#1C1917;
    --ui:'Inter','Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;
    --mono:'JetBrains Mono','Cascadia Mono','Consolas','DejaVu Sans Mono',monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:var(--ui);background:var(--fundo);color:var(--texto);
    font-size:14px;line-height:1.6;-webkit-font-smoothing:antialiased}

  .capa{background:var(--superficie);border-bottom:1px solid var(--hairline);
    padding:34px 20px 26px}
  .capa .dentro{max-width:720px;margin:0 auto}
  .eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;
    color:var(--terc);margin:0 0 7px}
  .capa h1{font-size:23px;font-weight:600;margin:0;letter-spacing:-.01em}
  .capa p{margin:8px 0 0;color:var(--sec);font-size:13px}
  .capa .tec{font-family:var(--mono);font-size:11.5px;color:var(--sec-2);margin-top:2px}

  .conteudo{max-width:720px;margin:0 auto;padding:26px 20px 60px}

  .indice{background:var(--superficie);border:1px solid var(--hairline);border-radius:6px;
    padding:16px 18px;margin-bottom:30px}
  .indice h2{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;
    color:var(--terc);font-weight:400;margin:0 0 8px}
  .indice ol{margin:0;padding-left:18px;font-size:13.5px;line-height:1.9}
  .indice a{color:var(--texto);text-decoration:none}
  .indice a:hover{text-decoration:underline}

  section{margin-bottom:34px}
  section h2{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:600;margin:0 0 14px;
    padding-bottom:9px;border-bottom:1px solid var(--hairline)}
  /* Número em quadrado de BORDA, não em quadrado preenchido: oito blocos
     grafite descendo a página viram uma coluna de manchas que compete com
     o texto. A borda numera sem gritar. */
  section h2 .num{display:inline-flex;align-items:center;justify-content:center;
    width:24px;height:24px;border-radius:4px;border:1px solid var(--hairline);
    font-family:var(--mono);font-size:11.5px;font-weight:400;color:var(--sec);flex:none}

  .card{background:var(--superficie);border:1px solid var(--hairline);border-radius:6px;
    padding:14px 16px;margin-bottom:10px}
  .card b{color:var(--texto)}
  .card > b:first-child{display:block;margin-bottom:2px}
  .passos{padding-left:20px;margin:0}
  .passos li{margin-bottom:7px}

  .nota{border-left:2px solid var(--hairline);padding:2px 0 2px 13px;margin-top:12px;
    color:var(--sec);font-size:13px}
  .nota b{color:var(--texto);font-weight:600}

  code{font-family:var(--mono);font-size:12.5px;background:var(--hairline-fraca);
    border:1px solid var(--hairline);border-radius:3px;padding:0 5px}

  table{width:100%;border-collapse:collapse;font-size:13px;
    background:var(--superficie);border:1px solid var(--hairline);border-radius:6px}
  th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--hairline-fraca)}
  tr:last-child td{border-bottom:0}
  th{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;
    color:var(--terc);font-weight:400}

  .rodape{max-width:720px;margin:0 auto;padding:0 20px 40px;font-family:var(--mono);
    font-size:11px;color:var(--terc)}
</style></head><body>

  <div class="capa"><div class="dentro">
    <p class="eyebrow">Manual do usuário</p>
    <h1>LTNK — Software de Impressão</h1>
    <p>Guia rápido para lojistas e caixas.</p>
    <div class="tec">v${versao}</div>
  </div></div>

  <div class="conteudo">

    <div class="indice">
      <h2>Neste manual</h2>
      <ol>
        <li><a href="#instalar">Instalar</a></li>
        <li><a href="#escolher">Escolher a impressora</a></li>
        <li><a href="#painel">Vincular no painel da loja</a></li>
        <li><a href="#testar">Testar a impressão</a></li>
        <li><a href="#setores">Setores (cozinha e bar)</a></li>
        <li><a href="#cupom-fiscal">Personalizar o cupom fiscal</a></li>
        <li><a href="#bandeja">Ícone da bandeja</a></li>
        <li><a href="#problemas">Problemas comuns</a></li>
      </ol>
    </div>

    <section id="instalar">
      <h2><span class="num">1</span> Instalar</h2>
      <div class="card">
        Baixe o instalador (<code>AgenteImpressao-Instalador.exe</code>) no painel da loja, aba
        <b>Config &rarr; Impressão</b>, e rode no computador do caixa. Siga o assistente — pode manter
        as opções padrão (cria atalho na área de trabalho e inicia com o Windows).
      </div>
      <p class="nota"><b>Importante:</b> instale no computador que está fisicamente ligado à
        impressora térmica (USB ou rede), não em outro PC da loja.</p>
    </section>

    <section id="escolher">
      <h2><span class="num">2</span> Escolher a impressora</h2>
      <ol class="passos">
        <li>Abra o LTNK (atalho na área de trabalho, ou o ícone na bandeja perto do relógio).</li>
        <li>Clique em <b>Impressoras</b> no menu lateral.</li>
        <li>Sua térmica deve aparecer na lista automaticamente — o Windows já precisa
          reconhecê-la (driver instalado) antes disso.</li>
        <li>Marque o círculo à esquerda do nome para definir qual é a impressora padrão
          deste computador.</li>
      </ol>
      <p class="nota">Se a impressora não aparecer, confira se ela está ligada, conectada e
        instalada no Windows (Painel de Controle &rarr; Dispositivos e Impressoras). Depois clique em
        <b>Atualizar lista</b>.</p>
    </section>

    <section id="painel">
      <h2><span class="num">3</span> Vincular no painel da loja</h2>
      <ol class="passos">
        <li>No navegador, abra o painel do lojista &rarr; <b>Config &rarr; Impressão</b>.</li>
        <li>Em "Software de Impressão", clique em <b>Procurar impressoras</b>.</li>
        <li>Escolha a térmica na lista — fica salva neste computador (cada caixa escolhe a sua).</li>
      </ol>
    </section>

    <section id="testar">
      <h2><span class="num">4</span> Testar a impressão</h2>
      <div class="card">
        Na tela <b>Impressoras</b>, clique em <b>Testar</b> ao lado da impressora — sai um
        cupom de teste na hora. Também dá pra testar a padrão direto na tela <b>Início</b>, no
        botão <b>Imprimir teste</b>. Se o cupom sair certinho, está pronto pro dia a dia.
      </div>
    </section>

    <section id="setores">
      <h2><span class="num">5</span> Setores (cozinha e bar)</h2>
      <div class="card">
        Se a loja usa mais de uma impressora (por exemplo uma na cozinha, outra no bar), configure os
        setores na aba <b>Categorias</b> do painel (quais categorias pertencem a qual setor) e
        depois vincule cada setor à impressora correspondente em <b>Config &rarr; Impressão &rarr; Setores</b>.
        A partir daí cada pedido sai dividido automaticamente.
      </div>
    </section>

    <section id="cupom-fiscal">
      <h2><span class="num">6</span> Personalizar o cupom fiscal</h2>
      <div class="card">
        Na tela <b>Cupom fiscal</b> dá pra adicionar uma mensagem no cabeçalho e no rodapé,
        mostrar ou ocultar o QR Code e o endereço, e aumentar a fonte. A prévia ao lado do
        formulário mostra como o cupom vai sair antes de você salvar.
      </div>
      <p class="nota">As alterações ficam pendentes até você clicar em <b>Salvar</b> na barra
        inferior da janela, e valem só para este computador — a partir da próxima impressão.</p>
    </section>

    <section id="bandeja">
      <h2><span class="num">7</span> Ícone da bandeja</h2>
      <table>
        <tr><th>Ação</th><th>O que faz</th></tr>
        <tr><td>Fechar pelo <b>X</b> da janela</td><td>Só esconde a janela — o agente continua rodando, e é disso que a impressão depende.</td></tr>
        <tr><td>Clique no ícone da bandeja</td><td>Mostra ou esconde a janela.</td></tr>
        <tr><td>Clique direito &rarr; Sair</td><td>Encerra o agente de verdade. A loja para de imprimir automático até abrir de novo.</td></tr>
      </table>
    </section>

    <section id="problemas">
      <h2><span class="num">8</span> Problemas comuns</h2>
      <div class="card"><b>Não imprime nada</b>Confira se o app está aberto (ícone na bandeja)
        e se a impressora certa foi escolhida no painel da loja, neste computador.</div>
      <div class="card"><b>"Já existe uma cópia rodando"</b>Só pode haver uma cópia do app aberta
        por vez neste PC. Verifique o ícone da bandeja antes de abrir de novo.</div>
      <div class="card"><b>Impressora não aparece na lista</b>Ela precisa estar instalada no
        Windows primeiro, fora do LTNK. Instale o driver do fabricante e depois clique em
        <b>Atualizar lista</b>.</div>
      <div class="card"><b>Cupom sai cortado ou com acentos errados</b>Confira a largura do
        papel (58mm ou 80mm) no painel da loja, em Config &rarr; Impressão.</div>
      <div class="card"><b>Precisa falar com o suporte</b>Na tela <b>Sobre</b>, use
        <b>Copiar diagnóstico</b>: ele copia a versão, o endereço, a lista de impressoras e o
        último erro, tudo de uma vez, pra você colar na conversa.</div>
    </section>

  </div>
  <div class="rodape">LTNK Software de Impressão · v${versao}</div>
</body></html>`;
}

module.exports = { paginaManual };
