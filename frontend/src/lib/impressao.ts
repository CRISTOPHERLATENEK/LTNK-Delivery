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

/** Fallback: abre uma janela com o HTML e chama o diálogo de impressão. */
function abrirEImprimir(html: string): void {
  const w = window.open('', '_blank', 'width=360,height=680,toolbar=0');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 300);
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
      <div class="it-l">${idx + 1} ${esc(i.descricao)}</div>
      <div class="it-r">${i.quantidade} ${esc(i.unidade)} x ${cents(i.v_unit)} = <b>${cents(i.v_total)}</b></div>
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
  .it { margin-bottom:3px; }
  .it-l { }
  .it-r { padding-left:10px; }
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
    b.push({ t: 'texto', txt: `${idx + 1} ${i.descricao}` });
    b.push({ t: 'texto', txt: `${i.quantidade} ${i.unidade} x ${cents(i.v_unit)} = ${cents(i.v_total)}` });
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
