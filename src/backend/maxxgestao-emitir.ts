/**
 * MANDAR O PEDIDO PARA O MAXX GESTÃO.
 *
 * Uma chamada: `POST /documento` como `PV` (pedido de venda), com os itens
 * vinculados às mercadorias do ERP. **A parte fiscal é resolvida lá** — decisão
 * do dono do projeto, e a certa: natureza de operação, forma de pagamento e
 * tributação são cadastro do ERP, e cada uma que tentássemos resolver daqui
 * seria palpite sobre dado que não é nosso.
 *
 * `transformar` e `emitir` existem na API e chegaram a ser chamados aqui.
 * Saíram junto com essa decisão: o pedido chega, e quem fecha a nota é quem tem
 * o certificado e a numeração.
 *
 * A PARTE PERIGOSA CONTINUA SENDO A CRIAÇÃO. `POST /documento` não é
 * idempotente do lado deles: chamar duas vezes cria dois documentos. Por isso o
 * id é GRAVADO NO PEDIDO assim que ele existe, e a criação só acontece com o
 * campo vazio.
 *
 * O `idExterno` (o id do nosso pedido, dentro do documento) é a rede de
 * segurança da rede de segurança: se a resposta se perder no caminho e a marca
 * não for gravada, ele permite achar o documento órfão pelo número do pedido em
 * vez de criar outro às cegas.
 */
import db from './db-mysql';
import { agoraUTC } from './util';

/**
 * AGORA EM HORÁRIO DE BRASÍLIA, no formato que o ERP usa: sem fuso, sem `Z`.
 *
 * `toISOString()` sempre devolve UTC com `Z` no fim; cortar o `Z` de um valor
 * UTC seria mentir sobre o fuso em vez de converter. Aqui o instante é
 * deslocado ANTES de formatar, e o `Z` sai — o que resta é hora local de
 * verdade, do jeito que os documentos deles vêm.
 *
 * Offset fixo de -3h, como em `dataBrasilia`: o Brasil não tem horário de verão
 * desde 2019, e se voltar, os dois lugares mudam junto.
 */
export function agoraBrasiliaIso(agoraMs: number = Date.now()): string {
  return new Date(agoraMs - 3 * 60 * 60 * 1000).toISOString().replace('Z', '');
}
import { descriptografar } from './cripto';
import { chamarMaxxGestao, ErroMaxxGestao, type OpcoesMaxxGestao } from './maxxgestao-cliente';
import { todasAsPaginas } from './maxxgestao-catalogo';
import {
  montarDocumento, diferencaDoTotal,
  type DadosDoPedido, type ItemPedido,
} from './maxxgestao-documento';
import {
  acharPessoaPorCpf, criarPessoa, corpoDaPessoa, municipioDoCliente,
  type ClienteParaErp,
} from './maxxgestao-pessoa';

/**
 * O CLIENTE DO PEDIDO, ESPELHADO NO ERP. Zero quando não deu.
 *
 * Ordem: o que já está guardado → achar pelo CPF → criar. Guardar é o que
 * impede uma duplicata do mesmo cliente por pedido no cadastro do lojista.
 *
 * NUNCA LANÇA. Quem chama cai no consumidor final padrão: documento sem o
 * cliente ainda é o pedido registrado, e não enviar por causa de um cadastro
 * perderia a venda no ERP.
 */
