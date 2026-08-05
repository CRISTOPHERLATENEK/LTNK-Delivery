/**
 * Impressão térmica de cupons (PDV e comanda).
 *
 * Gera um HTML otimizado para bobina térmica 80mm ou 58mm. Se houver o NOSSO
 * Agente de Impressão rodando neste PC, imprime DIRETO (silencioso, ESC/POS);
 * senão cai no diálogo do navegador (window.print()).
 *
 * O DANFE da NFC-e reaproveita o mesmo formato/coluna.
 */
import { impressoraAgentePreferida, imprimirViaAgente, agenteAtivo, impressoraSetor, type BlocoImpressao, type ConfigFiscal } from './agente';
import { api } from './api';

export interface ConfigImpressao {
  largura: '80' | '58';
  auto: boolean;
  loja_nome: string;
  rodape: string;
}

export interface LinhaCupom {
  qtd: string;        // "2" ou "0,350 kg"
  nome: string;
  valor: string;      // "R$ 24,90"
  detalhe?: string;   // ex.: "0,350 kg × R$ 39,90/kg" — vai só no cupom principal (pode ter preço)
  observacao?: string; // observação de produção ("sem cebola") — realçada na comanda do setor
  categoria?: string; // categoria do produto — usada pra rotear pro setor de impressão (Cozinha, Bar...)
}

export interface DadosCupom {
  titulo: string;                 // "VENDA BALCÃO #12" / "MESA 1 · COMANDA #14"
  linhas: LinhaCupom[];
  totais: { rotulo: string; valor: string; forte?: boolean }[];
  extras?: { rotulo: string; valor: string }[]; // ex.: Pagamento, Troco
  // Contexto usado só na via de produção por setor (Cozinha/Bar):
  tipoVenda?: string;   // "Balcão" | "Mesa 5" | "Delivery"
  referencia?: string;  // "#12" (nº do pedido/comanda)
  atendente?: string;   // quem lançou/atendeu
  cliente?: string;     // nome do cliente (delivery)
}

/** Lê a config de impressão a partir do objeto da loja (com defaults seguros). */
export function configImpressao(loja: Record<string, unknown> | null | undefined): ConfigImpressao {
  return {
    largura: (loja?.impressora_largura === '58' ? '58' : '80'),
    auto: loja?.impressora_auto === undefined ? true : !!loja?.impressora_auto,
    loja_nome: String(loja?.nome || 'Loja'),
    rodape: String(loja?.cupom_rodape || ''),
  };
}

function esc(s: string): string {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
}

/** Largura da bobina em mm a partir da config. */
function larguraMmDe(largura: '80' | '58'): number {
  return largura === '58' ? 58 : 80;
}

/**
 * Quantidade do item do DANFE com a palavra "Qtd" na frente.
 *
 * POR QUE A PALAVRA: o DANFE imprime o número SEQUENCIAL do item numa linha e a
 * QUANTIDADE na linha seguinte. Quando os dois coincidem — item 2, 2 unidades —
 * o cupom mostra dois "2" um embaixo do outro e o cliente lê como se algo
 * estivesse repetido ou cobrado a mais. Rotular a quantidade resolve a dúvida no
 * lugar onde ela nasce; a norma exige que os campos apareçam, não que apareçam
 * sem rótulo.
 *
 * A unidade só sai quando NÃO é "UN": "Qtd 2" já se entende, "Qtd 2 UN" é ruído
 * na linha mais apertada do cupom — mas em produto pesado ("0,350 KG") a unidade
 * é a informação que impede o cliente de achar que levou 350 unidades.
 */
function rotuloQtd(quantidade: string | number, unidade: string): string {
  const un = String(unidade || '').trim().toUpperCase();
  return un && un !== 'UN' ? `Qtd ${quantidade} ${un}` : `Qtd ${quantidade}`;
}

/**
 * Despacha a impressão: se o NOSSO agente estiver rodando, imprime por ele
 * (ESC/POS, com a config do cupom fiscal aplicada) — auto-selecionando a
 * térmica se preciso. Só cai no diálogo do navegador quando o agente está
 * fechado ou a impressão por ele falha. Assim o cupom sai igual mesmo que o
 * lojista nunca tenha aberto a tela de configuração da impressora.
 */
export function despacharImpressao(html: string, larguraMm: number, blocos?: BlocoImpressao[], ehFiscal?: boolean): void {
  if (blocos) {
    impressoraAgentePreferida()
      .then(printer => {
        if (!printer) { abrirEImprimir(html); return; }
        return imprimirViaAgente(blocos, larguraMm, printer, ehFiscal);
      })
      .catch(() => abrirEImprimir(html));
    return;
  }
  abrirEImprimir(html);
}

