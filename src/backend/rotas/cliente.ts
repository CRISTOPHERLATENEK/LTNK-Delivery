/**
 * Módulo do CLIENTE: endereços, criação de pedido com validação de opções,
 * acompanhamento, cancelamento e "pedir de novo".
 * REGRA CRÍTICA: preços recalculados no servidor a partir do banco.
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import db, { comTransacao, bancoTenantAtual } from '../db-mysql';
import { autenticar, exigirPerfil } from '../auth';
import { agoraUTC, textoLimpo, inteiroPositivo, reaisParaCentavos, telefoneDigitos, erroHttp, normalizarBairro, dataBrasilia} from '../util';
import { precoVigente } from '../preco-produto';
import { transicionarStatus } from '../fluxoPedido';
import { notificarLojistaNovoPedido } from '../notificacoes';
import { notificarPedidoWhatsApp } from '../whatsapp';
import { comissaoPercentualDaLoja } from '../comissao';
import { geocodificar } from '../geo';
import { resolverFrete, type EnderecoParaFrete } from '../frete';
import { saboresLiberados, maxEscolhasEfetivo, precoDoGrupo, contarFracoes } from '../opcoes-preco';
import { SQL_GRUPOS_DO_PRODUTO } from '../grupos-sql';
import { criarCobrancaPix, pagamentoOnlineAtivo, cartaoOnlineAtivo, conferirPagamentoAgora, publicKeyMP, criarPagamentoCartao, aplicarResultadoCartao } from './pagamentos';
import { Endereco, GrupoOpcao, ItemRequisicaoPedido, Loja, OpcaoItem, Pedido, Produto } from '../../tipos/modelos';
import { dadosAnonimos, ehAnonimizado, ENDERECO_ANONIMO, TEXTO_ANONIMO } from '../anonimizacao';

const router = Router();
router.use(autenticar, exigirPerfil('cliente'));

// ----- Endereços -----------------------------------------------------------

router.get('/enderecos', async (req, res, next) => {
  try {
    const enderecos = await db.prepare(
      'SELECT * FROM enderecos WHERE usuario_id = ? ORDER BY id DESC'
    ).all(req.usuario!.id);
    res.json({ enderecos });
  } catch (err) { next(err); }
});

router.post('/enderecos', async (req, res, next) => {
  try {
    const e = {
      rotulo: textoLimpo(req.body.rotulo, 40) || 'Casa',
      rua: textoLimpo(req.body.rua, 150),
      numero: textoLimpo(req.body.numero, 20),
      complemento: textoLimpo(req.body.complemento, 100),
      bairro: textoLimpo(req.body.bairro, 80),
      cidade: textoLimpo(req.body.cidade, 80),
      uf: textoLimpo(req.body.uf, 2).toUpperCase(),
      cep: textoLimpo(req.body.cep, 12),
      referencia: textoLimpo(req.body.referencia, 150),
    };
    if (!e.rua || !e.numero || !e.bairro || !e.cidade || e.uf.length !== 2) {
      throw erroHttp(400, 'Preencha rua, número, bairro, cidade e UF.');
    }
    const coord = await geocodificar(e); // best-effort: null se não achar
    const info = await db.prepare(
      `INSERT INTO enderecos (usuario_id, rotulo, rua, numero, complemento, bairro, cidade, uf, cep, referencia, lat, lon, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.usuario!.id, e.rotulo, e.rua, e.numero, e.complemento, e.bairro, e.cidade, e.uf, e.cep, e.referencia,
          coord?.lat ?? null, coord?.lon ?? null, agoraUTC());
    res.status(201).json({ endereco: { id: Number(info.lastInsertRowid), ...e, lat: coord?.lat ?? null, lon: coord?.lon ?? null } });
  } catch (err) { next(err); }
});

router.put('/enderecos/:id', async (req, res, next) => {
  try {
    const atual = await db.prepare('SELECT id FROM enderecos WHERE id = ? AND usuario_id = ?')
      .get(req.params.id, req.usuario!.id) as { id: number } | undefined;
    if (!atual) throw erroHttp(404, 'Endereço não encontrado.');
    const e = {
      rotulo: textoLimpo(req.body.rotulo, 40) || 'Casa',
      rua: textoLimpo(req.body.rua, 150),
      numero: textoLimpo(req.body.numero, 20),
      complemento: textoLimpo(req.body.complemento, 100),
      bairro: textoLimpo(req.body.bairro, 80),
      cidade: textoLimpo(req.body.cidade, 80),
      uf: textoLimpo(req.body.uf, 2).toUpperCase(),
      cep: textoLimpo(req.body.cep, 12),
      referencia: textoLimpo(req.body.referencia, 150),
    };
    if (!e.rua || !e.numero || !e.bairro || !e.cidade || e.uf.length !== 2) {
      throw erroHttp(400, 'Preencha rua, número, bairro, cidade e UF.');
    }
    const coord = await geocodificar(e); // re-geocodifica: o endereço pode ter mudado
    await db.prepare(
      `UPDATE enderecos SET rotulo=?, rua=?, numero=?, complemento=?, bairro=?, cidade=?, uf=?, cep=?, referencia=?, lat=?, lon=?
        WHERE id = ?`
    ).run(e.rotulo, e.rua, e.numero, e.complemento, e.bairro, e.cidade, e.uf, e.cep, e.referencia,
          coord?.lat ?? null, coord?.lon ?? null, atual.id);
    res.json({ endereco: { id: atual.id, ...e, lat: coord?.lat ?? null, lon: coord?.lon ?? null } });
  } catch (err) { next(err); }
});

router.delete('/enderecos/:id', async (req, res, next) => {
  try {
    const info = await db.prepare(
      'DELETE FROM enderecos WHERE id = ? AND usuario_id = ?'
    ).run(req.params.id, req.usuario!.id);
    if (info.changes === 0) throw erroHttp(404, 'Endereço não encontrado.');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ----- Perfil --------------------------------------------------------------

router.put('/perfil', async (req, res, next) => {
  try {
    const nome = textoLimpo(req.body.nome, 120);
    const telefone = telefoneDigitos(req.body.telefone);
    if (nome.length < 2) throw erroHttp(400, 'Informe seu nome completo.');
    // Telefone agora também é chave de login — não pode colidir com outra conta.
    if (telefone) {
      const dono = await db.prepare('SELECT id FROM usuarios WHERE telefone = ? AND id != ?')
        .get(telefone, req.usuario!.id);
      if (dono) throw erroHttp(409, 'Esse telefone já está em uso por outra conta.');
    }
    await db.prepare('UPDATE usuarios SET nome = ?, telefone = ? WHERE id = ?')
      .run(nome, telefone, req.usuario!.id);
    res.json({ usuario: { id: req.usuario!.id, nome, telefone, email: req.usuario!.email, perfil: 'cliente' } });
  } catch (err) { next(err); }
});

router.put('/senha', async (req, res, next) => {
  try {
    const atual = typeof req.body.senha_atual === 'string' ? req.body.senha_atual : '';
    const nova = typeof req.body.senha_nova === 'string' ? req.body.senha_nova : '';
    if (nova.length < 6) throw erroHttp(400, 'A nova senha precisa ter pelo menos 6 caracteres.');

    const u = await db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?')
      .get(req.usuario!.id) as { senha_hash: string } | undefined;
    if (!u || !await bcrypt.compare(atual, u.senha_hash)) {
      throw erroHttp(400, 'Senha atual incorreta.');
    }
    await db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')
      .run(await bcrypt.hash(nova, 10), req.usuario!.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ----- Cupom ---------------------------------------------------------------

interface CupomAplicado { id: number; codigo: string; tipo: 'percentual' | 'fixo'; valor: number; desconto_centavos: number; }

/**
 * Valida um cupom da loja contra o subtotal. Lança erro com mensagem clara se
 * inválido/expirado/esgotado/abaixo do mínimo. Retorna null se nenhum código.
 */