async function pessoaDoCliente(
  token: string,
  clienteId: number,
  empresa: { municipio: string; uf: string; idIbgeMunicipio: number },
  opcoes: OpcoesMaxxGestao = {},
): Promise<number> {
  if (!clienteId) return 0;

  const u = await db.prepare(
    `SELECT nome, email, telefone, COALESCE(cpf, '') AS cpf,
            COALESCE(maxxgestao_pessoa_id, 0) AS pessoa
       FROM usuarios WHERE id = ?`
  ).get(clienteId) as {
    nome: string; email: string; telefone: string; cpf: string; pessoa: number;
  } | undefined;
  if (!u) return 0;

  if (Number(u.pessoa) > 0) return Number(u.pessoa);

  const endereco = await db.prepare(
    `SELECT rua, numero, complemento, bairro, cidade, uf, cep
       FROM enderecos WHERE usuario_id = ? ORDER BY id DESC LIMIT 1`
  ).get(clienteId) as {
    rua: string; numero: string; complemento: string; bairro: string;
    cidade: string; uf: string; cep: string;
  } | undefined;

  const cliente: ClienteParaErp = {
    nome: u.nome ?? '',
    cpf: u.cpf ?? '',
    telefone: u.telefone ?? '',
    email: u.email ?? '',
    endereco: endereco ? {
      rua: endereco.rua ?? '', numero: endereco.numero ?? '',
      complemento: endereco.complemento ?? '', bairro: endereco.bairro ?? '',
      cidade: endereco.cidade ?? '', uf: endereco.uf ?? '', cep: endereco.cep ?? '',
    } : undefined,
  };

  try {
    const achada = await acharPessoaPorCpf(token, cliente.cpf, opcoes);
    if (achada > 0) {
      await db.prepare('UPDATE usuarios SET maxxgestao_pessoa_id = ? WHERE id = ?').run(achada, clienteId);
      return achada;
    }

    const municipio = municipioDoCliente(cliente.endereco?.cidade ?? '', cliente.endereco?.uf ?? '', empresa);
    if (cliente.endereco && municipio === 0) {
      /* Cidade fora da do lojista: a pessoa vai sem endereço, porque endereço
         com município errado é pior que endereço ausente. Ver `municipioDoCliente`. */
      console.log(`[erp] cliente ${clienteId}: cidade "${cliente.endereco.cidade}/${cliente.endereco.uf}" não é a da empresa — pessoa criada sem endereço`);
    }

    const nova = await criarPessoa(token, corpoDaPessoa(cliente, municipio), opcoes);
    if (nova > 0) {
      await db.prepare('UPDATE usuarios SET maxxgestao_pessoa_id = ? WHERE id = ?').run(nova, clienteId);
      console.log(`[erp] cliente ${clienteId} (${cliente.nome}) espelhado no ERP como pessoa ${nova}`);
    }
    return nova;
  } catch (e) {
    console.log(`[erp] cliente ${clienteId}: não consegui espelhar no ERP (${(e as Error).message}) — vai como consumidor final`);
    return 0;
  }
}

/** Uma forma de pagamento da natureza de operação, no ERP. */
export interface FormaPagamentoErp {
  id: number;
  nome: string;
}

/**
 * As formas de pagamento LIGADAS À NATUREZA DE OPERAÇÃO.
 *
 * Não é a lista geral do ERP: é o que aquela natureza aceita. Na conta da
 * Unimaxx esta lista voltava VAZIA em 02/09/2026 — configuração pendente no
 * portal deles, e é isso que impede a emissão até ser resolvido.
 */
/**
 * TODAS as formas de pagamento da empresa — `GET /api/pagamento/v1`.
 *
 * É a reserva de `formasDaNatureza`, que na conta conferida volta VAZIA. E
 * funciona: o documento aceitou `idPagamento: 1` (Dinheiro) mesmo sem a forma
 * estar ligada à natureza, então exigir a ligação era exigência nossa, não do
 * ERP.
 */
export async function formasDaEmpresa(
  token: string,
  opcoes: OpcoesMaxxGestao = {},
): Promise<FormaPagamentoErp[]> {
  const brutos = await todasAsPaginas<Record<string, unknown>>(async p => {
    const d = await chamarMaxxGestao(token, `/api/pagamento/v1?page=${p}&limit=100`, opcoes) as Record<string, unknown> | null;
    const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
    return {
      page: Number(o.page ?? 1), limit: Number(o.limit ?? 0), total: Number(o.total ?? 0),
      totalPages: Number(o.totalPages ?? 1), hasNext: !!o.hasNext,
      items: Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : [],
    };
  });
  return brutos
    .map(f => ({ id: Number(f.codigo ?? 0), nome: String(f.descricao ?? '').trim() }))
    .filter(f => f.id > 0 && f.nome);
}

export async function formasDaNatureza(
  token: string,
  idNatureza: number,
  opcoes: OpcoesMaxxGestao = {},
): Promise<FormaPagamentoErp[]> {
  const brutos = await todasAsPaginas<Record<string, unknown>>(async p => {
    const d = await chamarMaxxGestao(
      token, `/api/natureza-operacao/${idNatureza}/pagamentos/v1?page=${p}&limit=100`, opcoes,
    ) as Record<string, unknown> | null;
    const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
    return {
      page: Number(o.page ?? 1), limit: Number(o.limit ?? 0), total: Number(o.total ?? 0),
      totalPages: Number(o.totalPages ?? 1), hasNext: !!o.hasNext,
      items: Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : [],
    };
  });
  return brutos
    .map(f => ({ id: Number(f.codigo ?? f.idPagamento ?? 0), nome: String(f.descricao ?? f.nome ?? '').trim() }))
    .filter(f => f.id > 0);
}

