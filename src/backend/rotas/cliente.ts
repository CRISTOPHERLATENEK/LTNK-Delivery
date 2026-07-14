/**
 * Módulo do CLIENTE: endereços, criação de pedido com validação de opções,
 * acompanhamento, cancelamento e "pedir de novo".
 * REGRA CRÍTICA: preços recalculados no servidor a partir do banco.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db';
import { autenticar, exigirPerfil } from '../auth';
import { agoraUTC, textoLimpo, inteiroPositivo, reaisParaCentavos, telefoneDigitos, erroHttp, normalizarBairro } from '../util';
import { transicionarStatus } from '../fluxoPedido';
import { notificarLojistaNovoPedido } from '../notificacoes';
import { notificarPedidoWhatsApp } from '../whatsapp';
import { comissaoPercentualDaLoja } from '../comissao';
import { geocodificar } from '../geo';
import { criarPagamentoMercadoPago, pagamentoOnlineAtivo } from './pagamentos';
import { Endereco, GrupoOpcao, ItemRequisicaoPedido, Loja, OpcaoItem, Pedido, Produto } from '../../tipos/modelos';

const router = Router();
router.use(autenticar, exigirPerfil('cliente'));

// ----- Endereços -----------------------------------------------------------

router.get('/enderecos', (req, res) => {
  const enderecos = db.prepare(
    'SELECT * FROM enderecos WHERE usuario_id = ? ORDER BY id DESC'
  ).all(req.usuario!.id);
  res.json({ enderecos });
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
    const info = db.prepare(
      `INSERT INTO enderecos (usuario_id, rotulo, rua, numero, complemento, bairro, cidade, uf, cep, referencia, lat, lon, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.usuario!.id, e.rotulo, e.rua, e.numero, e.complemento, e.bairro, e.cidade, e.uf, e.cep, e.referencia,
          coord?.lat ?? null, coord?.lon ?? null, agoraUTC());
    res.status(201).json({ endereco: { id: Number(info.lastInsertRowid), ...e, lat: coord?.lat ?? null, lon: coord?.lon ?? null } });
  } catch (err) { next(err); }
});

router.put('/enderecos/:id', async (req, res, next) => {
  try {
    const atual = db.prepare('SELECT id FROM enderecos WHERE id = ? AND usuario_id = ?')
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
    db.prepare(
      `UPDATE enderecos SET rotulo=?, rua=?, numero=?, complemento=?, bairro=?, cidade=?, uf=?, cep=?, referencia=?, lat=?, lon=?
        WHERE id = ?`
    ).run(e.rotulo, e.rua, e.numero, e.complemento, e.bairro, e.cidade, e.uf, e.cep, e.referencia,
          coord?.lat ?? null, coord?.lon ?? null, atual.id);
    res.json({ endereco: { id: atual.id, ...e, lat: coord?.lat ?? null, lon: coord?.lon ?? null } });
  } catch (err) { next(err); }
});

router.delete('/enderecos/:id', (req, res, next) => {
  try {
    const info = db.prepare(
      'DELETE FROM enderecos WHERE id = ? AND usuario_id = ?'
    ).run(req.params.id, req.usuario!.id);
    if (info.changes === 0) throw erroHttp(404, 'Endereço não encontrado.');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ----- Perfil --------------------------------------------------------------

router.put('/perfil', (req, res, next) => {
  try {
    const nome = textoLimpo(req.body.nome, 120);
    const telefone = telefoneDigitos(req.body.telefone);
    if (nome.length < 2) throw erroHttp(400, 'Informe seu nome completo.');
    // Telefone agora também é chave de login — não pode colidir com outra conta.
    if (telefone) {
      const dono = db.prepare('SELECT id FROM usuarios WHERE telefone = ? AND id != ?')
        .get(telefone, req.usuario!.id);
      if (dono) throw erroHttp(409, 'Esse telefone já está em uso por outra conta.');
    }
    db.prepare('UPDATE usuarios SET nome = ?, telefone = ? WHERE id = ?')
      .run(nome, telefone, req.usuario!.id);
    res.json({ usuario: { id: req.usuario!.id, nome, telefone, email: req.usuario!.email, perfil: 'cliente' } });
  } catch (err) { next(err); }
});

router.put('/senha', (req, res, next) => {
  try {
    const atual = typeof req.body.senha_atual === 'string' ? req.body.senha_atual : '';
    const nova = typeof req.body.senha_nova === 'string' ? req.body.senha_nova : '';
    if (nova.length < 6) throw erroHttp(400, 'A nova senha precisa ter pelo menos 6 caracteres.');

    const u = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?')
      .get(req.usuario!.id) as { senha_hash: string } | undefined;
    if (!u || !bcrypt.compareSync(atual, u.senha_hash)) {
      throw erroHttp(400, 'Senha atual incorreta.');
    }
    db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(nova, 10), req.usuario!.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ----- Cupom ---------------------------------------------------------------

interface CupomAplicado { id: number; codigo: string; tipo: 'percentual' | 'fixo'; valor: number; desconto_centavos: number; }

/**
 * Valida um cupom da loja contra o subtotal. Lança erro com mensagem clara se
 * inválido/expirado/esgotado/abaixo do mínimo. Retorna null se nenhum código.
 */