async function validarCupom(lojaId: number, codigoRaw: string, subtotal: number): Promise<CupomAplicado | null> {
  const codigo = textoLimpo(codigoRaw, 30).toUpperCase().replace(/\s+/g, '');
  if (!codigo) return null;

  const cupom = await db.prepare(
    'SELECT * FROM cupons WHERE loja_id = ? AND codigo = ? AND ativo = 1'
  ).get(lojaId, codigo) as Record<string, any> | undefined;
  if (!cupom) throw erroHttp(400, 'Cupom inválido ou inativo.');

  if (cupom.validade) {
    const limite = new Date(String(cupom.validade) + 'T23:59:59');
    if (!isNaN(limite.getTime()) && Date.now() > limite.getTime()) {
      throw erroHttp(400, 'Este cupom expirou.');
    }
  }
  if (cupom.usos_max > 0 && cupom.usos_count >= cupom.usos_max) {
    throw erroHttp(400, 'Este cupom atingiu o limite de usos.');
  }
  if (cupom.minimo_centavos > 0 && subtotal < cupom.minimo_centavos) {
    const falta = (cupom.minimo_centavos / 100).toFixed(2).replace('.', ',');
    throw erroHttp(400, `Este cupom exige pedido mínimo de R$ ${falta} (sem a entrega).`);
  }

  let desconto = cupom.tipo === 'percentual'
    ? Math.round(subtotal * cupom.valor / 100)
    : cupom.valor;
  desconto = Math.min(desconto, subtotal); // nunca desconta mais que o subtotal
  return { id: cupom.id, codigo: cupom.codigo, tipo: cupom.tipo, valor: cupom.valor, desconto_centavos: desconto };
}

/** Pré-validação do cupom no checkout (mostra o desconto antes de fechar). */
/**
 * Confere o carrinho ANTES do cliente preencher o checkout.
 *
 * As validações do pedido sempre existiram e estão certas — o problema é QUANDO
 * elas falam. Item pausado, produto esgotado ou preço alterado só apareciam no
 * clique final, depois de escolher endereço, forma de pagamento e digitar o
 * cartão. O cliente montava tudo e levava um não na última tela.
 *
 * Aqui a mesma verdade chega no começo, e por ITEM, pra tela poder marcar qual
 * é o problema em vez de só bloquear o botão.
 *
 * NÃO SUBSTITUI a validação da criação do pedido: entre abrir o checkout e
 * finalizar, o estoque pode acabar. É aviso antecipado, não autorização.
 */
router.post('/carrinho/conferir', async (req, res, next) => {
  try {
    const lojaId = inteiroPositivo(req.body.loja_id);
    const itens = Array.isArray(req.body.itens) ? req.body.itens : [];
    if (!lojaId) throw erroHttp(400, 'Loja inválida.');

    const loja = await db.prepare('SELECT * FROM lojas WHERE id = ?').get(lojaId) as Loja | undefined;
    const problemas: Array<{ produto_id: number; motivo: string; preco_novo_centavos?: number }> = [];

    if (!loja || loja.status_aprovacao !== 'aprovada') {
      return res.json({ ok: false, loja_fechada: true, motivo_loja: 'Esta loja não está mais disponível.', problemas });
    }
    if (!loja.aberta) {
      return res.json({ ok: false, loja_fechada: true, motivo_loja: 'A loja fechou enquanto você montava o pedido.', problemas });
    }

    for (const it of itens) {
      const produtoId = inteiroPositivo(it?.produto_id);
      const quantidade = inteiroPositivo(it?.quantidade) || 0;
      if (!produtoId) continue;
      const p = await db.prepare('SELECT * FROM produtos WHERE id = ? AND loja_id = ?')
        .get(produtoId, lojaId) as Produto | undefined;

      if (!p || (p as unknown as { excluido?: number }).excluido) {
        problemas.push({ produto_id: produtoId, motivo: 'saiu do cardápio' });
        continue;
      }
      if (!p.disponivel) {
        problemas.push({ produto_id: produtoId, motivo: 'está pausado no momento' });
        continue;
      }
      const controla = (p as unknown as { controla_estoque?: number }).controla_estoque;
      const estoque = (p as unknown as { estoque?: number }).estoque ?? 0;
      if (controla && estoque < quantidade) {
        problemas.push({
          produto_id: produtoId,
          motivo: estoque <= 0 ? 'esgotou' : `só restam ${estoque}`,
        });
        continue;
      }
      /*
       * PREÇO MUDADO é aviso, não bloqueio: o pedido sai pelo preço do banco de
       * qualquer forma (o servidor recalcula). O que não pode é o cliente
       * descobrir isso só no total final — daí avisar aqui, com o valor novo.
       */
      const precoAtual = precoVigente(p, dataBrasilia());
      const precoNaTela = inteiroPositivo(it?.preco_centavos);
      if (precoNaTela && precoNaTela !== precoAtual) {
        problemas.push({ produto_id: produtoId, motivo: 'mudou de preço', preco_novo_centavos: precoAtual });
      }
    }

    res.json({ ok: problemas.length === 0, loja_fechada: false, problemas });
  } catch (err) { next(err); }
});

router.post('/cupons/validar', async (req, res, next) => {
  try {
    const lojaId = inteiroPositivo(req.body.loja_id);
    const subtotal = inteiroPositivo(req.body.subtotal) || inteiroPositivo(req.body.subtotal_centavos) || 0;
    if (!lojaId) throw erroHttp(400, 'Loja inválida.');
    const cupom = await validarCupom(lojaId, String(req.body.codigo || ''), subtotal);
    if (!cupom) throw erroHttp(400, 'Informe um código de cupom.');
    res.json(cupom);
  } catch (err) { next(err); }
});

// ----- Pedidos -------------------------------------------------------------

function formatarEndereco(e: Endereco): string {
  const partes = [`${e.rua}, ${e.numero}`];
  if (e.complemento) partes.push(e.complemento);
  partes.push(`${e.bairro} - ${e.cidade}/${e.uf}`);
  if (e.cep) partes.push(`CEP ${e.cep}`);
  if (e.referencia) partes.push(`Ref.: ${e.referencia}`);
  return partes.join(' · ');
}

/** Resultado da validação de opções (recalculado no servidor). */
interface ResultadoOpcoes {
  precoUnit: number;
  opcoesTexto: string;
  opcoesIds: number[];
}

async function validarOpcoesDoItem(produto: Produto, opcoesEscolhidas: number[] | undefined): Promise<ResultadoOpcoes> {
  const ids = Array.isArray(opcoesEscolhidas)
    ? [...new Set(opcoesEscolhidas.map(v => inteiroPositivo(v)).filter((v): v is number => v !== null))]
    : [];

  /*
   * É O CAMINHO DO DINHEIRO: é esta lista que decide se o pedido é aceito e
   * quanto ele custa. Lê pela MESMA consulta do menu público (`grupos-sql.ts`),
   * porque prévia e cobrança lendo de jeitos diferentes é como o cliente vê um
   * preço e paga outro.
   */
  const grupos = await db.prepare(SQL_GRUPOS_DO_PRODUTO).all(produto.id) as GrupoOpcao[];

  // O preço que o cliente PAGA. Promoção vencida não vale aqui — ver
  // preco-produto.ts, que é onde a regra mora pros nove lugares que a usam.
  let precoUnit = precoVigente(produto, dataBrasilia());
  const partesTexto: string[] = [];
  const idsReconhecidos = new Set<number>();

  /*
   * DUAS PASSADAS, e a primeira existe por causa da pizza: o limite do grupo de
   * sabores vem do TAMANHO escolhido, e o grupo de tamanho pode estar depois na
   * ordem. Validar em uma passada só faria o limite depender de quem veio antes.
   */
  const carregados: Array<{ grupo: GrupoOpcao; escolhidas: OpcaoItem[] }> = [];
  for (const grupo of grupos) {
    const opcoesDoGrupo = await db.prepare(
      'SELECT * FROM opcoes_itens WHERE grupo_id = ? AND disponivel = 1'
    ).all(grupo.id) as OpcaoItem[];
    if (opcoesDoGrupo.length === 0) continue;
    /*
     * PRESERVA A REPETIÇÃO. O `filter` que estava aqui devolvia cada opção UMA
     * vez, mesmo o cliente tendo pedido 2/4 do mesmo sabor — então três frações
     * chegavam como dois sabores. Efeito: o limite era conferido contra o número
     * de sabores distintos em vez de pedaços, e a política 'proporcional' não
     * tinha fração pra calcular.
     *
     * Mapeia a partir de `ids` (a ordem e a repetição vêm do cliente) e não da
     * lista do grupo.
     */
    const escolhidas = ids
      .map(id => opcoesDoGrupo.find(o => o.id === id))
      .filter((o): o is OpcaoItem => !!o);
    for (const o of escolhidas) idsReconhecidos.add(o.id);
    carregados.push({ grupo, escolhidas });
  }

  const saboresPermitidos = saboresLiberados(carregados);

  for (const { grupo, escolhidas } of carregados) {
    if (grupo.tipo === 'unico') {
      if (grupo.obrigatorio && escolhidas.length !== 1) {
        throw erroHttp(400, `Escolha uma opção em "${grupo.nome}" para o item "${produto.nome}".`);
      }
      if (escolhidas.length > 1) {
        throw erroHttp(400, `"${grupo.nome}" permite apenas uma escolha no item "${produto.nome}".`);
      }
    } else {
      if (grupo.obrigatorio && escolhidas.length === 0) {
        throw erroHttp(400, `Escolha ao menos uma opção em "${grupo.nome}" para o item "${produto.nome}".`);
      }
      const max = maxEscolhasEfetivo(grupo, saboresPermitidos);
      if (max > 0 && escolhidas.length > max) {
        throw erroHttp(400, `"${grupo.nome}" permite no máximo ${max} escolha(s) no item "${produto.nome}".`);
      }
    }

    // `precoDoGrupo` decide entre somar, cobrar o maior e proporcional à fração
    // — ver opcoes-preco.ts. É a MESMA função que a tela usa pra prévia.
    precoUnit += precoDoGrupo(grupo, escolhidas);

    /*
     * O TEXTO GUARDA A FRAÇÃO ("2/4 Calabresa").
     *
     * É este texto que vai pro carrinho, pro cupom da cozinha e pro histórico do
     * pedido. Sem a fração aqui, a tela promete uma divisão que quem produz não
     * recebe — e aí a pizza sai errada com o cliente tendo razão.
     */
    const totalFracoes = escolhidas.length;
    for (const p of contarFracoes(escolhidas)) {
      const nome = (p.opcao as OpcaoItem).nome;
      partesTexto.push(p.fracoes > 1 && totalFracoes > 1
        ? `${grupo.nome}: ${p.fracoes}/${totalFracoes} ${nome}`
        : `${grupo.nome}: ${nome}`);
    }
  }

  if (ids.some(id => !idsReconhecidos.has(id))) {
    throw erroHttp(400, `Há opções inválidas no item "${produto.nome}". Atualize a página e tente de novo.`);
  }

  return { precoUnit, opcoesTexto: partesTexto.join(' · '), opcoesIds: [...idsReconhecidos] };
}