/**
 * Os nomes que cada forma nossa pode ter no ERP.
 *
 * Por NOME e não por número fixo porque a lista é de cada cliente: o "3" da
 * Unimaxx não é o "3" de outra loja, e número errado aqui é nota com forma de
 * pagamento errada — que a SEFAZ autoriza, porque o código é válido, e que só
 * aparece numa fiscalização.
 */
const APELIDOS: Record<string, string[]> = {
  /*
   * A ORDEM É PREFERÊNCIA, não sinônimo. A conta da Unimaxx tem quatro formas
   * de Pix — "PIX - MANUAL", "Pix - InfoPago", "Pixei - PIX" — e as três
   * últimas são integrações de gateway. Dinheiro que entrou pelo NOSSO app é
   * recebimento manual do ponto de vista do ERP.
   */
  pix: ['pix - manual', 'pix manual', 'pix', 'pix - infopago', 'pixei - pix'],
  cartao_online: ['cartao de credito', 'cartão de crédito', 'credito', 'crédito', 'cartao', 'cartão'],
  dinheiro: ['dinheiro', 'especie', 'espécie'],
  /*
   * `cartao_entrega` NÃO ENTRA, de propósito.
   *
   * O cliente escolheu "cartão na entrega" e ninguém registrou se passou
   * crédito ou débito. A conta tem as duas formas separadas, e escolher uma
   * seria o mesmo palpite que `tipo-pagamento-nfce.ts` dá hoje ao declarar todo
   * cartão como crédito — só que agora o palpite entraria no financeiro de
   * verdade. Sem forma, o documento vai sem pagamento e quem sabe informa lá.
   */
};

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Acha a forma do ERP que corresponde à do pedido. Zero quando não acha.
 *
 * ZERO E NÃO UM CHUTE. Devolver a primeira da lista "para não falhar" é o
 * caminho para a nota sair com a forma errada — e quem chama trata o zero como
 * impedimento, que é o comportamento certo.
 */
export function acharPagamento(formas: FormaPagamentoErp[], formaDoPedido: string): number {
  const apelidos = (APELIDOS[formaDoPedido] ?? []).map(semAcento);
  if (!apelidos.length) return 0;

  /*
   * PERCORRE OS APELIDOS NA ORDEM, e cada um tenta exato antes de "contém".
   *
   * Fazer o contrário — varrer as formas e aceitar qualquer apelido — deixava a
   * ordem da resposta da API decidir: "Pixei - PIX" ganharia de "PIX - MANUAL"
   * só por vir antes na lista. E o exato antes do "contém" existe para "CARTAO
   * DEBITO" não ganhar de "CARTAO DE CREDITO" numa conta que tem os dois.
   */
  for (const apelido of apelidos) {
    const exato = formas.find(f => semAcento(f.nome) === apelido);
    if (exato) return exato.id;
  }
  for (const apelido of apelidos) {
    const contem = formas.find(f => semAcento(f.nome).includes(apelido));
    if (contem) return contem.id;
  }
  return 0;
}