/**
 * Fallback (sem agente): imprime pelo diálogo do navegador, a partir de um
 * IFRAME OCULTO na própria página.
 *
 * ANTES ERA UM POPUP (`window.open` + `w.print()`) e isso TRAVAVA O APP: popup
 * same-origin com opener compartilha o event loop da aba que o abriu, então o
 * `print()` — que é modal e síncrono — congelava o painel do lojista inteiro até
 * alguém fechar o diálogo. Pior: o `focus()` podia jogar o diálogo atrás da
 * janela principal (ou em outro monitor), e o operador via só uma tela morta,
 * sem nada na frente explicando. Some com isso o acúmulo de abas e o bloqueador
 * de popup, que fazia a impressão simplesmente não sair sem avisar.
 *
 * O diálogo de impressão continua sendo modal — isso é do navegador e não tem
 * como evitar imprimindo por ele. A diferença é que agora ele pertence à aba
 * atual, aparece na frente e, ao fechar, a tela volta a responder.
 */
export function abrirEImprimir(html: string): void {
  const quadro = document.createElement('iframe');
  quadro.setAttribute('aria-hidden', 'true');
  quadro.title = 'Impressão';
  // Fora da vista, mas NÃO `display:none` nem `visibility:hidden`: alguns
  // navegadores não renderizam (e não imprimem) iframe realmente invisível.
  quadro.style.cssText = 'position:fixed;left:-10000px;top:0;width:380px;height:800px;border:0;';

  let jaLimpou = false;
  const limpar = () => {
    if (jaLimpou) return;
    jaLimpou = true;
    quadro.remove();
  };

  let jaImprimiu = false;
  /**
   * SAÍA FOLHA EM BRANCO por causa disto: o evento `load` do iframe dispara
   * TAMBÉM para o `about:blank` que o navegador cria ao inserir o elemento no
   * DOM — antes do nosso HTML entrar. Imprimindo esse documento vazio o Chrome
   * manda uma folha branca, e como `about:blank` herda a identidade do
   * documento que o criou, o cabeçalho e o rodapé saem com o título e a URL da
   * PÁGINA DO PAINEL — foi exatamente o que apareceu na pré-visualização, o que
   * fazia parecer que o comprovante estava vazio quando ele nunca chegou a ser
   * impresso.
   *
   * A checagem do body é o que distingue os dois: o `about:blank` vem sem nada
   * dentro. Só imprime quando o conteúdo que mandamos já está lá, e uma vez só.
   */
  const imprimirQuandoPronto = () => {
    if (jaImprimiu) return;
    const w = quadro.contentWindow;
    const doc = quadro.contentDocument;
    if (!w || !doc?.body || doc.body.childElementCount === 0) return;
    jaImprimiu = true;
    try {
      // `afterprint` cobre imprimir e cancelar. Onde não dispara, o timeout
      // abaixo garante que o iframe não fique pra sempre no DOM.
      w.addEventListener('afterprint', limpar, { once: true });
      // `focus()` no iframe antes do `print()`: sem isso há navegador que manda
      // o frame de cima pra impressora em vez deste.
      w.focus();
      w.print();
      setTimeout(limpar, 60_000);
    } catch {
      // Navegador que não deixa imprimir de iframe: cai no popup de antes, que
      // é ruim mas é melhor que não imprimir o cupom do cliente.
      limpar();
      const p = window.open('', '_blank', 'width=360,height=680,toolbar=0');
      if (!p) return;
      p.document.write(html);
      p.document.close();
      setTimeout(() => { p.focus(); p.print(); }, 300);
    }
  };

  quadro.onload = imprimirQuandoPronto;
  quadro.srcdoc = html;
  document.body.appendChild(quadro);
  // Rede de segurança: se o `load` do srcdoc já tiver passado antes de chegarmos
  // aqui, ninguém mais chamaria a impressão e o cupom simplesmente não sairia.
  setTimeout(imprimirQuandoPronto, 300);
}