router.post('/pedidos', async (req, res, next) => {
  try {
    const lojaId = inteiroPositivo(req.body.loja_id);
    const itens: ItemRequisicaoPedido[] = Array.isArray(req.body.itens) ? req.body.itens : [];
    const enderecoId = inteiroPositivo(req.body.endereco_id);
    const formaPagamento = textoLimpo(req.body.forma_pagamento, 20);
    const observacoes = textoLimpo(req.body.observacoes, 300);

    if (!lojaId) throw erroHttp(400, 'Loja inválida.');
    if (itens.length === 0) throw erroHttp(400, 'O carrinho está vazio.');
    if (!['pix', 'dinheiro', 'cartao_entrega', 'cartao_online'].includes(formaPagamento)) {
      throw erroHttp(400, 'Escolha uma forma de pagamento válida.');
    }
    // 'pix' = Pix online (gera cobrança no Mercado Pago). A disponibilidade da
    // integração só é checada mais abaixo, DEPOIS de validar loja, endereço e
    // itens — assim o cliente recebe a mensagem correta (loja fechada, item
    // inválido) em vez de "Pix indisponível" mascarando o motivo real.
    const pixOnline = formaPagamento === 'pix';
    /*
     * Cartão ONLINE (Checkout Pro) — pago antes de sair, como o Pix. Diferente de
     * `cartao_entrega`, que é a maquininha na porta do cliente: para o lojista as
     * duas coisas são operações distintas (uma já entrou na conta, a outra o
     * entregador precisa cobrar), e por isso são formas de pagamento separadas em
     * vez de um campo "pago/não pago" em cima da mesma.
     */
    const cartaoOnline = formaPagamento === 'cartao_online';
    const pagoAntes = pixOnline || cartaoOnline;

    const loja = await db.prepare('SELECT * FROM lojas WHERE id = ?').get(lojaId) as Loja | undefined;
    if (!loja || loja.status_aprovacao !== 'aprovada') throw erroHttp(404, 'Loja não encontrada.');
    if (!loja.aberta) throw erroHttp(409, 'Esta loja está fechada no momento e não pode receber pedidos.');

    /*
     * RETIRADA NO LOCAL x ENTREGA.
     *
     * Validado contra a config da LOJA, não contra o que o cliente mandou: uma
     * requisição forjada com `tipo_entrega: retirada` numa loja que não faz
     * retirada geraria um pedido sem endereço e sem taxa, e alguém apareceria
     * num balcão que não existe.
     */
    const querRetirada = req.body.tipo_entrega === 'retirada';
    if (querRetirada && !(loja as any).aceita_retirada) {
      throw erroHttp(400, 'Esta loja não aceita retirada no local.');
    }
    const tipoEntrega = querRetirada ? 'retirada' : 'entrega';

    // Na retirada o endereço do cliente é irrelevante — e exigir um faria o
    // pedido falhar pra quem nunca cadastrou endereço nenhum.
    const endereco = tipoEntrega === 'retirada'
      ? null
      : await db.prepare('SELECT * FROM enderecos WHERE id = ? AND usuario_id = ?')
          .get(enderecoId, req.usuario!.id) as Endereco | undefined;
    if (tipoEntrega === 'entrega' && !endereco) throw erroHttp(400, 'Selecione um endereço de entrega válido.');

    let subtotal = 0;
    const itensValidados: Array<{ produto: Produto; quantidade: number; precoUnit: number; opcoesTexto: string; opcoesIds: number[]; observacao: string }> = [];
    for (const item of itens) {
      const produtoId = inteiroPositivo(item.produto_id);
      const quantidade = inteiroPositivo(item.quantidade);
      if (!produtoId || !quantidade || quantidade > 50) {
        throw erroHttp(400, 'Itens do carrinho inválidos.');
      }
      const produto = await db.prepare('SELECT * FROM produtos WHERE id = ? AND loja_id = ?')
        .get(produtoId, lojaId) as Produto | undefined;
      if (!produto || produto.excluido) throw erroHttp(400, 'Um dos itens não existe mais no cardápio.');
      if (!produto.disponivel) throw erroHttp(409, `O item "${produto.nome}" está pausado no momento. Remova-o do carrinho.`);

      const { precoUnit, opcoesTexto, opcoesIds } = await validarOpcoesDoItem(produto, item.opcoes);
      subtotal += precoUnit * quantidade;
      // Observação DO ITEM ("sem cebola"). 140 é o limite do campo na tela; o
      // corte aqui é a garantia, porque o cliente é quem manda o valor.
      itensValidados.push({ produto, quantidade, precoUnit, opcoesTexto, opcoesIds, observacao: textoLimpo(item.observacao, 140) });
    }

    // Estoque: agrega a quantidade pedida por produto (o mesmo produto pode
    // aparecer em vários itens com opções diferentes) e valida os que controlam estoque.
    const qtdPorProduto = new Map<number, number>();
    for (const { produto, quantidade } of itensValidados) {
      qtdPorProduto.set(produto.id, (qtdPorProduto.get(produto.id) || 0) + quantidade);
    }
    for (const { produto } of itensValidados) {
      if (!(produto as any).controla_estoque) continue;
      const pedido = qtdPorProduto.get(produto.id) || 0;
      const emEstoque = (produto as any).estoque ?? 0;
      if (emEstoque <= 0) throw erroHttp(409, `O item "${produto.nome}" está esgotado. Remova-o do carrinho.`);
      if (pedido > emEstoque) {
        throw erroHttp(409, `Restam apenas ${emEstoque}× de "${produto.nome}" em estoque.`);
      }
    }

    // Pix online exige a integração ativa. Checado só agora, depois de validar
    // loja, endereço e itens — para não mascarar o motivo real da recusa.
    /*
     * Cartão exige RECEBEDOR PRÓPRIO da loja; Pix aceita ONZ ou Mercado Pago. Sem
     * essa distinção, uma loja sem conta de MP receberia cartão na conta da
     * plataforma (ver `tokenProprioMP`).
     */
    if (cartaoOnline && !(await cartaoOnlineAtivo(lojaId))) {
      throw erroHttp(409, 'Esta loja ainda não aceita cartão online. Escolha Pix ou pagamento na entrega.');
    }
    if (pagoAntes && !(await pagamentoOnlineAtivo(lojaId))) {
      throw erroHttp(503, 'Pagamento via Pix online indisponível no momento. Escolha pagar na entrega.');
    }

    // Pedido mínimo da loja (0 = sem mínimo).
    const minimoLoja = (loja as any).minimo_pedido_centavos || 0;
    if (minimoLoja > 0 && subtotal < minimoLoja) {
      const falta = (minimoLoja / 100).toFixed(2).replace('.', ',');
      throw erroHttp(400, `Pedido mínimo desta loja é R$ ${falta} (sem contar a entrega).`);
    }

    // Frete: área desenhada no mapa > bairro cadastrado > taxa padrão. Decisão
    // toda em resolverFrete() pra checkout e prévia nunca divergirem (o cliente
    // veria um valor e pagaria outro).
    // Retirada não tem frete nem zona pra resolver: ninguém vai levar nada.
    const frete = tipoEntrega === 'retirada'
      ? { taxaCentavos: 0, tempoMin: null as number | null }
      : await resolverFrete(
          lojaId,
          { bairro: endereco!.bairro, lat: (endereco as any).lat, lon: (endereco as any).lon },
          loja.taxa_entrega_centavos,
        );
    // null = fora de toda área que a loja desenhou.
    if (!frete) {
      throw erroHttp(400, 'Esta loja não entrega no endereço escolhido. Escolha outro endereço ou retire no local.');
    }
    const taxaEntrega = frete.taxaCentavos;
    /*
     * FOTO do tempo estimado no pedido. A zona manda; sem zona, o padrão da
     * loja. Guardado aqui e não lido depois porque a contagem regressiva na tela
     * do cliente não pode mudar se o lojista ajustar o padrão amanhã — a
     * promessa foi feita agora.
     */
    const tempoEstimado = frete.tempoMin || loja.tempo_estimado_min || 40;

    // Cupom (opcional): valida no servidor e desconta do subtotal.
    const cupom = req.body.cupom_codigo
      ? await validarCupom(lojaId, String(req.body.cupom_codigo), subtotal)
      : null;
    const descontoCupom = cupom?.desconto_centavos || 0;
    const subtotalComDesconto = subtotal - descontoCupom;
    const total = subtotalComDesconto + taxaEntrega;

    let trocoPara: number | null = null;
    if (formaPagamento === 'dinheiro' && req.body.troco_para) {
      trocoPara = reaisParaCentavos(req.body.troco_para);
      if (trocoPara === null || trocoPara < total) {
        throw erroHttp(400, 'O valor para troco precisa ser maior ou igual ao total do pedido.');
      }
    }

    const comissaoPct = await comissaoPercentualDaLoja(lojaId);
    // Comissão incide sobre o valor líquido (subtotal já com o desconto do cupom).
    const comissao = Math.round(subtotalComDesconto * comissaoPct / 100);

    /*
     * IDEMPOTÊNCIA DO CHECKOUT.
     *
     * O botão desabilita na tela, mas isso não cobre retry de rede nem toque
     * duplo no celular — e cada duplicata baixa estoque e queima cupom de novo.
     * O navegador manda a MESMA chave em qualquer reenvio da mesma tentativa;
     * quem garante é o índice único, porque checar antes de inserir não resolve
     * corrida (e duplo clique é exatamente uma corrida).
     */
    const chaveIdem = textoLimpo(req.body.chave_idem, 64);
    if (chaveIdem) {
      const jaFeito = await db.prepare(
        'SELECT id, total_centavos FROM pedidos WHERE chave_idem = ? AND cliente_id = ?'
      ).get(chaveIdem, req.usuario!.id) as { id: number; total_centavos: number } | undefined;
      // Mesma resposta do 1º envio: pra quem chamou, é como se tivesse dado certo
      // agora — que é a única leitura que não confunde o cliente.
      if (jaFeito) return res.status(201).json({ pedido_id: jaFeito.id, total_centavos: jaFeito.total_centavos });
    }

    const agora = agoraUTC();
    const pedidoId = await comTransacao(async (tx) => {
      const info = await tx.prepare(
        `INSERT INTO pedidos (cliente_id, loja_id, status, endereco_entrega, entrega_lat, entrega_lon, forma_pagamento,
                              troco_para_centavos, observacoes, subtotal_centavos,
                              taxa_entrega_centavos, desconto_centavos, cupom_codigo, total_centavos,
                              comissao_percentual, comissao_centavos, pagamento_status, chave_idem, tempo_estimado_min,
                              tipo_entrega, criado_em, atualizado_em)
         VALUES (?, ?, 'pendente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(req.usuario!.id, lojaId,
            /*
             * Na retirada, o campo guarda o endereço DA LOJA, não um vazio.
             * Cupom, comanda e histórico já leem essa coluna; deixá-la em
             * branco imprimiria pedido sem endereço nenhum, e ninguém saberia
             * onde o cliente vai buscar.
             */
            tipoEntrega === 'retirada' ? `Retirada no local — ${loja.endereco || loja.nome}` : formatarEndereco(endereco!),
            (endereco as any)?.lat ?? null, (endereco as any)?.lon ?? null, formaPagamento,
            trocoPara, observacoes, subtotal, taxaEntrega, descontoCupom, cupom?.codigo || '',
            total, comissaoPct, comissao, pagoAntes ? 'aguardando' : 'na_entrega', chaveIdem, tempoEstimado,
            tipoEntrega, agora, agora);

      const novoPedidoId = Number(info.lastInsertRowid);

      // Consome um uso do cupom. O incremento é CONDICIONAL ao limite (usos_max=0
      // = ilimitado): assim dois checkouts simultâneos não estouram usos_max — se
      // o cupom esgotou entre a validação e aqui, changes=0 e desfazemos tudo.
      if (cupom) {
        const u = await tx.prepare(
          'UPDATE cupons SET usos_count = usos_count + 1 WHERE id = ? AND (usos_max = 0 OR usos_count < usos_max)'
        ).run(cupom.id);
        if (u.changes === 0) throw erroHttp(409, 'Este cupom atingiu o limite de usos.');
      }
      for (const { produto, quantidade, precoUnit, opcoesTexto, opcoesIds, observacao } of itensValidados) {
        await tx.prepare(
          `INSERT INTO itens_pedido (pedido_id, produto_id, nome_produto, preco_unit_centavos, quantidade, opcoes_texto, opcoes_ids, observacao)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(novoPedidoId, produto.id, produto.nome, precoUnit, quantidade, opcoesTexto, JSON.stringify(opcoesIds), observacao);
      }
      // Baixa de estoque (só produtos que controlam). UPDATE condicional: se outro
      // pedido esgotou entre a validação e aqui, changes=0 e desfazemos tudo.
      for (const [produtoId, qtd] of qtdPorProduto) {
        const alvo = itensValidados.find(i => i.produto.id === produtoId)!.produto;
        if (!(alvo as any).controla_estoque) continue;
        const r = await tx.prepare(
          'UPDATE produtos SET estoque = estoque - ? WHERE id = ? AND controla_estoque = 1 AND estoque >= ?'
        ).run(qtd, produtoId, qtd);
        if (r.changes === 0) throw erroHttp(409, `O item "${alvo.nome}" acabou de esgotar. Ajuste o carrinho.`);
      }
      await tx.prepare('INSERT INTO historico_status (pedido_id, status, criado_em) VALUES (?, ?, ?)')
        .run(novoPedidoId, 'pendente', agora);
      return novoPedidoId;
    });

    // Pix online: gera a cobrança no Mercado Pago e devolve o QR. O lojista só
    // é avisado quando o pagamento for aprovado (pelo webhook). Se a cobrança
    // falhar, desfaz o pedido pra não deixar lixo.
    /*
     * CARTÃO ONLINE: cria a preferência do Checkout Pro e devolve a URL pra onde o
     * cliente é redirecionado. Fica ANTES do bloco do Pix porque compartilha só o
     * desfazer-em-caso-de-falha, não o resto — o Pix devolve QR pra tela, o cartão
     * devolve endereço pra sair.
     */
    if (cartaoOnline) {
      try {
        const base = `${req.protocol}://${req.get('host')}`;
        /*
         * NÃO CRIA MAIS PREFERÊNCIA NEM REDIRECIONA.
         *
         * O cartão agora é digitado dentro da própria loja, em campos servidos
         * pelo Mercado Pago (Checkout Bricks). Aqui a gente só devolve a public
         * key pra tela montar o formulário — a cobrança acontece depois, em
         * `/pedidos/:id/pagar-cartao`, quando o SDK já transformou o cartão num
         * token de uso único.
         *
         * O pedido nasce ANTES do pagamento (igual era antes): é ele que fixa o
         * valor a cobrar. Cliente que abandona o formulário deixa um pedido em
         * "aguardando", que é o mesmo caso já coberto pela reconciliação.
         */
        const publicKey = await publicKeyMP(lojaId);
        if (!publicKey) throw new Error('Loja sem public key do Mercado Pago cadastrada.');
        await db.prepare(
          "UPDATE pedidos SET pagamento_gateway = 'mercadopago' WHERE id = ?"
        ).run(pedidoId);
        notificarPedidoWhatsApp(pedidoId, base).catch(() => { /* best-effort */ });
        return res.status(201).json({
          pedido_id: pedidoId,
          total_centavos: total,
          cartao: { public_key: publicKey, total_centavos: total },
        });
      } catch (e) {
        console.error(`[Cartão] Falha ao preparar pagamento do pedido #${pedidoId} (loja ${lojaId}):`, e);
        // Mesmo desfazer do Pix: pedido sem cobrança é lixo que trava estoque e
        // consome uso de cupom.
        await comTransacao(async (tx) => {
          if (cupom) await tx.prepare('UPDATE cupons SET usos_count = GREATEST(usos_count - 1, 0) WHERE id = ?').run(cupom.id);
          for (const [produtoId, qtd] of qtdPorProduto) {
            await tx.prepare(
              'UPDATE produtos SET estoque = estoque + ? WHERE id = ? AND controla_estoque = 1'
            ).run(qtd, produtoId);
          }
          await tx.prepare('DELETE FROM itens_pedido WHERE pedido_id = ?').run(pedidoId);
          await tx.prepare('DELETE FROM historico_status WHERE pedido_id = ?').run(pedidoId);
          await tx.prepare('DELETE FROM pedidos WHERE id = ?').run(pedidoId);
        });
        throw erroHttp(502, 'Não foi possível abrir o pagamento com cartão agora. Tente de novo ou escolha pagar na entrega.');
      }
    }

    if (pixOnline) {
      try {
        const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId) as Pedido;
        // notification_url carrega o tenant dono do pedido (?t=<banco>) pra o
        // webhook do MP confirmar no banco certo, independentemente do domínio
        // que o MP chamar (modelo SILO — um banco por tenant).
        const base = `${req.protocol}://${req.get('host')}`;
        const notifUrl = `${base}/api/pagamentos/webhook/mercadopago?t=${encodeURIComponent(bancoTenantAtual())}`;
        // Despacha pro gateway da loja (Mercado Pago ou ONZ) — ver pagamentos.ts.
        const pix = await criarCobrancaPix(lojaId, pedido, { email: req.usuario!.email }, notifUrl);
        await db.prepare(
          'UPDATE pedidos SET pagamento_gateway = ?, pagamento_gateway_id = ? WHERE id = ?'
        ).run(pix.gateway, pix.pagamento_id, pedidoId);
        notificarPedidoWhatsApp(pedidoId, `${req.protocol}://${req.get('host')}`).catch(() => { /* best-effort */ });
        return res.status(201).json({ pedido_id: pedidoId, total_centavos: total, pix });
      } catch (e) {
        // Loga a causa real — sem isso, uma falha de Pix vira um 502 mudo,
        // impossível de diagnosticar a partir dos logs do servidor.
        console.error(`[Pix] Falha ao gerar cobrança do pedido #${pedidoId} (loja ${lojaId}):`, e);
        // Limpa o pedido recém-criado (e devolve estoque + uso do cupom).
        await comTransacao(async (tx) => {
          if (cupom) await tx.prepare('UPDATE cupons SET usos_count = GREATEST(usos_count - 1, 0) WHERE id = ?').run(cupom.id);
          for (const [produtoId, qtd] of qtdPorProduto) {
            await tx.prepare(
              'UPDATE produtos SET estoque = estoque + ? WHERE id = ? AND controla_estoque = 1'
            ).run(qtd, produtoId);
          }
          await tx.prepare('DELETE FROM itens_pedido WHERE pedido_id = ?').run(pedidoId);
          await tx.prepare('DELETE FROM historico_status WHERE pedido_id = ?').run(pedidoId);
          await tx.prepare('DELETE FROM pedidos WHERE id = ?').run(pedidoId);
        });
        throw erroHttp(502, 'Não foi possível gerar o Pix agora. Tente de novo ou escolha pagar na entrega.');
      }
    }

    // Pagamento na entrega: o lojista é avisado na hora.
    notificarLojistaNovoPedido(pedidoId).catch(() => { /* best-effort */ });
    notificarPedidoWhatsApp(pedidoId, `${req.protocol}://${req.get('host')}`).catch(() => { /* best-effort */ });
    res.status(201).json({ pedido_id: pedidoId, total_centavos: total });
  } catch (err) { next(err); }
});