/** O id do documento criado, tirado da resposta deles. */
export function idDoDocumento(resposta: unknown): number {
  const d = (resposta && typeof resposta === 'object' ? resposta : {}) as Record<string, unknown>;
  /* Três nomes possíveis porque a resposta de criação não está documentada; o
     primeiro que vier com número positivo vale. */
  for (const chave of ['id', 'codigo', 'idDocumento']) {
    const n = Number(d[chave] ?? 0);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const dentro = (d.documento && typeof d.documento === 'object' ? d.documento : {}) as Record<string, unknown>;
  for (const chave of ['id', 'codigo', 'idDocumento']) {
    const n = Number(dentro[chave] ?? 0);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/**
 * DESCOBRIR O `idUsuario` LENDO UM DOCUMENTO QUE JÁ EXISTE.
 *
 * O documento exige `idUsuario`, e não há como perguntar: a lista de usuários
 * da API devolve e-mail e `codigoExterno`, mas NÃO o id — mandar o código
 * externo volta "Usuario 4000 nao encontrado para a organizacao do token". Nem
 * o lojista conseguiria informar um número que a API dele não mostra.
 *
 * Então o valor vem do próprio ERP: o documento mais recente traz o `idUsuario`
 * de quem opera aquela empresa. É dado deles, não palpite nosso — e foi assim
 * que o primeiro documento do delivery entrou (id 5470 na conta da Unimaxx).
 */
export async function descobrirIdUsuario(
  token: string,
  opcoes: OpcoesMaxxGestao = {},
): Promise<number> {
  const d = await chamarMaxxGestao(token, '/api/documento/v1?page=1&limit=1', opcoes) as
    { items?: Array<{ idUsuario?: unknown }> } | null;
  const bruto = d?.items?.[0]?.idUsuario;
  const n = Number(bruto ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * FECHA O DOCUMENTO NO ERP quando a nota saiu DAQUI.
 *
 * O caso real: a loja está com o Maxx Gestão como emissor, o pedido subiu como
 * Pedido de Venda, e alguém emitiu a NFC-e no delivery pela saída de emergência.
 * O documento ficava lá em RASCUNHO, esperando faturamento — e faturar de novo
 * seria a segunda nota da mesma venda.
 *
 * `status: 'E'` = Emitido. As letras não estão na documentação; foram lidas dos
 * documentos da própria conta (R = Rascunho, E = Emitido), e Pedido de Venda
 * deles aparece como E quando concluído.
 *
 * O QUE ISTO NÃO FAZ: o ERP não passa a conhecer a nota. A numeração e o
 * certificado da NFC-e emitida aqui são NOSSOS, e a API pública não tem campo
 * para referenciar chave de nota externa (a aba "Chave/Referênciadas" da tela
 * deles não está exposta). Do lado do ERP, o pedido fica concluído sem
 * documento fiscal próprio — o que é decisão de contabilidade, não nossa.
 *
 * NUNCA LANÇA: a nota já está autorizada. Falhar aqui é inconveniente, não erro
 * fiscal — e tratar como erro faria alguém tentar emitir de novo.
 */
export async function fecharDocumentoNoErp(pedidoId: number, opcoes: OpcoesMaxxGestao = {}): Promise<boolean> {
  const pedido = await db.prepare(
    'SELECT loja_id, maxxgestao_documento_id FROM pedidos WHERE id = ?'
  ).get(pedidoId) as { loja_id: number; maxxgestao_documento_id: number } | undefined;
  const documento = Number(pedido?.maxxgestao_documento_id ?? 0);
  if (!pedido || documento <= 0) return false;

  const loja = await db.prepare('SELECT maxxgestao_token FROM lojas WHERE id = ?')
    .get(pedido.loja_id) as { maxxgestao_token: string | null } | undefined;
  let token = '';
  try { token = loja?.maxxgestao_token ? descriptografar(loja.maxxgestao_token) : ''; } catch { token = ''; }
  if (!token) return false;

  try {
    await chamarMaxxGestao(token, `/api/documento/${documento}/status/v1`, opcoes, {
      method: 'POST',
      body: JSON.stringify({ status: 'E' }),
    });
    console.log(`[erp] pedido ${pedidoId}: documento ${documento} marcado como Emitido — a nota saiu do delivery`);
    return true;
  } catch (e) {
    console.log(`[erp] pedido ${pedidoId}: nota emitida aqui, mas não consegui fechar o documento ${documento} no ERP: ${(e as Error).message}`);
    return false;
  }
}

/**
 * A CHAVE DE 44 DÍGITOS numa resposta deles. Vazio quando não veio.
 *
 * O `transformar` devolve `chave: ""` — a chave só nasce no `emitir`, que é
 * quando o número da sequência fiscal é consumido.
 */
export function chaveDaResposta(resposta: unknown): string {
  const d = (resposta && typeof resposta === 'object' ? resposta : {}) as Record<string, unknown>;
  const bruta = String(d.chave ?? d.chaveAcesso ?? '').replace(/\D/g, '');
  return bruta.length === 44 ? bruta : '';
}

/**
 * TRANSFORMAR EM NFC-E E EMITIR — os dois passos que fecham a nota no ERP.
 *
 * `transformar` com `modelo: '65'` (65 = NFC-e; 55 = NF-e) NÃO consome número:
 * medido, ele devolve `numero: 0` e `chave: ""`. O número e a chave nascem no
 * `emitir`, e é só esse passo que não tem volta.
 *
 * NUNCA LANÇA. O documento já existe no ERP — falhar aqui deixa um rascunho
 * para o lojista faturar na mão, o que é recuperável. Propagar o erro faria a
 * próxima tentativa querer CRIAR outro documento para a mesma venda.
 */
export async function emitirDocumentoNoErp(
  token: string,
  documento: number,
  pedidoId: number,
  opcoes: OpcoesMaxxGestao = {},
): Promise<{ emitiu: boolean; chave: string; motivo?: string }> {
  try {
    await chamarMaxxGestao(token, `/api/documento/${documento}/transformar/v1`, opcoes, {
      method: 'POST',
      body: JSON.stringify({ modelo: '65' }),
    });
  } catch (e) {
    const motivo = (e as Error).message;
    console.log(`[erp] pedido ${pedidoId}: documento ${documento} criado, mas transformar em NFC-e falhou: ${motivo}`);
    return { emitiu: false, chave: '', motivo };
  }

  try {
    const resp = await chamarMaxxGestao(token, `/api/documento/${documento}/emitir/v1`, opcoes, { method: 'POST' });
    const chave = chaveDaResposta(resp);
    if (chave) {
      await db.prepare('UPDATE pedidos SET maxxgestao_chave = ? WHERE id = ?').run(chave, pedidoId);
    }
    console.log(
      `[erp] pedido ${pedidoId}: NFC-e emitida no ERP (documento ${documento})`
      + (chave ? ` — chave ${chave}` : ' — chave não veio na resposta'),
    );
    return { emitiu: true, chave };
  } catch (e) {
    /*
     * A REJEIÇÃO DA SEFAZ CHEGA AQUI, e é o caso mais provável de falha: NFC-e
     * de entrega sem CPF do destinatário é recusada. O documento fica
     * transformado e não emitido — o lojista corrige o cadastro e emite na tela
     * do ERP, sem perder a venda.
     */
    const motivo = (e as Error).message;
    console.log(`[erp] pedido ${pedidoId}: documento ${documento} transformado, mas a emissão foi recusada: ${motivo}`);
    return { emitiu: false, chave: '', motivo };
  }
}

export interface ResultadoEmissao {
  /** O documento foi criado no ERP? A NOTA é emitida lá, por gente. */
  emitiu: boolean;
  documento?: number;
  motivo?: string;
  chave?: string;
}

/**
 * O caminho completo, para um pedido.
 *
 * NUNCA LANÇA. Emissão de nota que derruba a rota do entregador seria trocar um
 * problema fiscal por um problema operacional — o pedido tem que seguir mesmo
 * quando a nota não sai. O motivo vai no retorno e no log.
 */
export async function enviarPedidoAoErp(
  pedidoId: number,
  opcoes: OpcoesMaxxGestao = {},
): Promise<ResultadoEmissao> {
  const pedido = await db.prepare(
    `SELECT id, loja_id, cliente_id, total_centavos, forma_pagamento, tipo_entrega,
            maxxgestao_documento_id
       FROM pedidos WHERE id = ?`
  ).get(pedidoId) as {
    id: number; loja_id: number; cliente_id: number; total_centavos: number;
    forma_pagamento: string; tipo_entrega: string; maxxgestao_documento_id: number;
  } | undefined;
  if (!pedido) return { emitiu: false, motivo: 'pedido não encontrado' };

  /* JÁ TEM DOCUMENTO: não cria outro. Dois documentos para a mesma venda
     consomem dois números da sequência fiscal, e desfazer isso custa
     cancelamento. */
  if (Number(pedido.maxxgestao_documento_id) > 0) {
    return { emitiu: false, documento: Number(pedido.maxxgestao_documento_id), motivo: 'já tem documento' };
  }

  const loja = await db.prepare(
    `SELECT nfce_emissor, maxxgestao_token, maxxgestao_id_usuario, maxxgestao_auto_emitir
       FROM lojas WHERE id = ?`
  ).get(pedido.loja_id) as {
    nfce_emissor: string | null; maxxgestao_token: string | null;
    maxxgestao_id_usuario: number | null; maxxgestao_auto_emitir: number | null;
  } | undefined;

  if (String(loja?.nfce_emissor ?? 'sistema') !== 'erp') {
    return { emitiu: false, motivo: 'esta loja não emite pelo Maxx Gestão' };
  }
  let token = '';
  try { token = loja?.maxxgestao_token ? descriptografar(loja.maxxgestao_token) : ''; } catch { token = ''; }
  if (!token) return { emitiu: false, motivo: 'token do Maxx Gestão não configurado' };

  const itens = await db.prepare(
    `SELECT i.nome_produto, i.quantidade, i.preco_unit_centavos,
            COALESCE(p.maxxgestao_variacao_id, 0) AS variacao
       FROM itens_pedido i
       LEFT JOIN produtos p ON p.id = i.produto_id
      WHERE i.pedido_id = ?`
  ).all(pedidoId) as Array<{
    nome_produto: string; quantidade: number; preco_unit_centavos: number; variacao: number;
  }>;

  const dados: DadosDoPedido = {
    id: pedido.id,
    totalCentavos: Number(pedido.total_centavos) || 0,
    formaPagamento: String(pedido.forma_pagamento ?? ''),
    tipoEntrega: String(pedido.tipo_entrega ?? 'entrega') === 'retirada' ? 'retirada' : 'entrega',
    itens: itens.map((i): ItemPedido => ({
      nome: i.nome_produto ?? '',
      quantidade: Number(i.quantidade) || 1,
      precoUnitarioCentavos: Number(i.preco_unit_centavos) || 0,
      variacaoErp: Number(i.variacao) || 0,
    })),
  };

  /*
   * A NATUREZA E O CONSUMIDOR PADRÃO vêm do ERP, não de constante nossa: são de
   * cada empresa. `idPessoaPadrao` é o consumidor final que dispensa cadastrar
   * cliente por venda.
   */
  let idNatureza = 0;
  let idPessoa = 0;
  let idPagamento = 0;
  let idUsuario = 0;
  try {
    const cfg = await chamarMaxxGestao(token, '/api/empresa/configuracoes/v1', opcoes) as Record<string, unknown> | null;
    idPessoa = Number(cfg?.idPessoaPadrao ?? 0);

    /*
     * O CLIENTE NO LUGAR DO CONSUMIDOR FINAL.
     *
     * `idPessoaPadrao` fica como reserva: sem o cliente identificado, a NFC-e de
     * entrega é rejeitada pela SEFAZ ("sem a identificacao do destinatario"),
     * mas o pedido registrado no ERP ainda vale mais que pedido nenhum.
     */
    const empresa = await chamarMaxxGestao(token, '/api/empresa/v1', opcoes) as Record<string, unknown> | null;
    const doCliente = await pessoaDoCliente(token, Number(pedido.cliente_id) || 0, {
      municipio: String(empresa?.municipio ?? ''),
      uf: String(empresa?.uf ?? ''),
      idIbgeMunicipio: Number(empresa?.idIbgeMunicipio ?? 0),
    }, opcoes);
    if (doCliente > 0) idPessoa = doCliente;
    /* Natureza 1 = "VENDA DE MERCADORIA DENTRO DO ESTADO" (CFOP 5102) na conta
       conferida. Fica aqui como padrão até virar configuração por loja. */
    idNatureza = 1;

    /*
     * O USUÁRIO É GUARDADO NA LOJA depois de descoberto. Uma leitura por
     * pedido seria uma requisição a mais em cada venda, contra um limite de 20
     * por minuto — e o valor não muda.
     */
    idUsuario = Number(loja?.maxxgestao_id_usuario ?? 0);
    if (idUsuario <= 0) {
      idUsuario = await descobrirIdUsuario(token, opcoes);
      if (idUsuario > 0) {
        await db.prepare('UPDATE lojas SET maxxgestao_id_usuario = ? WHERE id = ?')
          .run(idUsuario, pedido.loja_id);
        console.log(`[erp] loja ${pedido.loja_id}: idUsuario do ERP descoberto: ${idUsuario}`);
      }
    }
  } catch (e) {
    const erro = e as ErroMaxxGestao;
    return { emitiu: false, motivo: `não consegui ler a configuração do ERP: ${erro.message}` };
  }

  /*
   * A FORMA DE PAGAMENTO É TENTATIVA, NÃO REQUISITO.
   *
   * Se estiver ligada à natureza no ERP, o documento chega completo. Se não —
   * e hoje `/natureza-operacao/1/pagamentos` volta vazio — o pedido vai sem, e
   * a forma é escolhida lá. Falhar aqui bloquearia o envio por causa de um
   * cadastro que não é nosso.
   */
  try {
    /*
     * A NATUREZA PRIMEIRO, A EMPRESA DEPOIS. A lista da natureza é a mais
     * específica; quando ela está vazia — e está, nesta conta — a lista geral
     * resolve, e o ERP aceita: provado com `idPagamento: 1` num documento sem
     * a forma ligada à natureza.
     */
    idPagamento = acharPagamento(await formasDaNatureza(token, idNatureza, opcoes), dados.formaPagamento);
    if (idPagamento <= 0) {
      idPagamento = acharPagamento(await formasDaEmpresa(token, opcoes), dados.formaPagamento);
    }
  } catch (e) {
    console.log(`[erp] pedido ${pedidoId}: não consegui ler as formas de pagamento (${(e as Error).message}) — vai sem`);
  }
  if (idPagamento <= 0) {
    console.log(`[erp] pedido ${pedidoId}: não achei forma de pagamento para "${dados.formaPagamento}" no ERP — documento vai sem`);
  }

  const { corpo, impedimentos } = montarDocumento(dados, {
    idNaturezaOperacao: idNatureza,
    idPessoa,
    idUsuario,
    idPagamento,
    /* HORA DE BRASÍLIA. Os documentos do ERP vêm sem fuso, em hora local:
       mandar UTC joga o pedido três horas para frente e, à noite, para o dia
       seguinte. */
    dataHora: agoraBrasiliaIso(),
  });

  if (!corpo) {
    const motivo = impedimentos.join('; ');
    console.log(`[erp] pedido ${pedidoId} NÃO emitido: ${motivo}`);
    return { emitiu: false, motivo };
  }

  /* A diferença do total é a taxa de entrega, quase sempre. Registrar é o que
     permite descobrir o dia em que for outra coisa. */
  const diferenca = diferencaDoTotal(dados);
  if (diferenca !== 0) {
    console.log(`[erp] pedido ${pedidoId}: total do pedido difere da soma dos itens em ${diferenca} centavos (taxa de entrega?)`);
  }

  const comecou = Date.now();
  let documento = 0;
  try {
    documento = idDoDocumento(await chamarMaxxGestao(
      token, '/api/documento/v1', opcoes, { method: 'POST', body: JSON.stringify(corpo) }));
  } catch (e) {
    const erro = e as ErroMaxxGestao;
    /*
     * FALHA NA CRIAÇÃO É O CASO INDEFINIDO. Com `httpStatus` zero (rede), o
     * documento pode ter sido criado do lado deles sem a resposta chegar —
     * repetir criaria o segundo. O `idExterno` é o que permite achar o órfão
     * depois; aqui a gente para e reporta.
     */
    const motivo = erro.httpStatus === 0
      ? `não sei se o documento foi criado (${erro.message}) — confira pelo idExterno ${pedidoId} antes de repetir`
      : `criação recusada: ${erro.message}`;
    console.log(`[erp] pedido ${pedidoId}: ${motivo}`);
    return { emitiu: false, motivo };
  }

  if (documento <= 0) {
    console.log(`[erp] pedido ${pedidoId}: o ERP aceitou a criação mas não devolveu o id do documento`);
    return { emitiu: false, motivo: 'o ERP não devolveu o id do documento' };
  }

  /* MARCA O DOCUMENTO. Ele existe: sem gravar, uma segunda passada criaria
     outro para a mesma venda. */
  await db.prepare('UPDATE pedidos SET maxxgestao_documento_id = ?, maxxgestao_emitido_em = ? WHERE id = ?')
    .run(documento, agoraUTC(), pedidoId);

  console.log(`[erp] pedido ${pedidoId}: enviado ao Maxx Gestão como documento ${documento} em ${Date.now() - comecou}ms`);

  /*
   * A EMISSÃO AUTOMÁTICA É OPCIONAL E DESLIGADA POR PADRÃO.
   *
   * Ligada, o gatilho da nota passa a ser o clique de "Já entreguei" — sem
   * ninguém revisar o documento antes. Emitir não tem volta, então quem liga
   * precisa ter decidido isso; e falhar aqui NÃO desfaz o envio: o documento
   * fica no ERP para ser faturado na mão.
   */
  if (Number(loja?.maxxgestao_auto_emitir ?? 0) === 1) {
    await emitirDocumentoNoErp(token, documento, pedidoId, opcoes);
  }

  return { emitiu: true, documento };

}