/** Monta o HTML do cupom (PDV/comanda). */
export function montarHtmlCupom(dados: DadosCupom, config: ConfigImpressao): string {
  const larguraMm = larguraMmDe(config.largura);
  const areaMm = larguraMm - 4; // margem lateral
  const fonte = config.largura === '58' ? 11 : 12.5;

  const agora = new Date().toLocaleString('pt-BR');

  const linhasHtml = dados.linhas.map(l => `
    <div class="row">
      <span class="qtd">${esc(l.qtd)}×</span>
      <span class="nome">${esc(l.nome)}</span>
      <span class="val">${esc(l.valor)}</span>
    </div>
    ${l.detalhe ? `<div class="obs">${esc(l.detalhe)}</div>` : ''}
  `).join('');

  const totaisHtml = dados.totais.map(t => `
    <div class="row tot ${t.forte ? 'forte' : ''}">
      <span>${esc(t.rotulo)}</span><span>${esc(t.valor)}</span>
    </div>
  `).join('');

  const extrasHtml = (dados.extras || []).map(e => `
    <div class="row"><span>${esc(e.rotulo)}</span><span>${esc(e.valor)}</span></div>
  `).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(dados.titulo)}</title>
<style>
  @page { size: ${larguraMm}mm auto; margin: 2mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: ${fonte}px; width: ${areaMm}mm; color: #000; }
  .center { text-align: center; }
  .loja { font-size: ${fonte + 2}px; font-weight: bold; }
  .titulo { font-weight: bold; margin-top: 2px; }
  .meta { font-size: ${fonte - 1.5}px; }
  .sep { border-top: 1px dashed #000; margin: 5px 0; }
  .row { display: flex; gap: 4px; margin-bottom: 2px; }
  .row .qtd { flex: 0 0 auto; }
  .row .nome { flex: 1 1 auto; word-break: break-word; }
  .row .val { flex: 0 0 auto; text-align: right; white-space: nowrap; }
  .obs { font-size: ${fonte - 2}px; padding-left: 14px; }
  .tot { font-weight: bold; }
  .tot span:last-child { margin-left: auto; }
  .tot.forte { font-size: ${fonte + 3}px; }
  .rodape { margin-top: 6px; text-align: center; font-size: ${fonte - 1}px; white-space: pre-wrap; }
</style></head><body>
  <div class="center loja">${esc(config.loja_nome)}</div>
  <div class="center titulo">${esc(dados.titulo)}</div>
  <div class="center meta">${esc(agora)}</div>
  <div class="sep"></div>
  ${linhasHtml}
  <div class="sep"></div>
  ${totaisHtml}
  ${extrasHtml ? `<div class="sep"></div>${extrasHtml}` : ''}
  ${config.rodape ? `<div class="rodape">${esc(config.rodape)}</div>` : ''}
</body></html>`;
}

/** Blocos ESC/POS do cupom (pro nosso agente de impressão). */
export function montarBlocosCupom(dados: DadosCupom, config: ConfigImpressao): BlocoImpressao[] {
  const b: BlocoImpressao[] = [
    { t: 'center', b: true, txt: config.loja_nome },
    { t: 'center', txt: dados.titulo },
    { t: 'center', txt: new Date().toLocaleString('pt-BR') },
    { t: 'linha' },
  ];
  for (const l of dados.linhas) {
    b.push({ t: 'lr', l: `${l.qtd} ${l.nome}`, r: l.valor });
    if (l.detalhe) b.push({ t: 'texto', txt: '  ' + l.detalhe });
  }
  b.push({ t: 'linha' });
  for (const t of dados.totais) b.push({ t: 'lr', b: t.forte, l: t.rotulo, r: t.valor });
  for (const e of dados.extras || []) b.push({ t: 'lr', l: e.rotulo, r: e.valor });
  if (config.rodape) { b.push({ t: 'pular', n: 1 }, { t: 'center', txt: config.rodape }); }
  b.push({ t: 'corte' });
  return b;
}

/** Monta o cupom e imprime (agente → QZ → diálogo). Também dispara as vias de produção por setor (Cozinha/Bar), se configuradas. */
export function imprimirCupom(dados: DadosCupom, config: ConfigImpressao): void {
  despacharImpressao(montarHtmlCupom(dados, config), larguraMmDe(config.largura), montarBlocosCupom(dados, config));
  imprimirViasPorSetor(dados, config).catch(() => { /* impressão por setor é best-effort */ });
}

/**
 * Dispara SÓ as vias de produção por setor (cozinha/bar) — sem o cupom do
 * caixa. É o que roda quando o pedido é ENVIADO PRA PRODUÇÃO (não no
 * fechamento): cada setor recebe, na hora, só os itens da rodada que são dele.
 * Best-effort: se não houver setor/impressora configurados, não imprime nada.
 */
export function imprimirComandasProducao(dados: DadosCupom, config: ConfigImpressao): void {
  imprimirViasPorSetor(dados, config).catch(() => { /* produção é best-effort */ });
}

/* ───────────────────────── Roteamento por setor ───────────────────────── */

interface MapaSetores { porCategoria: Map<string, number>; nomeSetor: Map<number, string> }
let cacheMapaSetores: MapaSetores | null = null;
let cacheMapaSetoresTs = 0;

async function buscarMapaSetores(): Promise<MapaSetores> {
  if (cacheMapaSetores && Date.now() - cacheMapaSetoresTs < 60_000) return cacheMapaSetores;
  const [catsR, setR] = await Promise.all([
    api<{ categorias: { nome: string; setor_id: number | null }[] }>('GET', '/api/lojista/categorias'),
    api<{ setores: { id: number; nome: string }[] }>('GET', '/api/lojista/setores'),
  ]);
  const porCategoria = new Map<string, number>();
  catsR.categorias.forEach(c => { if (c.setor_id) porCategoria.set(c.nome, c.setor_id); });
  const nomeSetor = new Map<number, string>();
  setR.setores.forEach(s => nomeSetor.set(s.id, s.nome));
  cacheMapaSetores = { porCategoria, nomeSetor };
  cacheMapaSetoresTs = Date.now();
  return cacheMapaSetores;
}

/**
 * Blocos ESC/POS de uma via de PRODUÇÃO pro setor (Cozinha/Bar). SEM preços —
 * é a comanda que o cozinheiro/barman lê. Traz nome do setor em fonte grande,
 * identificação (tipo/mesa/nº), horário, atendente e cliente, e cada item com
 * a quantidade em destaque e a OBSERVAÇÃO realçada (ex.: "SEM CEBOLA") — que é
 * o mais crítico na produção.
 */
function montarBlocosSetor(dados: DadosCupom, setorNome: string, linhas: LinhaCupom[]): BlocoImpressao[] {
  const agora = new Date();
  const hora = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const data = agora.toLocaleDateString('pt-BR');

  // Cabeçalho da identificação: usa os campos estruturados, caindo no título se faltarem.
  const idLinha = [dados.tipoVenda, dados.referencia].filter(Boolean).join(' ') || dados.titulo;

  const b: BlocoImpressao[] = [
    { t: 'titulo', txt: setorNome.toUpperCase() },      // fonte grande (dupla)
    { t: 'center', b: true, txt: idLinha },
    { t: 'center', txt: `${data}  ${hora}` },
  ];
  if (dados.atendente) b.push({ t: 'lr', l: 'Atendente', r: dados.atendente });
  if (dados.cliente) b.push({ t: 'lr', l: 'Cliente', r: dados.cliente });
  b.push({ t: 'linha' });

  for (const l of linhas) {
    b.push({ t: 'texto', txt: `${l.qtd}x  ${l.nome}` });
    if (l.observacao) b.push({ t: 'center', b: true, txt: `>> ${l.observacao.toUpperCase()} <<` });
  }

  const totalItens = linhas.reduce((s, l) => s + (parseInt(l.qtd, 10) || 1), 0);
  b.push({ t: 'linha' });
  b.push({ t: 'lr', b: true, l: 'Total de itens', r: String(totalItens) });
  b.push({ t: 'corte' });
  return b;
}

/**
 * Agrupa as linhas do cupom pelo setor da categoria de cada produto e imprime
 * uma via de produção (sem preço) em cada impressora vinculada ao setor NESTE
 * PC (config local, feita na aba Impressão). Categorias sem setor, ou setores
 * sem impressora vinculada, não geram via extra. Best-effort: nunca lança.
 */
async function imprimirViasPorSetor(dados: DadosCupom, config: ConfigImpressao): Promise<void> {
  if (!dados.linhas.some(l => l.categoria)) return;
  if (!(await agenteAtivo())) return;
  const { porCategoria, nomeSetor } = await buscarMapaSetores();
  if (porCategoria.size === 0) return;

  const grupos = new Map<number, LinhaCupom[]>();
  for (const l of dados.linhas) {
    const setorId = l.categoria ? porCategoria.get(l.categoria) : undefined;
    if (!setorId) continue;
    if (!grupos.has(setorId)) grupos.set(setorId, []);
    grupos.get(setorId)!.push(l);
  }

  const larguraMm = larguraMmDe(config.largura);
  for (const [setorId, linhas] of grupos) {
    const impressora = impressoraSetor(setorId);
    if (!impressora) continue;
    const setorNome = nomeSetor.get(setorId) || 'Setor';
    const blocos = montarBlocosSetor(dados, setorNome, linhas);
    imprimirViaAgente(blocos, larguraMm, impressora).catch(() => { /* setor best-effort */ });
  }
}

/* ───────────────────────── DANFE NFC-e ───────────────────────── */

export interface DadosDanfe {
  chave: string;
  ambiente: number;        // 1=produção 2=homologação
  assinado: boolean;
  autorizada?: boolean;    // true = transmitida e autorizada pela SEFAZ
  protocolo?: string;      // nProt da autorização (quando autorizada)
  qr_png: string;          // data URL
  qr_url: string;
  danfe: {
    emitente: { nome: string; fantasia: string; cnpj: string; endereco: string };
    itens: Array<{ descricao: string; quantidade: number; unidade: string; v_unit: number; v_total: number }>;
    total: number;           // líquido (bruto - desconto)
    desconto?: number;       // desconto/cupom aplicado (centavos)
    pagamentos: Array<{ tipo: string; valor: number }>;
    numero: number;
    serie: number;
  };
}

const PAG_LABEL: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão' };
const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtChave = (c: string) => c.replace(/(\d{4})(?=\d)/g, '$1 ');

/**
 * Monta o HTML do DANFE NFC-e (cupom fiscal) em bobina térmica, com QR Code.
 * `config` (do editor do cupom fiscal, /editor do agente) aplica cabeçalho,
 * rodapé, mostrar/ocultar endereço e QR, e fonte maior — mesma personalização
 * que sai na impressão ESC/POS, pra Baixar PDF/diálogo não divergir.
 */
export function montarHtmlDanfe(d: DadosDanfe, largura: '80' | '58' = '80', config?: ConfigFiscal | null): string {
  const larguraMm = larguraMmDe(largura);
  const areaMm = larguraMm - 4;
  const fonte = (largura === '58' ? 10.5 : 12) + (config?.fonteGrande ? 1.5 : 0);
  const e = d.danfe.emitente;
  const cents = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
  const qtdItens = d.danfe.itens.length;

  const itensHtml = d.danfe.itens.map((i, idx) => `
    <div class="it">
      <div class="it-l"><span class="it-n">${idx + 1}.</span> ${esc(i.descricao)}</div>
      <div class="it-r">
        <span>${rotuloQtd(i.quantidade, i.unidade)} x ${cents(i.v_unit)}</span>
        <b>${cents(i.v_total)}</b>
      </div>
    </div>`).join('');

  const pagsHtml = d.danfe.pagamentos.map(p =>
    `<div class="row"><span>${esc(PAG_LABEL[p.tipo] || p.tipo)}</span><span>${cents(p.valor)}</span></div>`
  ).join('');

  const aviso = d.ambiente === 2
    ? `<div class="aviso">EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO<br>SEM VALOR FISCAL</div>` : '';
  // Nota autorizada: mostra o protocolo. Só mostra "teste local" se NÃO foi transmitida.
  const protocoloHtml = d.autorizada && d.protocolo
    ? `<div class="c small">Protocolo de autorização<br><b>${esc(d.protocolo)}</b></div>` : '';
  const avisoTeste = d.autorizada
    ? '' : `<div class="aviso">⚠ TESTE LOCAL — NÃO TRANSMITIDA À SEFAZ${d.assinado ? '' : ' (sem certificado)'}</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DANFE NFC-e</title>
<style>
  @page { size: ${larguraMm}mm auto; margin: 2mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Courier New',monospace; font-size:${fonte}px; width:${areaMm}mm; color:#000; }
  .c { text-align:center; }
  .b { font-weight:bold; }
  .emit { font-weight:bold; font-size:${fonte + 1}px; }
  .sep { border-top:1px dashed #000; margin:4px 0; }
  .tit { font-weight:bold; font-size:${fonte - 1}px; margin:3px 0; }
  .it { margin-bottom:5px; }
  .it-l { }
  /* O número do item em cinza: some do caminho de quem procura a quantidade. */
  .it-n { color:#555; }
  /* Total de cada item na MESMA coluna do VALOR TOTAL, pra conferir de cima a
     baixo com o dedo em vez de caçar o "=" no meio da linha. */
  .it-r { padding-left:12px; display:flex; justify-content:space-between; gap:6px; }
  .row { display:flex; justify-content:space-between; }
  .tot { font-weight:bold; font-size:${fonte + 2}px; }
  .aviso { text-align:center; font-weight:bold; border:1px solid #000; padding:3px; margin:5px 0; font-size:${fonte - 1}px; }
  .chave { word-break:break-all; text-align:center; font-size:${fonte - 1}px; margin:3px 0; }
  .qr { text-align:center; margin:6px 0; }
  .qr img { width:55mm; max-width:90%; }
  .small { font-size:${fonte - 2}px; text-align:center; }
</style></head><body>
  <div class="c emit">${esc(e.fantasia || e.nome)}</div>
  <div class="c small">${esc(e.nome)}</div>
  <div class="c small">CNPJ ${fmtCnpj(e.cnpj)}</div>
  ${config?.mostrarEndereco === false ? '' : `<div class="c small">${esc(e.endereco)}</div>`}
  ${config?.cabecalho?.trim() ? `<div class="c b">${esc(config.cabecalho.trim())}</div>` : ''}
  <div class="sep"></div>
  <div class="c tit">DANFE NFC-e - Documento Auxiliar da<br>Nota Fiscal de Consumidor Eletrônica</div>
  <div class="sep"></div>
  ${itensHtml}
  <div class="sep"></div>
  <div class="row"><span>Qtde. total de itens</span><span>${qtdItens}</span></div>
  ${d.danfe.desconto ? `<div class="row"><span>Desconto</span><span>- ${cents(d.danfe.desconto)}</span></div>` : ''}
  <div class="row tot"><span>VALOR TOTAL</span><span>${cents(d.danfe.total)}</span></div>
  <div class="sep"></div>
  <div class="tit">FORMA DE PAGAMENTO</div>
  ${pagsHtml}
  <div class="sep"></div>
  <div class="c small">NFC-e nº ${d.danfe.numero} série ${d.danfe.serie}</div>
  ${aviso}
  <div class="small">Consulte pela chave de acesso em:</div>
  <div class="small">${esc(d.qr_url.split('?')[0])}</div>
  <div class="chave">${fmtChave(d.chave)}</div>
  ${protocoloHtml}
  ${d.qr_png && config?.mostrarQr !== false ? `<div class="qr"><img src="${d.qr_png}" alt="QR Code"/></div>` : ''}
  ${avisoTeste}
  ${config?.rodape?.trim() ? `<div class="sep"></div><div class="c small">${esc(config.rodape.trim())}</div>` : ''}
</body></html>`;
}

/**
 * Blocos ESC/POS do DANFE NFC-e (pro nosso agente de impressão).
 * Segue fielmente o layout OFICIAL já usado pelo sistema (o mesmo do DANFE
 * impresso via diálogo do navegador, `montarHtmlDanfe`) — mesma ordem, mesmos
 * textos ("Qtde. total de itens", "VALOR TOTAL", título em 2 linhas, URL de
 * consulta antes da chave, avisos de homologação/teste).
 */
export function montarBlocosDanfe(d: DadosDanfe): BlocoImpressao[] {
  const e = d.danfe.emitente;
  const cents = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
  const b: BlocoImpressao[] = [
    { t: 'center', b: true, txt: e.fantasia || e.nome },
    { t: 'center', txt: e.nome },
    { t: 'center', txt: 'CNPJ ' + fmtCnpj(e.cnpj) },
    { t: 'endereco', txt: e.endereco },
    { t: 'linha' },
    { t: 'center', txt: 'DANFE NFC-e - Documento Auxiliar da' },
    { t: 'center', txt: 'Nota Fiscal de Consumidor Eletrônica' },
    { t: 'linha' },
  ];
  d.danfe.itens.forEach((i, idx) => {
    b.push({ t: 'texto', txt: `${idx + 1}. ${i.descricao}` });
    // `lr` em vez de texto corrido: joga o total do item na MESMA coluna do
    // VALOR TOTAL lá embaixo, então dá pra descer o dedo pela direita conferindo.
    // Antes era "2 UN x R$ 34,90 = R$ 69,80" — três números na mesma linha, e o
    // que o cliente quer ver (o que ele vai pagar por aquele item) no meio.
    b.push({ t: 'lr', b: true, l: `  ${rotuloQtd(i.quantidade, i.unidade)} x ${cents(i.v_unit)}`, r: cents(i.v_total) });
  });
  b.push({ t: 'linha' });
  b.push({ t: 'lr', l: 'Qtde. total de itens', r: String(d.danfe.itens.length) });
  if (d.danfe.desconto) b.push({ t: 'lr', l: 'Desconto', r: `- ${cents(d.danfe.desconto)}` });
  b.push({ t: 'lr', b: true, l: 'VALOR TOTAL', r: cents(d.danfe.total) });
  b.push({ t: 'linha' }, { t: 'center', txt: 'FORMA DE PAGAMENTO' });
  for (const p of d.danfe.pagamentos) b.push({ t: 'lr', l: PAG_LABEL[p.tipo] || p.tipo, r: cents(p.valor) });
  b.push({ t: 'linha' }, { t: 'center', txt: `NFC-e nº ${d.danfe.numero} série ${d.danfe.serie}` });
  if (d.ambiente === 2) {
    b.push({ t: 'linha' });
    b.push({ t: 'center', b: true, txt: 'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO' });
    b.push({ t: 'center', b: true, txt: 'SEM VALOR FISCAL' });
    b.push({ t: 'linha' });
  }
  b.push({ t: 'center', txt: 'Consulte pela chave de acesso em:' });
  if (d.qr_url) b.push({ t: 'center', txt: d.qr_url.split('?')[0] });
  b.push({ t: 'center', txt: fmtChave(d.chave) });
  if (d.autorizada && d.protocolo) b.push({ t: 'center', txt: 'Protocolo ' + d.protocolo });
  if (d.qr_url) b.push({ t: 'qr', data: d.qr_url });
  if (!d.autorizada) {
    b.push({ t: 'linha' });
    b.push({ t: 'center', b: true, txt: `TESTE LOCAL - NAO TRANSMITIDA A SEFAZ${d.assinado ? '' : ' (SEM CERTIFICADO)'}` });
    b.push({ t: 'linha' });
  }
  b.push({ t: 'corte' });
  return b;
}

/** Monta o DANFE e imprime (agente → QZ → diálogo). */
export function imprimirDanfe(d: DadosDanfe, largura: '80' | '58' = '80'): void {
  despacharImpressao(montarHtmlDanfe(d, largura), larguraMmDe(largura), montarBlocosDanfe(d), true);
}

/* ─────────────────── Fechamento de caixa ─────────────────── */

export interface DadosFechamentoCaixa {
  loja_nome: string;
  aberto_em: string;
  fechado_em: string;
  usuario_abertura: string;
  usuario_fechamento: string;
  abertura_centavos: number;
  vendas_dinheiro_centavos: number;
  vendas_cartao_centavos: number;
  vendas_pix_centavos: number;
  vendas_quantidade: number;
  suprimentos_centavos: number;
  sangrias_centavos: number;
  esperado_centavos: number;
  contado_centavos: number;
  diferenca_centavos: number;
  observacoes?: string;
}

const reaisBr = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const dataBr = (iso: string) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

/**
 * Blocos ESC/POS do comprovante de fechamento.
 *
 * POR QUE IMPRIMIR: é o papel que o operador assina e guarda. Conferência que
 * existe só na tela não serve de nada no dia em que houver divergência e alguém
 * precisar mostrar o que foi contado, por quem e quando.
 *
 * Cartão e Pix saem em bloco SEPARADO e rotulado, igual à tela: no papel a
 * confusão é ainda mais fácil, porque quem lê depois não tem o contexto.
 */
export function montarBlocosFechamentoCaixa(d: DadosFechamentoCaixa): BlocoImpressao[] {
  const b: BlocoImpressao[] = [
    { t: 'center', b: true, txt: d.loja_nome },
    { t: 'center', b: true, txt: 'FECHAMENTO DE CAIXA' },
    { t: 'linha' },
    { t: 'lr', l: 'Abertura', r: dataBr(d.aberto_em) },
    { t: 'lr', l: 'Fechamento', r: dataBr(d.fechado_em) },
    { t: 'lr', l: 'Abriu', r: d.usuario_abertura || '—' },
    { t: 'lr', l: 'Fechou', r: d.usuario_fechamento || '—' },
    { t: 'linha' },
    { t: 'center', txt: 'DINHEIRO NA GAVETA' },
    { t: 'lr', l: 'Fundo de troco', r: reaisBr(d.abertura_centavos) },
    { t: 'lr', l: 'Vendas em dinheiro', r: reaisBr(d.vendas_dinheiro_centavos) },
  ];
  if (d.suprimentos_centavos > 0) b.push({ t: 'lr', l: 'Suprimentos', r: reaisBr(d.suprimentos_centavos) });
  if (d.sangrias_centavos > 0) b.push({ t: 'lr', l: 'Sangrias', r: '-' + reaisBr(d.sangrias_centavos) });

  b.push(
    { t: 'lr', b: true, l: 'ESPERADO', r: reaisBr(d.esperado_centavos) },
    { t: 'lr', b: true, l: 'CONTADO', r: reaisBr(d.contado_centavos) },
    { t: 'linha' },
    {
      t: 'lr', b: true,
      // Palavra explícita em vez de sinal: "-15,00" num papel térmico com pouca
      // tinta some, e "FALTA" não se confunde com nada.
      l: d.diferenca_centavos === 0 ? 'CONFERIDO'
        : d.diferenca_centavos < 0 ? 'FALTA' : 'SOBRA',
      r: reaisBr(Math.abs(d.diferenca_centavos)),
    },
  );

  if (d.vendas_cartao_centavos > 0 || d.vendas_pix_centavos > 0) {
    b.push(
      { t: 'linha' },
      { t: 'center', txt: 'NAO ENTRA NA GAVETA' },
      { t: 'texto', txt: '(cai no banco - confira pelo extrato)' },
    );
    if (d.vendas_cartao_centavos > 0) b.push({ t: 'lr', l: 'Cartao', r: reaisBr(d.vendas_cartao_centavos) });
    if (d.vendas_pix_centavos > 0) b.push({ t: 'lr', l: 'Pix', r: reaisBr(d.vendas_pix_centavos) });
  }

  b.push(
    { t: 'linha' },
    { t: 'lr', l: 'Vendas no turno', r: String(d.vendas_quantidade) },
  );
  if (d.observacoes?.trim()) {
    b.push({ t: 'linha' }, { t: 'texto', txt: 'Obs.: ' + d.observacoes.trim() });
  }
  b.push(
    { t: 'pular', n: 2 },
    { t: 'center', txt: '____________________________' },
    { t: 'center', txt: 'Assinatura do responsavel' },
    { t: 'pular', n: 1 },
    { t: 'corte' },
  );
  return b;
}

/** HTML equivalente, para o fallback do navegador (sem agente de impressão). */
export function montarHtmlFechamentoCaixa(d: DadosFechamentoCaixa, largura: '80' | '58' = '80'): string {
  const mm = largura === '58' ? 58 : 80;
  const linha = (l: string, r: string, forte = false) =>
    `<div class="row${forte ? ' b' : ''}"><span>${esc(l)}</span><span>${esc(r)}</span></div>`;
  const rotulo = d.diferenca_centavos === 0 ? 'CONFERIDO' : d.diferenca_centavos < 0 ? 'FALTA' : 'SOBRA';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Fechamento de caixa</title>
<style>
  @page { size: ${mm}mm auto; margin: 0 }
  body { width:${mm - 4}mm; margin:2mm; font-family:'DejaVu Sans Mono',monospace; font-size:12px }
  .c { text-align:center } .b { font-weight:700 }
  .row { display:flex; justify-content:space-between; gap:6px }
  hr { border:0; border-top:1px dashed #000; margin:4px 0 }
  .ass { margin-top:14mm; text-align:center }
</style></head><body>
<div class="c b">${esc(d.loja_nome)}</div>
<div class="c b">FECHAMENTO DE CAIXA</div><hr>
${linha('Abertura', dataBr(d.aberto_em))}
${linha('Fechamento', dataBr(d.fechado_em))}
${linha('Abriu', d.usuario_abertura || '—')}
${linha('Fechou', d.usuario_fechamento || '—')}<hr>
<div class="c">DINHEIRO NA GAVETA</div>
${linha('Fundo de troco', reaisBr(d.abertura_centavos))}
${linha('Vendas em dinheiro', reaisBr(d.vendas_dinheiro_centavos))}
${d.suprimentos_centavos > 0 ? linha('Suprimentos', reaisBr(d.suprimentos_centavos)) : ''}
${d.sangrias_centavos > 0 ? linha('Sangrias', '-' + reaisBr(d.sangrias_centavos)) : ''}
${linha('ESPERADO', reaisBr(d.esperado_centavos), true)}
${linha('CONTADO', reaisBr(d.contado_centavos), true)}<hr>
${linha(rotulo, reaisBr(Math.abs(d.diferenca_centavos)), true)}
${(d.vendas_cartao_centavos > 0 || d.vendas_pix_centavos > 0) ? `<hr>
<div class="c">NÃO ENTRA NA GAVETA</div>
<div style="font-size:11px">(cai no banco — confira pelo extrato)</div>
${d.vendas_cartao_centavos > 0 ? linha('Cartão', reaisBr(d.vendas_cartao_centavos)) : ''}
${d.vendas_pix_centavos > 0 ? linha('Pix', reaisBr(d.vendas_pix_centavos)) : ''}` : ''}
<hr>${linha('Vendas no turno', String(d.vendas_quantidade))}
${d.observacoes?.trim() ? `<hr><div>Obs.: ${esc(d.observacoes.trim())}</div>` : ''}
<div class="ass">____________________________<br>Assinatura do responsável</div>
</body></html>`;
}

/** Imprime o fechamento: agente ESC/POS quando disponível, senão o navegador. */
export function imprimirFechamentoCaixa(d: DadosFechamentoCaixa, largura: '80' | '58' = '80'): void {
  despacharImpressao(
    montarHtmlFechamentoCaixa(d, largura),
    largura === '58' ? 58 : 80,
    montarBlocosFechamentoCaixa(d),
  );
}
