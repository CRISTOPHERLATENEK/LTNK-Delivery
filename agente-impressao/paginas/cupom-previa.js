/**
 * PRÉVIA DO CUPOM FISCAL — uma fonte só, usada em duas telas.
 *
 * POR QUE EXISTE. A prévia nasceu no /editor seguindo fielmente o layout
 * OFICIAL da NFC-e (o mesmo do DANFE que sai na térmica — ver montarBlocosDanfe
 * no painel e lib/fiscal.js, que insere cabeçalho e rodapé nos mesmos pontos).
 * Quando a tela "Cupom fiscal" da janela ganhou a própria prévia, ela foi
 * escrita de novo — mais simples, sem as linhas de item no formato oficial, sem
 * forma de pagamento, sem chave de acesso.
 *
 * Duas prévias do mesmo documento é pior que uma só: as duas editam o MESMO
 * arquivo de config, então o lojista vê uma forma na janela, outra no /editor, e
 * uma terceira no papel. Prévia que não bate com a impressão é pior que não ter
 * prévia — ela promete.
 *
 * A que ficou é a fiel. Quem precisar mudar o layout do cupom muda aqui e as
 * duas telas acompanham.
 *
 * COMO USAR (sem build step, tudo string):
 *   PREVIA_CSS          -> vai dentro do <style> da página
 *   previaCupomHtml()   -> o markup do cupom, com os ids que o JS mexe
 *   PREVIA_JS           -> define atualizarPreviaCupom(c), com
 *                          c = { cabecalho, rodape, mostrarQr, mostrarEndereco, fonteGrande }
 *
 * A LARGURA NÃO VEM DAQUI: a página define `--cupom-larg`, porque a janela usa
 * um painel de 284px e o /editor tem a página inteira. Só a largura muda — o
 * conteúdo é o mesmo nos dois lugares, e é esse o ponto.
 */
'use strict';

const PREVIA_CSS = `
  .cupom{width:var(--cupom-larg,284px);margin:0 auto;background:var(--superficie);
    padding:16px 14px 6px;font-family:var(--mono);font-size:10px;line-height:1.55;
    color:var(--texto);border:1px solid var(--hairline-fraca)}
  .cupom.grande{font-size:11.5px}
  .cupom .c{text-align:center}
  .cupom .b{font-weight:600}
  .cupom .nome{font-size:13px;font-weight:600}
  .cupom.grande .nome{font-size:14.5px}
  /* Filete tracejado e não sólido: é onde a bobina de verdade tem a linha de
     separação impressa, e o tracejado é o que faz o bloco ler como cupom. */
  .cupom .sep{border:0;border-top:1px dashed var(--inativo);margin:6px 0}
  .cupom .row{display:flex;justify-content:space-between;gap:8px;white-space:nowrap}
  .cupom .total{font-weight:600;font-size:11.5px}
  .cupom.grande .total{font-size:13px}
  .cupom .item{margin-top:4px}
  .cupom .item-l{color:var(--sec)}
  /* A chave de acesso e a URL quebram no meio da palavra de propósito: são
     cadeias sem espaço, e sem isto elas estouram a largura da bobina. */
  .cupom .quebra{word-break:break-all}
  .cupom .qr{width:64px;height:64px;margin:7px auto 3px;border:1px solid var(--hairline);
    display:flex;align-items:center;justify-content:center;font-size:8px;color:var(--terc)}
  /* Borda serrilhada do corte. Forma, não enfeite: diz "aqui a bobina é
     cortada", que é o que separa a prévia de um retângulo branco qualquer. */
  .cupom-corte{height:9px;width:var(--cupom-larg,284px);margin:0 auto;
    background:linear-gradient(-45deg,transparent 7px,var(--barra) 0) 0 0,
               linear-gradient(45deg,transparent 7px,var(--barra) 0) 0 0;
    background-size:14px 14px;background-repeat:repeat-x;background-color:var(--superficie)}
`;

/*
 * Dado de amostra, e rotulado como amostra no nome e no CNPJ: o agente não
 * conhece os dados reais da loja (eles chegam junto de cada pedido), e um nome
 * plausível faria o lojista achar que a prévia leu o cadastro dele.
 */
function previaCupomHtml() {
  return `<div class="cupom" id="cupom-previa">
      <div class="c b nome">LOJA DE EXEMPLO</div>
      <div class="c">LOJA DE EXEMPLO LTDA - ME</div>
      <div class="c">CNPJ 00.000.000/0001-00</div>
      <div class="c" id="pv-endereco">Rua Exemplo, 123 - Centro - Cidade/UF</div>
      <div class="c b" id="pv-cabecalho"></div>
      <hr class="sep">
      <div class="c">DANFE NFC-e - Documento Auxiliar da</div>
      <div class="c">Nota Fiscal de Consumidor Eletronica</div>
      <hr class="sep">
      <div class="item">1 Produto exemplo</div>
      <div class="item-l">1 UN x R$ 10,00 = R$ 10,00</div>
      <div class="item">2 Refrigerante 350ml</div>
      <div class="item-l">2 UN x R$ 4,00 = R$ 8,00</div>
      <hr class="sep">
      <div class="row"><span>Qtde. total de itens</span><span>2</span></div>
      <div class="row total"><span>VALOR TOTAL</span><span>R$ 18,00</span></div>
      <hr class="sep">
      <div class="c">FORMA DE PAGAMENTO</div>
      <div class="row"><span>Dinheiro</span><span>R$ 18,00</span></div>
      <hr class="sep">
      <div class="c">NFC-e no 22 serie 110</div>
      <hr class="sep">
      <div class="c b">EMITIDA EM AMBIENTE DE HOMOLOGACAO</div>
      <div class="c b">SEM VALOR FISCAL</div>
      <hr class="sep">
      <div class="c">Consulte pela chave de acesso em:</div>
      <div class="c quebra">https://hom.sat.sef.sc.gov.br/nfce/consulta</div>
      <div class="c quebra">4226 0748 9353 2800 0126 6511 0000 0000 2219 3396 8794</div>
      <div class="c" id="pv-qr-wrap"><div class="qr">QR</div></div>
      <hr class="sep">
      <div class="c b">TESTE LOCAL - NAO TRANSMITIDA A SEFAZ</div>
      <hr class="sep">
      <div class="c" id="pv-rodape" style="margin-top:2px"></div>
      <div style="height:8px"></div>
    </div>
    <div class="cupom-corte"></div>`;
}

/*
 * `display:none` em vez de remover o nó: o toggle vai e volta várias vezes
 * enquanto a pessoa decide, e recriar markup a cada clique perde a posição do
 * scroll da prévia.
 */
const PREVIA_JS = `
function atualizarPreviaCupom(c){
  var alvo = document.getElementById('cupom-previa');
  if (!alvo) return;
  alvo.className = 'cupom' + (c.fonteGrande ? ' grande' : '');
  document.getElementById('pv-endereco').style.display = c.mostrarEndereco ? '' : 'none';
  document.getElementById('pv-qr-wrap').style.display = c.mostrarQr ? '' : 'none';
  var cab = document.getElementById('pv-cabecalho');
  cab.textContent = (c.cabecalho || '').trim();
  cab.style.display = cab.textContent ? '' : 'none';
  var rod = document.getElementById('pv-rodape');
  rod.textContent = (c.rodape || '').trim();
  rod.style.display = rod.textContent ? '' : 'none';
}
`;

module.exports = { PREVIA_CSS, previaCupomHtml, PREVIA_JS };