function validarCupom(lojaId: number, codigoRaw: string, subtotal: number): CupomAplicado | null {
  const codigo = textoLimpo(codigoRaw, 30).toUpperCase().replace(/\s+/g, '');
  if (!codigo) return null;

  const cupom = db.prepare(
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
router.post('/cupons/validar', (req, res, next) => {
  try {
    const lojaId = inteiroPositivo(req.body.loja_id);
    const subtotal = inteiroPositivo(req.body.subtotal) || inteiroPositivo(req.body.subtotal_centavos) || 0;
    if (!lojaId) throw erroHttp(400, 'Loja inválida.');
    const cupom = validarCupom(lojaId, String(req.body.codigo || ''), subtotal);
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

function validarOpcoesDoItem(produto: Produto, opcoesEscolhidas: number[] | undefined): ResultadoOpcoes {
  const ids = Array.isArray(opcoesEscolhidas)
    ? [...new Set(opcoesEscolhidas.map(v => inteiroPositivo(v)).filter((v): v is number => v !== null))]
    : [];

  const grupos = db.prepare(
    'SELECT * FROM grupos_opcoes WHERE produto_id = ? ORDER BY ordem, id'
  ).all(produto.id) as GrupoOpcao[];
  const buscarOpcoes = db.prepare(
    'SELECT * FROM opcoes_itens WHERE grupo_id = ? AND disponivel = 1'
  );

  let precoUnit = (produto.preco_promocional_centavos && produto.preco_promocional_centavos > 0)
    ? produto.preco_promocional_centavos : produto.preco_centavos;
  const partesTexto: string[] = [];
  const idsReconhecidos = new Set<number>();

  for (const grupo of grupos) {
    const opcoesDoGrupo = buscarOpcoes.all(grupo.id) as OpcaoItem[];
    if (opcoesDoGrupo.length === 0) continue;
    const escolhidas = opcoesDoGrupo.filter(o => ids.includes(o.id));
    for (const o of escolhidas) idsReconhecidos.add(o.id);

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
      if (grupo.max_escolhas > 0 && escolhidas.length > grupo.max_escolhas) {
        throw erroHttp(400, `"${grupo.nome}" permite no máximo ${grupo.max_escolhas} escolha(s) no item "${produto.nome}".`);
      }
    }

    for (const opcao of escolhidas) {
      precoUnit += opcao.preco_adicional_centavos;
      partesTexto.push(`${grupo.nome}: ${opcao.nome}`);
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
    if (!['pix', 'dinheiro', 'cartao_entrega'].includes(formaPagamento)) {
      throw erroHttp(400, 'Escolha a forma de pagamento: Pix, dinheiro ou cartão na entrega.');
    }
    // 'pix' = Pix online (gera cobrança no Mercado Pago). A disponibilidade da
    // integração só é checada mais abaixo, DEPOIS de validar loja, endereço e
    // itens — assim o cliente recebe a mensagem correta (loja fechada, item
    // inválido) em vez de "Pix indisponível" mascarando o motivo real.
    const pixOnline = formaPagamento === 'pix';

    const loja = db.prepare('SELECT * FROM lojas WHERE id = ?').get(lojaId) as Loja | undefined;
    if (!loja || loja.status_aprovacao !== 'aprovada') throw erroHttp(404, 'Loja não encontrada.');
    if (!loja.aberta) throw erroHttp(409, 'Esta loja está fechada no momento e não pode receber pedidos.');

    const endereco = db.prepare('SELECT * FROM enderecos WHERE id = ? AND usuario_id = ?')
      .get(enderecoId, req.usuario!.id) as Endereco | undefined;
    if (!endereco) throw erroHttp(400, 'Selecione um endereço de entrega válido.');

    let subtotal = 0;
    const itensValidados: Array<{ produto: Produto; quantidade: number; precoUnit: number; opcoesTexto: string; opcoesIds: number[] }> = [];
    for (const item of itens) {
      const produtoId = inteiroPositivo(item.produto_id);
      const quantidade = inteiroPositivo(item.quantidade);
      if (!produtoId || !quantidade || quantidade > 50) {
        throw erroHttp(400, 'Itens do carrinho inválidos.');
      }
      const produto = db.prepare('SELECT * FROM produtos WHERE id = ? AND loja_id = ?')
        .get(produtoId, lojaId) as Produto | undefined;
      if (!produto || produto.excluido) throw erroHttp(400, 'Um dos itens não existe mais no cardápio.');
      if (!produto.disponivel) throw erroHttp(409, `O item "${produto.nome}" está pausado no momento. Remova-o do carrinho.`);

      const { precoUnit, opcoesTexto, opcoesIds } = validarOpcoesDoItem(produto, item.opcoes);
      subtotal += precoUnit * quantidade;
      itensValidados.push({ produto, quantidade, precoUnit, opcoesTexto, opcoesIds });
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
    if (pixOnline && !pagamentoOnlineAtivo(lojaId)) {
      throw erroHttp(503, 'Pagamento via Pix online indisponível no momento. Escolha pagar na entrega.');
    }

    // Pedido mínimo da loja (0 = sem mínimo).
    const minimoLoja = (loja as any).minimo_pedido_centavos || 0;
    if (minimoLoja > 0 && subtotal < minimoLoja) {
      const falta = (minimoLoja / 100).toFixed(2).replace('.', ',');
      throw erroHttp(400, `Pedido mínimo desta loja é R$ ${falta} (sem contar a entrega).`);
    }

    // Frete por bairro: usa a zona de entrega cadastrada; senão, a taxa padrão.
    // Comparação tolerante (normalizarBairro) — o bairro do cliente vem do
    // ViaCEP e pode variar de grafia em relação ao que o lojista digitou
    // (ex.: "Jd. Sofia" vs "Jardim Sofia").
    const zonasLoja = db.prepare(
      'SELECT bairro, taxa_centavos FROM zonas_entrega WHERE loja_id = ?'
    ).all(lojaId) as { bairro: string; taxa_centavos: number }[];
    const bairroCliente = normalizarBairro(endereco.bairro);
    const zona = zonasLoja.find(z => normalizarBairro(z.bairro) === bairroCliente);
    const taxaEntrega = zona ? zona.taxa_centavos : loja.taxa_entrega_centavos;

    // Cupom (opcional): valida no servidor e desconta do subtotal.
    const cupom = req.body.cupom_codigo
      ? validarCupom(lojaId, String(req.body.cupom_codigo), subtotal)
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

    const comissaoPct = comissaoPercentualDaLoja(lojaId);
    // Comissão incide sobre o valor líquido (subtotal já com o desconto do cupom).
    const comissao = Math.round(subtotalComDesconto * comissaoPct / 100);

    const agora = agoraUTC();
    const criar = db.transaction(() => {
      const info = db.prepare(
        `INSERT INTO pedidos (cliente_id, loja_id, status, endereco_entrega, entrega_lat, entrega_lon, forma_pagamento,
                              troco_para_centavos, observacoes, subtotal_centavos,
                              taxa_entrega_centavos, desconto_centavos, cupom_codigo, total_centavos,
                              comissao_percentual, comissao_centavos, pagamento_status, criado_em, atualizado_em)
         VALUES (?, ?, 'pendente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(req.usuario!.id, lojaId, formatarEndereco(endereco),
            (endereco as any).lat ?? null, (endereco as any).lon ?? null, formaPagamento,
            trocoPara, observacoes, subtotal, taxaEntrega, descontoCupom, cupom?.codigo || '',
            total, comissaoPct, comissao, pixOnline ? 'aguardando' : 'na_entrega', agora, agora);

      const pedidoId = Number(info.lastInsertRowid);

      // Consome um uso do cupom (dentro da transação, evita corrida).
      if (cupom) db.prepare('UPDATE cupons SET usos_count = usos_count + 1 WHERE id = ?').run(cupom.id);
      const inserirItem = db.prepare(
        `INSERT INTO itens_pedido (pedido_id, produto_id, nome_produto, preco_unit_centavos, quantidade, opcoes_texto, opcoes_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const { produto, quantidade, precoUnit, opcoesTexto, opcoesIds } of itensValidados) {
        inserirItem.run(pedidoId, produto.id, produto.nome, precoUnit, quantidade, opcoesTexto, JSON.stringify(opcoesIds));
      }
      // Baixa de estoque (só produtos que controlam). UPDATE condicional: se outro
      // pedido esgotou entre a validação e aqui, changes=0 e desfazemos tudo.
      const baixar = db.prepare(
        'UPDATE produtos SET estoque = estoque - ? WHERE id = ? AND controla_estoque = 1 AND estoque >= ?'
      );
      for (const [produtoId, qtd] of qtdPorProduto) {
        const alvo = itensValidados.find(i => i.produto.id === produtoId)!.produto;
        if (!(alvo as any).controla_estoque) continue;
        const r = baixar.run(qtd, produtoId, qtd);
        if (r.changes === 0) throw erroHttp(409, `O item "${alvo.nome}" acabou de esgotar. Ajuste o carrinho.`);
      }
      db.prepare('INSERT INTO historico_status (pedido_id, status, criado_em) VALUES (?, ?, ?)')
        .run(pedidoId, 'pendente', agora);
      return pedidoId;
    });

    const pedidoId = criar();

    // Pix online: gera a cobrança no Mercado Pago e devolve o QR. O lojista só
    // é avisado quando o pagamento for aprovado (pelo webhook). Se a cobrança
    // falhar, desfaz o pedido pra não deixar lixo.
    if (pixOnline) {
      try {
        const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId) as Pedido;
        const pix = await criarPagamentoMercadoPago(lojaId, pedido, { email: req.usuario!.email });
        db.prepare(
          "UPDATE pedidos SET pagamento_gateway = 'mercadopago', pagamento_gateway_id = ? WHERE id = ?"
        ).run(pix.pagamento_id, pedidoId);
        notificarPedidoWhatsApp(pedidoId);
        return res.status(201).json({ pedido_id: pedidoId, total_centavos: total, pix });
      } catch (e) {
        // Limpa o pedido recém-criado (e devolve estoque + uso do cupom).
        db.transaction(() => {
          if (cupom) db.prepare('UPDATE cupons SET usos_count = MAX(usos_count - 1, 0) WHERE id = ?').run(cupom.id);
          const devolver = db.prepare(
            'UPDATE produtos SET estoque = estoque + ? WHERE id = ? AND controla_estoque = 1'
          );
          for (const [produtoId, qtd] of qtdPorProduto) devolver.run(qtd, produtoId);
          db.prepare('DELETE FROM itens_pedido WHERE pedido_id = ?').run(pedidoId);
          db.prepare('DELETE FROM historico_status WHERE pedido_id = ?').run(pedidoId);
          db.prepare('DELETE FROM pedidos WHERE id = ?').run(pedidoId);
        })();
        throw erroHttp(502, 'Não foi possível gerar o Pix agora. Tente de novo ou escolha pagar na entrega.');
      }
    }

    // Pagamento na entrega: o lojista é avisado na hora.
    notificarLojistaNovoPedido(pedidoId);
    notificarPedidoWhatsApp(pedidoId);
    res.status(201).json({ pedido_id: pedidoId, total_centavos: total });
  } catch (err) { next(err); }
});

router.get('/pedidos', (req, res) => {
  const pedidos = db.prepare(
    `SELECT p.*, l.nome AS loja_nome
       FROM pedidos p JOIN lojas l ON l.id = p.loja_id
      WHERE p.cliente_id = ?
      ORDER BY p.id DESC LIMIT 100`
  ).all(req.usuario!.id);
  res.json({ pedidos });
});

router.get('/pedidos/:id', (req, res, next) => {
  try {
    const pedido = db.prepare(
      `SELECT p.*, l.nome AS loja_nome, l.tempo_estimado_min,
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

    const itens = db.prepare('SELECT * FROM itens_pedido WHERE pedido_id = ?').all((pedido as any).id);
    const historico = db.prepare(
      'SELECT status, criado_em FROM historico_status WHERE pedido_id = ? ORDER BY id'
    ).all((pedido as any).id);
    const avaliacao = db.prepare(
      'SELECT nota, comentario, resposta FROM avaliacoes WHERE pedido_id = ?'
    ).get((pedido as any).id) || null;
    const avaliacaoEntregador = db.prepare(
      'SELECT nota, comentario FROM avaliacoes_entregador WHERE pedido_id = ?'
    ).get((pedido as any).id) || null;
    res.json({ pedido, itens, historico, avaliacao, avaliacaoEntregador });
  } catch (err) { next(err); }
});

/** Recalcula e grava a nota média/quantidade da loja após uma avaliação. */
function recalcularNotaLoja(lojaId: number): void {
  const agg = db.prepare(
    'SELECT AVG(nota) AS media, COUNT(*) AS qtd FROM avaliacoes WHERE loja_id = ?'
  ).get(lojaId) as { media: number | null; qtd: number };
  db.prepare('UPDATE lojas SET nota_media = ?, nota_qtd = ? WHERE id = ?')
    .run(agg.media ? Math.round(agg.media * 10) / 10 : 0, agg.qtd, lojaId);
}

router.post('/pedidos/:id/avaliar', (req, res, next) => {
  try {
    const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ? AND cliente_id = ?')
      .get(req.params.id, req.usuario!.id) as { id: number; loja_id: number; status: string } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    if (pedido.status !== 'entregue') {
      throw erroHttp(409, 'Você só pode avaliar pedidos que já foram entregues.');
    }
    const nota = inteiroPositivo(req.body.nota);
    if (!nota || nota < 1 || nota > 5) throw erroHttp(400, 'Dê uma nota de 1 a 5 estrelas.');
    const comentario = textoLimpo(req.body.comentario, 500);

    const jaTem = db.prepare('SELECT id FROM avaliacoes WHERE pedido_id = ?').get(pedido.id);
    if (jaTem) throw erroHttp(409, 'Você já avaliou este pedido.');

    db.prepare(
      `INSERT INTO avaliacoes (pedido_id, loja_id, cliente_id, nota, comentario, criado_em)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(pedido.id, pedido.loja_id, req.usuario!.id, nota, comentario, agoraUTC());
    recalcularNotaLoja(pedido.loja_id);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

/** Recalcula e grava a nota média/quantidade do entregador (mesmo padrão da loja). */
function recalcularNotaEntregador(entregadorId: number): void {
  const agg = db.prepare(
    'SELECT AVG(nota) AS media, COUNT(*) AS qtd FROM avaliacoes_entregador WHERE entregador_id = ?'
  ).get(entregadorId) as { media: number | null; qtd: number };
  db.prepare('UPDATE usuarios SET nota_media = ?, nota_qtd = ? WHERE id = ?')
    .run(agg.media ? Math.round(agg.media * 10) / 10 : 0, agg.qtd, entregadorId);
}

router.post('/pedidos/:id/avaliar-entregador', (req, res, next) => {
  try {
    const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ? AND cliente_id = ?')
      .get(req.params.id, req.usuario!.id) as { id: number; entregador_id: number | null; status: string } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    if (pedido.status !== 'entregue') throw erroHttp(409, 'Você só pode avaliar pedidos que já foram entregues.');
    if (!pedido.entregador_id) throw erroHttp(409, 'Este pedido não teve um entregador atribuído.');

    const nota = inteiroPositivo(req.body.nota);
    if (!nota || nota < 1 || nota > 5) throw erroHttp(400, 'Dê uma nota de 1 a 5 estrelas.');
    const comentario = textoLimpo(req.body.comentario, 500);

    const jaTem = db.prepare('SELECT id FROM avaliacoes_entregador WHERE pedido_id = ?').get(pedido.id);
    if (jaTem) throw erroHttp(409, 'Você já avaliou este entregador.');

    db.prepare(
      `INSERT INTO avaliacoes_entregador (pedido_id, entregador_id, cliente_id, nota, comentario, criado_em)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(pedido.id, pedido.entregador_id, req.usuario!.id, nota, comentario, agoraUTC());
    recalcularNotaEntregador(pedido.entregador_id);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// ----- Chat do pedido --------------------------------------------------------

router.get('/pedidos/:id/mensagens', (req, res, next) => {
  try {
    const pedido = db.prepare('SELECT id FROM pedidos WHERE id = ? AND cliente_id = ?')
      .get(req.params.id, req.usuario!.id) as { id: number } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    const mensagens = db.prepare(
      'SELECT id, remetente, texto, criado_em FROM mensagens_pedido WHERE pedido_id = ? ORDER BY id'
    ).all(pedido.id);
    db.prepare("UPDATE mensagens_pedido SET lida = 1 WHERE pedido_id = ? AND remetente IN ('entregador','loja')").run(pedido.id);
    res.json({ mensagens });
  } catch (err) { next(err); }
});

// Antes de ter entregador atribuído o cliente fala com a LOJA; depois passa a
// falar com o entregador — mas é sempre a mesma thread, sem trava por status.
router.post('/pedidos/:id/mensagens', (req, res, next) => {
  try {
    const pedido = db.prepare("SELECT id, status FROM pedidos WHERE id = ? AND cliente_id = ?")
      .get(req.params.id, req.usuario!.id) as { id: number; status: string } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    if (['cancelado', 'recusado'].includes(pedido.status)) throw erroHttp(409, 'Este pedido já foi encerrado.');
    const texto = textoLimpo(req.body.texto, 500);
    if (!texto) throw erroHttp(400, 'Escreva uma mensagem.');
    const info = db.prepare(
      `INSERT INTO mensagens_pedido (pedido_id, remetente, texto, criado_em) VALUES (?, 'cliente', ?, ?)`
    ).run(pedido.id, texto, agoraUTC());
    res.status(201).json({ mensagem_id: Number(info.lastInsertRowid) });
  } catch (err) { next(err); }
});

router.post('/pedidos/:id/cancelar', (req, res, next) => {
  try {
    const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ? AND cliente_id = ?')
      .get(req.params.id, req.usuario!.id) as { id: number; status: string } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    if (pedido.status !== 'pendente') {
      throw erroHttp(409, 'Este pedido já foi aceito pela loja e não pode mais ser cancelado.');
    }
    transicionarStatus(pedido.id, 'cancelado');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/pedidos/:id/repetir', (req, res, next) => {
  try {
    const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ? AND cliente_id = ?')
      .get(req.params.id, req.usuario!.id) as { id: number; loja_id: number } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');

    type ItemAntigo = {
      produto_id: number; quantidade: number; opcoes_ids: string; opcoes_texto: string;
      nome: string; preco_centavos: number; preco_promocional_centavos: number | null;
      disponivel: number; excluido: number;
    };
    const itens = db.prepare(
      `SELECT i.produto_id, i.quantidade, i.opcoes_ids, i.opcoes_texto,
              pr.nome, pr.preco_centavos, pr.preco_promocional_centavos, pr.disponivel, pr.excluido
         FROM itens_pedido i JOIN produtos pr ON pr.id = i.produto_id
        WHERE i.pedido_id = ?`
    ).all(pedido.id) as ItemAntigo[];

    const opcaoAindaExiste = db.prepare(
      `SELECT o.id, o.nome, o.preco_adicional_centavos, g.nome AS grupo_nome
         FROM opcoes_itens o JOIN grupos_opcoes g ON g.id = o.grupo_id
        WHERE o.id = ? AND g.produto_id = ? AND o.disponivel = 1`
    );

    const disponiveis = itens.filter(i => i.disponivel && !i.excluido).map(i => {
      let idsAntigos: number[] = [];
      try { idsAntigos = JSON.parse(i.opcoes_ids); } catch { /* pedido antigo sem opções */ }
      type OpcaoExistente = { id: number; nome: string; preco_adicional_centavos: number; grupo_nome: string };
      const opcoes = idsAntigos
        .map(id => opcaoAindaExiste.get(id, i.produto_id) as OpcaoExistente | undefined)
        .filter((o): o is OpcaoExistente => !!o);
      const precoBase = (i.preco_promocional_centavos && i.preco_promocional_centavos > 0)
        ? i.preco_promocional_centavos : i.preco_centavos;
      return {
        produto_id: i.produto_id,
        nome: i.nome,
        quantidade: i.quantidade,
        opcoes: opcoes.map(o => o.id),
        opcoes_texto: opcoes.map(o => `${o.grupo_nome}: ${o.nome}`).join(' · '),
        preco_centavos: precoBase + opcoes.reduce((s, o) => s + o.preco_adicional_centavos, 0),
      };
    });
    const indisponiveis = itens.filter(i => !i.disponivel || i.excluido).map(i => i.nome);

    res.json({ loja_id: pedido.loja_id, itens: disponiveis, indisponiveis });
  } catch (err) { next(err); }
});

// ----- Favoritos -----------------------------------------------------------

/** Lojas favoritas do cliente (cards completos + lista de ids). */
router.get('/favoritos', (req, res) => {
  const lojas = db.prepare(
    `SELECT l.id, l.nome, l.descricao, l.categoria, l.taxa_entrega_centavos,
            l.tempo_estimado_min, l.aberta, l.logo_url, l.capa_url,
            l.nota_media, l.nota_qtd
       FROM favoritos f JOIN lojas l ON l.id = f.loja_id
      WHERE f.usuario_id = ? AND l.status_aprovacao = 'aprovada'
      ORDER BY f.criado_em DESC`
  ).all(req.usuario!.id) as Array<{ id: number }>;
  res.json({ lojas, ids: lojas.map(l => l.id) });
});

/** Adiciona uma loja aos favoritos (idempotente). */
router.post('/favoritos/:lojaId', (req, res, next) => {
  try {
    const lojaId = inteiroPositivo(req.params.lojaId);
    if (!lojaId) throw erroHttp(400, 'Loja inválida.');
    const existe = db.prepare("SELECT id FROM lojas WHERE id = ? AND status_aprovacao = 'aprovada'").get(lojaId);
    if (!existe) throw erroHttp(404, 'Loja não encontrada.');
    db.prepare(
      'INSERT OR IGNORE INTO favoritos (usuario_id, loja_id, criado_em) VALUES (?, ?, ?)'
    ).run(req.usuario!.id, lojaId, agoraUTC());
    res.json({ ok: true, favorito: true });
  } catch (err) { next(err); }
});

/** Remove uma loja dos favoritos. */
router.delete('/favoritos/:lojaId', (req, res, next) => {
  try {
    const lojaId = inteiroPositivo(req.params.lojaId);
    if (!lojaId) throw erroHttp(400, 'Loja inválida.');
    db.prepare('DELETE FROM favoritos WHERE usuario_id = ? AND loja_id = ?')
      .run(req.usuario!.id, lojaId);
    res.json({ ok: true, favorito: false });
  } catch (err) { next(err); }
});

export default router;