router.get('/pedidos', async (req, res, next) => {
  try {
    const pedidos = await db.prepare(
      `SELECT p.*, l.nome AS loja_nome
         FROM pedidos p JOIN lojas l ON l.id = p.loja_id
        WHERE p.cliente_id = ?
        ORDER BY p.id DESC LIMIT 100`
    ).all(req.usuario!.id);
    res.json({ pedidos });
  } catch (err) { next(err); }
});

/**
 * Prévia do frete de um endereço, ANTES de finalizar.
 *
 * Sem isto, o cliente só descobria que a loja não atende o endereço dele ao
 * apertar "finalizar" — depois de montar o carrinho todo. Usa exatamente a mesma
 * função do checkout, então prévia e cobrança nunca divergem.
 */
router.post('/frete', async (req, res, next) => {
  try {
    const lojaId = inteiroPositivo(req.body.loja_id);
    if (!lojaId) throw erroHttp(400, 'Loja inválida.');
    const loja = await db.prepare('SELECT taxa_entrega_centavos FROM lojas WHERE id = ?')
      .get(lojaId) as { taxa_entrega_centavos: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');

    // Aceita endereço salvo (id) ou os campos soltos (endereço sendo digitado).
    let dados: EnderecoParaFrete;
    const enderecoId = inteiroPositivo(req.body.endereco_id);
    if (enderecoId) {
      const e = await db.prepare('SELECT bairro, lat, lon FROM enderecos WHERE id = ? AND usuario_id = ?')
        .get(enderecoId, req.usuario!.id) as EnderecoParaFrete | undefined;
      if (!e) throw erroHttp(404, 'Endereço não encontrado.');
      dados = e;
    } else {
      dados = {
        bairro: textoLimpo(req.body.bairro, 80),
        lat: Number(req.body.lat) || null,
        lon: Number(req.body.lon) || null,
      };
    }

    const frete = await resolverFrete(lojaId, dados, loja.taxa_entrega_centavos);
    res.json(frete
      ? { atende: true, taxa_centavos: frete.taxaCentavos, fonte: frete.fonte, zona: frete.zona }
      : { atende: false, taxa_centavos: null, motivo: 'Esta loja não entrega nesse endereço.' });
  } catch (err) { next(err); }
});

/**
 * Confere na hora se o Pix caiu — chamado pela tela do QR enquanto o cliente
 * espera. É o que faz a confirmação ser em SEGUNDOS mesmo se o webhook falhar
 * (sem isso, o resgate era a reconciliação de 5 min, com o cliente parado
 * olhando "aguardando pagamento").
 *
 * Só o dono do pedido consulta. O freio anti-abuso está em conferirPixAgora().
 */
async function conferirPagamentoDoDono(req: Request, res: Response) {
  const meu = await db.prepare('SELECT id FROM pedidos WHERE id = ? AND cliente_id = ?')
    .get(req.params.id, req.usuario!.id) as { id: number } | undefined;
  if (!meu) throw erroHttp(404, 'Pedido não encontrado.');
  // Falha ao falar com o PSP não é erro do cliente: responde "ainda não" e
  // deixa o polling seguir (o webhook/reconciliação continuam de pé).
  let pago = false;
  try { pago = await conferirPagamentoAgora(meu.id); } catch (e) {
    console.error(`[pagamentos] conferência do pedido ${meu.id} falhou:`, (e as Error).message);
  }
  res.json({ pago });
}

/**
 * COBRA O CARTÃO do pedido com o token gerado pelo formulário embutido.
 *
 * O corpo traz só o que o SDK do Mercado Pago devolveu — o token de uso único e
 * os dados do meio escolhido. O NÚMERO DO CARTÃO NUNCA CHEGA AQUI: ele é
 * digitado em campos servidos pelo próprio MP, e o servidor só vê o token.
 *
 * O VALOR NÃO VEM DO NAVEGADOR. É lido do pedido, no servidor. Aceitar valor do
 * cliente aqui deixaria qualquer um cobrar de si mesmo o quanto quisesse.
 */
router.post('/pedidos/:id/pagar-cartao', async (req, res, next) => {
  try {
    const pedido = await db.prepare(
      'SELECT * FROM pedidos WHERE id = ? AND cliente_id = ?'
    ).get(req.params.id, req.usuario!.id) as Pedido | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    if (pedido.pagamento_status === 'aprovado') return res.json({ status: 'approved' });
    if (pedido.forma_pagamento !== 'cartao_online') throw erroHttp(409, 'Este pedido não é de cartão online.');

    const token = typeof req.body.token === 'string' ? req.body.token : '';
    const metodo = typeof req.body.payment_method_id === 'string' ? req.body.payment_method_id : '';
    if (!token || !metodo) throw erroHttp(400, 'Dados do cartão incompletos.');

    const base = `${req.protocol}://${req.get('host')}`;
    const notifUrl = `${base}/api/pagamentos/webhook/mercadopago`
      + `?t=${encodeURIComponent(bancoTenantAtual())}&loja=${pedido.loja_id}`;

    let cobranca;
    try {
      cobranca = await criarPagamentoCartao(pedido.loja_id, pedido, {
        token,
        payment_method_id: metodo,
        issuer_id: typeof req.body.issuer_id === 'string' ? req.body.issuer_id : undefined,
        installments: inteiroPositivo(req.body.installments) || 1,
        payer: req.body.payer,
      }, { notificationUrl: notifUrl, emailPadrao: req.usuario!.email });
    } catch (e) {
      // Recusa do gateway não é erro de servidor: o cliente precisa poder tentar
      // outro cartão sem o pedido virar lixo.
      throw erroHttp(402, (e as Error).message);
    }

    // Grava pelo MESMO caminho do webhook — idempotente, e avisa o lojista uma
    // vez só, venha a confirmação por aqui ou pela notificação do MP.
    await aplicarResultadoCartao(cobranca.id, pedido.loja_id);

    const depois = await db.prepare('SELECT pagamento_status FROM pedidos WHERE id = ?')
      .get(pedido.id) as { pagamento_status: string } | undefined;
    res.json({
      status: cobranca.status,
      status_detail: cobranca.status_detail,
      pagamento_status: depois?.pagamento_status ?? 'aguardando',
    });
  } catch (err) { next(err); }
});

router.post('/pedidos/:id/conferir-pagamento', async (req, res, next) => {
  try { await conferirPagamentoDoDono(req, res); } catch (err) { next(err); }
});

/**
 * Nome antigo, quando só o Pix tinha conferência ativa. Continua valendo porque
 * a tela do QR ainda chama por aqui, e agora faz a mesma coisa que o novo.
 */
router.post('/pedidos/:id/conferir-pix', async (req, res, next) => {
  try { await conferirPagamentoDoDono(req, res); } catch (err) { next(err); }
});

router.get('/pedidos/:id', async (req, res, next) => {
  try {
    const pedido = await db.prepare(
      /*
       * A FOTO DO PEDIDO VENCE o padrão da loja. `p.*` já traz
       * `p.tempo_estimado_min`, e a coluna de mesmo nome vinda de `lojas`
       * sobrescreveria em silêncio — o alias abaixo é o que garante a ordem,
       * com o padrão da loja só como reserva pra pedidos antigos (0).
       */
      `SELECT p.*, l.nome AS loja_nome,
              COALESCE(NULLIF(p.tempo_estimado_min, 0), l.tempo_estimado_min) AS tempo_estimado_min,
              l.cor_marca AS loja_cor_marca, l.cor_secundaria AS loja_cor_secundaria,
              u.nome AS entregador_nome, u.telefone AS entregador_telefone,
              u.nota_media AS entregador_nota_media, u.nota_qtd AS entregador_nota_qtd,
              u.entregador_chat_metodo
         FROM pedidos p
         JOIN lojas l ON l.id = p.loja_id
         LEFT JOIN usuarios u ON u.id = p.entregador_id
        WHERE p.id = ? AND p.cliente_id = ?`
    ).get(req.params.id, req.usuario!.id);
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');

    const itens = await db.prepare('SELECT * FROM itens_pedido WHERE pedido_id = ?').all((pedido as any).id);
    const historico = await db.prepare(
      'SELECT status, criado_em FROM historico_status WHERE pedido_id = ? ORDER BY id'
    ).all((pedido as any).id);
    const avaliacao = await db.prepare(
      'SELECT nota, comentario, resposta FROM avaliacoes WHERE pedido_id = ?'
    ).get((pedido as any).id) || null;
    const avaliacaoEntregador = await db.prepare(
      'SELECT nota, comentario FROM avaliacoes_entregador WHERE pedido_id = ?'
    ).get((pedido as any).id) || null;
    res.json({ pedido, itens, historico, avaliacao, avaliacaoEntregador });
  } catch (err) { next(err); }
});

/** Recalcula e grava a nota média/quantidade da loja após uma avaliação. */
async function recalcularNotaLoja(lojaId: number): Promise<void> {
  const agg = await db.prepare(
    'SELECT AVG(nota) AS media, COUNT(*) AS qtd FROM avaliacoes WHERE loja_id = ?'
  ).get(lojaId) as { media: number | null; qtd: number };
  await db.prepare('UPDATE lojas SET nota_media = ?, nota_qtd = ? WHERE id = ?')
    .run(agg.media ? Math.round(agg.media * 10) / 10 : 0, agg.qtd, lojaId);
}

router.post('/pedidos/:id/avaliar', async (req, res, next) => {
  try {
    const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ? AND cliente_id = ?')
      .get(req.params.id, req.usuario!.id) as { id: number; loja_id: number; status: string } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    if (pedido.status !== 'entregue') {
      throw erroHttp(409, 'Você só pode avaliar pedidos que já foram entregues.');
    }
    const nota = inteiroPositivo(req.body.nota);
    if (!nota || nota < 1 || nota > 5) throw erroHttp(400, 'Dê uma nota de 1 a 5 estrelas.');
    const comentario = textoLimpo(req.body.comentario, 500);

    const jaTem = await db.prepare('SELECT id FROM avaliacoes WHERE pedido_id = ?').get(pedido.id);
    if (jaTem) throw erroHttp(409, 'Você já avaliou este pedido.');

    await db.prepare(
      `INSERT INTO avaliacoes (pedido_id, loja_id, cliente_id, nota, comentario, criado_em)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(pedido.id, pedido.loja_id, req.usuario!.id, nota, comentario, agoraUTC());
    await recalcularNotaLoja(pedido.loja_id);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

/** Recalcula e grava a nota média/quantidade do entregador (mesmo padrão da loja). */
async function recalcularNotaEntregador(entregadorId: number): Promise<void> {
  const agg = await db.prepare(
    'SELECT AVG(nota) AS media, COUNT(*) AS qtd FROM avaliacoes_entregador WHERE entregador_id = ?'
  ).get(entregadorId) as { media: number | null; qtd: number };
  await db.prepare('UPDATE usuarios SET nota_media = ?, nota_qtd = ? WHERE id = ?')
    .run(agg.media ? Math.round(agg.media * 10) / 10 : 0, agg.qtd, entregadorId);
}

router.post('/pedidos/:id/avaliar-entregador', async (req, res, next) => {
  try {
    const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ? AND cliente_id = ?')
      .get(req.params.id, req.usuario!.id) as { id: number; entregador_id: number | null; status: string } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    if (pedido.status !== 'entregue') throw erroHttp(409, 'Você só pode avaliar pedidos que já foram entregues.');
    if (!pedido.entregador_id) throw erroHttp(409, 'Este pedido não teve um entregador atribuído.');

    const nota = inteiroPositivo(req.body.nota);
    if (!nota || nota < 1 || nota > 5) throw erroHttp(400, 'Dê uma nota de 1 a 5 estrelas.');
    const comentario = textoLimpo(req.body.comentario, 500);

    const jaTem = await db.prepare('SELECT id FROM avaliacoes_entregador WHERE pedido_id = ?').get(pedido.id);
    if (jaTem) throw erroHttp(409, 'Você já avaliou este entregador.');

    await db.prepare(
      `INSERT INTO avaliacoes_entregador (pedido_id, entregador_id, cliente_id, nota, comentario, criado_em)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(pedido.id, pedido.entregador_id, req.usuario!.id, nota, comentario, agoraUTC());
    await recalcularNotaEntregador(pedido.entregador_id);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// ----- Chat do pedido --------------------------------------------------------

router.get('/pedidos/:id/mensagens', async (req, res, next) => {
  try {
    const pedido = await db.prepare('SELECT id FROM pedidos WHERE id = ? AND cliente_id = ?')
      .get(req.params.id, req.usuario!.id) as { id: number } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    const mensagens = await db.prepare(
      'SELECT id, remetente, texto, criado_em FROM mensagens_pedido WHERE pedido_id = ? ORDER BY id'
    ).all(pedido.id);
    await db.prepare("UPDATE mensagens_pedido SET lida = 1 WHERE pedido_id = ? AND remetente IN ('entregador','loja')").run(pedido.id);
    res.json({ mensagens });
  } catch (err) { next(err); }
});

// Antes de ter entregador atribuído o cliente fala com a LOJA; depois passa a
// falar com o entregador — mas é sempre a mesma thread, sem trava por status.
router.post('/pedidos/:id/mensagens', async (req, res, next) => {
  try {
    const pedido = await db.prepare("SELECT id, status FROM pedidos WHERE id = ? AND cliente_id = ?")
      .get(req.params.id, req.usuario!.id) as { id: number; status: string } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    if (['cancelado', 'recusado'].includes(pedido.status)) throw erroHttp(409, 'Este pedido já foi encerrado.');
    const texto = textoLimpo(req.body.texto, 500);
    if (!texto) throw erroHttp(400, 'Escreva uma mensagem.');
    const info = await db.prepare(
      `INSERT INTO mensagens_pedido (pedido_id, remetente, texto, criado_em) VALUES (?, 'cliente', ?, ?)`
    ).run(pedido.id, texto, agoraUTC());
    res.status(201).json({ mensagem_id: Number(info.lastInsertRowid) });
  } catch (err) { next(err); }
});

router.post('/pedidos/:id/cancelar', async (req, res, next) => {
  try {
    const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ? AND cliente_id = ?')
      .get(req.params.id, req.usuario!.id) as { id: number; status: string; pagamento_status: string } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    if (pedido.status !== 'pendente') {
      throw erroHttp(409, 'Este pedido já foi aceito pela loja e não pode mais ser cancelado.');
    }
    // Pix já aprovado pelo Mercado Pago: cancelar aqui devolveria o estoque
    // mas não estorna o dinheiro (não existe fluxo de reembolso automático
    // ainda) — bloqueia o autoatendimento e manda falar com a loja/suporte
    // pra não deixar o cliente "cancelar de graça" um pedido já pago.
    if (pedido.pagamento_status === 'aprovado') {
      throw erroHttp(409, 'Este pedido já foi pago via Pix. Fale com a loja para cancelar e receber o reembolso.');
    }
    await transicionarStatus(pedido.id, 'cancelado');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/pedidos/:id/repetir', async (req, res, next) => {
  try {
    const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ? AND cliente_id = ?')
      .get(req.params.id, req.usuario!.id) as { id: number; loja_id: number } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');

    type ItemAntigo = {
      produto_id: number; quantidade: number; opcoes_ids: string; opcoes_texto: string;
      nome: string; preco_centavos: number; preco_promocional_centavos: number | null;
      disponivel: number; excluido: number;
    };
    const itens = await db.prepare(
      `SELECT i.produto_id, i.quantidade, i.opcoes_ids, i.opcoes_texto,
              pr.nome, pr.preco_centavos, pr.preco_promocional_centavos, pr.disponivel, pr.excluido
         FROM itens_pedido i JOIN produtos pr ON pr.id = i.produto_id
        WHERE i.pedido_id = ?`
    ).all(pedido.id) as ItemAntigo[];

    type OpcaoExistente = {
      id: number; nome: string; preco_adicional_centavos: number;
      grupo_id: number; grupo_nome: string; modo_preco: string | null; max_escolhas: number;
    };
    const disponiveis = [];
    for (const i of itens.filter(i => i.disponivel && !i.excluido)) {
      let idsAntigos: number[] = [];
      try { idsAntigos = JSON.parse(i.opcoes_ids); } catch { /* pedido antigo sem opções */ }
      const opcoes: OpcaoExistente[] = [];
      for (const id of idsAntigos) {
        const opcao = await db.prepare(
          /*
           * A OPÇÃO PERTENCE A ESTE PRODUTO? PERGUNTA-SE À LIGAÇÃO.
           *
           * Isto conferia `g.produto_id = ?` — o produto pra qual o grupo foi
           * CRIADO. Com grupo compartilhado (fase 3), a borda de trinta pizzas
           * tem `produto_id` de uma só: repetir um pedido de qualquer uma das
           * outras 29 não encontrava opção nenhuma, e o `if (opcao)` logo abaixo
           * descartava em silêncio. O cliente clicava em "pedir de novo" e
           * recebia a pizza pelada, no preço base.
           *
           * Passou despercebido na fase 2 porque a varredura procurava
           * `FROM grupos_opcoes WHERE produto_id`, e aqui o filtro está no JOIN.
           */
          `SELECT o.id, o.nome, o.preco_adicional_centavos,
                  g.id AS grupo_id, g.nome AS grupo_nome, g.modo_preco, pg.max_escolhas
             FROM opcoes_itens o
             JOIN grupos_opcoes g ON g.id = o.grupo_id
             JOIN produto_grupos pg ON pg.grupo_id = g.id AND pg.produto_id = ?
            WHERE o.id = ? AND o.disponivel = 1`
        ).get(i.produto_id, id) as OpcaoExistente | undefined;
        if (opcao) opcoes.push(opcao);
      }

      /*
       * O PREÇO SAI DE `precoDoGrupo`, POR GRUPO — não de uma soma à mão.
       *
       * Aqui somava todos os acréscimos direto, ignorando o `modo_preco`:
       * repetir uma pizza cobrada por 'maior' mostrava a soma dos sabores, um
       * preço acima do que o pedido original custou. E com frações a mesma soma
       * contaria duas vezes o sabor que ocupa 2/4.
       *
       * Agrupar é necessário porque a política é POR GRUPO: borda soma, sabor
       * pode ser 'maior' ou proporcional.
       */
      const porGrupo = new Map<number, OpcaoExistente[]>();
      for (const o of opcoes) {
        const lista = porGrupo.get(o.grupo_id) ?? [];
        lista.push(o);
        porGrupo.set(o.grupo_id, lista);
      }

      let acrescimos = 0;
      const partes: string[] = [];
      for (const lista of porGrupo.values()) {
        const grupo = { modo_preco: lista[0].modo_preco, max_escolhas: lista[0].max_escolhas };
        acrescimos += precoDoGrupo(grupo, lista);
        // Mesmo texto com fração usado na criação do pedido — ver acima.
        const total = lista.length;
        for (const p of contarFracoes(lista)) {
          const nome = (p.opcao as OpcaoExistente).nome;
          partes.push(p.fracoes > 1 && total > 1
            ? `${lista[0].grupo_nome}: ${p.fracoes}/${total} ${nome}`
            : `${lista[0].grupo_nome}: ${nome}`);
        }
      }

      const precoBase = precoVigente(i, dataBrasilia());
      disponiveis.push({
        produto_id: i.produto_id,
        nome: i.nome,
        quantidade: i.quantidade,
        opcoes: opcoes.map(o => o.id),
        opcoes_texto: partes.join(' · '),
        preco_centavos: precoBase + acrescimos,
      });
    }
    const indisponiveis = itens.filter(i => !i.disponivel || i.excluido).map(i => i.nome);

    res.json({ loja_id: pedido.loja_id, itens: disponiveis, indisponiveis });
  } catch (err) { next(err); }
});

// ----- Favoritos -----------------------------------------------------------

/** Lojas favoritas do cliente (cards completos + lista de ids). */
router.get('/favoritos', async (req, res, next) => {
  try {
    const lojas = await db.prepare(
      `SELECT l.id, l.nome, l.descricao, l.categoria, l.taxa_entrega_centavos,
              l.tempo_estimado_min, l.aberta, l.logo_url, l.capa_url,
              l.nota_media, l.nota_qtd
         FROM favoritos f JOIN lojas l ON l.id = f.loja_id
        WHERE f.usuario_id = ? AND l.status_aprovacao = 'aprovada'
        ORDER BY f.criado_em DESC`
    ).all(req.usuario!.id) as Array<{ id: number }>;
    res.json({ lojas, ids: lojas.map(l => l.id) });
  } catch (err) { next(err); }
});

/** Adiciona uma loja aos favoritos (idempotente). */
router.post('/favoritos/:lojaId', async (req, res, next) => {
  try {
    const lojaId = inteiroPositivo(req.params.lojaId);
    if (!lojaId) throw erroHttp(400, 'Loja inválida.');
    const existe = await db.prepare("SELECT id FROM lojas WHERE id = ? AND status_aprovacao = 'aprovada'").get(lojaId);
    if (!existe) throw erroHttp(404, 'Loja não encontrada.');
    await db.prepare(
      'INSERT IGNORE INTO favoritos (usuario_id, loja_id, criado_em) VALUES (?, ?, ?)'
    ).run(req.usuario!.id, lojaId, agoraUTC());
    res.json({ ok: true, favorito: true });
  } catch (err) { next(err); }
});

/** Remove uma loja dos favoritos. */
router.delete('/favoritos/:lojaId', async (req, res, next) => {
  try {
    const lojaId = inteiroPositivo(req.params.lojaId);
    if (!lojaId) throw erroHttp(400, 'Loja inválida.');
    await db.prepare('DELETE FROM favoritos WHERE usuario_id = ? AND loja_id = ?')
      .run(req.usuario!.id, lojaId);
    res.json({ ok: true, favorito: false });
  } catch (err) { next(err); }
});

/* ─────────────────── Dados pessoais (LGPD) ─────────────────── */

/**
 * Cópia de tudo que o sistema guarda sobre esta pessoa.
 *
 * Existe porque a LGPD dá ao titular o direito de ver o que foi coletado, e a
 * alternativa era o lojista pedir pro suporte consultar o banco à mão — o que
 * já é, em si, mais gente vendo o dado do que precisa.
 *
 * É o dado DESTE cliente neste tenant. Um cliente que pediu em duas lojas de
 * plataformas diferentes tem dois cadastros separados; não existe visão única, e
 * prometer isso aqui seria mentira.
 */
router.get('/meus-dados', async (req, res, next) => {
  try {
    const id = req.usuario!.id;
    const perfil = await db.prepare(
      'SELECT id, nome, email, telefone, cpf, criado_em FROM usuarios WHERE id = ?'
    ).get(id);
    const enderecos = await db.prepare(
      'SELECT rotulo, rua, numero, complemento, bairro, cidade, uf, cep, referencia, criado_em FROM enderecos WHERE usuario_id = ? ORDER BY id'
    ).all(id);
    const pedidos = await db.prepare(
      `SELECT p.id, p.status, p.tipo_entrega, p.forma_pagamento, p.endereco_entrega,
              p.subtotal_centavos, p.taxa_entrega_centavos, p.desconto_centavos,
              p.total_centavos, p.criado_em, l.nome AS loja
         FROM pedidos p LEFT JOIN lojas l ON l.id = p.loja_id
        WHERE p.cliente_id = ? ORDER BY p.id DESC`
    ).all(id);
    const avaliacoes = await db.prepare(
      'SELECT pedido_id, nota, comentario, criado_em FROM avaliacoes WHERE cliente_id = ? ORDER BY id'
    ).all(id);

    /*
     * Content-Disposition: o navegador salva como arquivo em vez de abrir JSON
     * na tela. Quem pede os próprios dados quer guardar, não ler cru.
     */
    res.setHeader('Content-Disposition', `attachment; filename="meus-dados-${id}.json"`);
    res.json({
      gerado_em: agoraUTC(),
      aviso: 'Cópia dos seus dados neste estabelecimento. Pedidos aparecem com o valor e o endereço usados na entrega.',
      perfil, enderecos, pedidos, avaliacoes,
    });
  } catch (e) { next(e); }
});

/**
 * EXCLUIR A CONTA — anonimiza, não apaga a linha.
 *
 * O pedido é documento fiscal e não pode sumir: há nota emitida, faturamento do
 * lojista e escrituração apontando pra ele. O que vai embora é tudo que
 * identifica a pessoa (ver anonimizacao.ts). Sobra a venda sem dono.
 *
 * Exige digitar EXCLUIR em vez da senha porque quem entrou pelo Google não tem
 * senha utilizável — pedir senha trancaria justamente esses de exercer o
 * direito. A sessão já prova quem é.
 */
router.post('/conta/excluir', async (req, res, next) => {
  try {
    const id = req.usuario!.id;
    if (textoLimpo(req.body?.confirmacao, 20).toUpperCase() !== 'EXCLUIR') {
      throw erroHttp(400, 'Digite EXCLUIR para confirmar.');
    }

    const eu = await db.prepare('SELECT email FROM usuarios WHERE id = ?').get(id) as { email: string } | undefined;
    if (!eu) throw erroHttp(404, 'Conta não encontrada.');
    // Idempotente: pedir de novo não é erro, e não há nada a reprocessar.
    if (ehAnonimizado(eu.email)) return res.json({ ok: true, ja_removido: true });

    /*
     * PEDIDO EM ANDAMENTO BLOQUEIA. Anonimizar no meio de uma entrega apagaria
     * o endereço que o entregador está usando pra chegar — e o cliente ficaria
     * sem a comida e sem a conta.
     */
    const emAndamento = await db.prepare(
      `SELECT COUNT(*) AS n FROM pedidos
        WHERE cliente_id = ? AND status NOT IN ('entregue', 'cancelado', 'recusado')`
    ).get(id) as { n: number };
    if (Number(emAndamento.n) > 0) {
      throw erroHttp(409, 'Você tem pedido em andamento. Aguarde a entrega para excluir a conta.');
    }

    const anon = dadosAnonimos(id);
    await comTransacao(async (tx) => {
      // Endereços saem inteiros: não há obrigação legal que dependa deles, e o
      // endereço de cada entrega já está gravado no próprio pedido.
      await tx.prepare('DELETE FROM enderecos WHERE usuario_id = ?').run(id);
      await tx.prepare('DELETE FROM push_inscricoes WHERE usuario_id = ?').run(id);
      await tx.prepare('DELETE FROM favoritos WHERE usuario_id = ?').run(id);
      // Códigos de login social pendentes: viram acesso se sobrarem.
      await tx.prepare('DELETE FROM oauth_codigos WHERE usuario_id = ?').run(id);

      // O endereço gravado no pedido é dado pessoal tanto quanto o cadastro.
      await tx.prepare('UPDATE pedidos SET endereco_entrega = ? WHERE cliente_id = ?')
        .run(ENDERECO_ANONIMO, id);

      // Nota e comentário: a nota é estatística da loja e fica; o texto pode
      // conter qualquer coisa que a pessoa escreveu sobre si.
      await tx.prepare('UPDATE avaliacoes SET comentario = ? WHERE cliente_id = ? AND comentario IS NOT NULL AND comentario <> ?')
        .run(TEXTO_ANONIMO, id, '');
      await tx.prepare('UPDATE avaliacoes_entregador SET comentario = ? WHERE cliente_id = ? AND comentario IS NOT NULL AND comentario <> ?')
        .run(TEXTO_ANONIMO, id, '');

      // Chat do pedido: só o que a pessoa escreveu.
      await tx.prepare(
        `UPDATE mensagens_pedido SET texto = ?
          WHERE remetente = 'cliente' AND pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ?)`
      ).run(TEXTO_ANONIMO, id);

      /*
       * Senha trocada por um hash aleatório e conta bloqueada: sem isso, quem
       * soubesse a senha antiga continuaria entrando numa conta "excluída".
       * Também limpa 2FA e token de recuperação, que são caminhos de volta.
       */
      await tx.prepare(
        `UPDATE usuarios
            SET nome = ?, email = ?, telefone = ?, cpf = ?, senha_hash = ?, bloqueado = 1,
                totp_secret = NULL, totp_ativo = 0, totp_backup_codes = NULL,
                reset_token_hash = NULL, reset_token_expira = NULL
          WHERE id = ?`
      ).run(anon.nome, anon.email, anon.telefone, anon.cpf,
        await bcrypt.hash(`removida-${id}-${agoraUTC()}`, 10), id);
    });

    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
