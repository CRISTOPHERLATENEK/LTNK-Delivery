/*
 * LABORATÓRIO DE TELA ESTREITA — só liga com `?laboratorio=1` na URL.
 *
 * PARA QUE SERVE: o painel do lojista tem vinte telas atrás de login, e para
 * medir o que estoura em 375 px eu preciso DESENHAR cada uma. Este arquivo põe
 * uma sessão de mentira e uma rede de mentira no navegador, então as telas
 * montam com dado plausível sem nenhuma credencial e sem tocar em servidor.
 *
 * POR QUE UM ARQUIVO, E NÃO COLAR NO CONSOLE: a validação de sessão acontece no
 * boot do app. Injetar depois não adianta — a tela já decidiu que é login. Isto
 * precisa rodar ANTES do bundle, e é por isso que ele entra no `index.html`.
 *
 * NÃO VAI PARA PRODUÇÃO ligado: sem o parâmetro na URL ele não faz nada, e o
 * arquivo é servido só pelo servidor de desenvolvimento.
 */
(function () {
  if (!location.search.includes('laboratorio=1')) return;

  localStorage.setItem('token:lojista', 'token-de-mentira-do-laboratorio');
  localStorage.setItem('usuario:lojista', JSON.stringify({
    id: 1, nome: 'Loja de Teste', email: 'teste@exemplo.com', perfil: 'lojista', loja_id: 1,
  }));

  var nomeComprido = 'PRODUTO DE TESTE COM NOME BEM COMPRIDO PARA ESTOURAR';

  function produto(i) {
    return {
      id: i, nome: nomeComprido + ' ' + i, descricao: 'Descrição longa do produto ' + i,
      categoria: i % 2 ? 'Cervejas' : 'Destilados', subcategoria: '',
      preco_centavos: 1290 + i, preco_promocional_centavos: 0, promo_fim: null,
      destaque: i === 1 ? 1 : 0, foto_url: '', foto_credito: '', disponivel: 1, disponivel_pdv: 1,
      vendido_por: 'un', codigo_barras: '789199101549' + (i % 10), controla_estoque: 1,
      estoque: 10 + i, vendido_sozinho: 1, ordem: i, grupos: [], excluido: 0,
      ncm: '21069090', cfop: '5102', csosn: '102', origem: '0', unidade_comercial: 'UN', cest: '',
    };
  }

  function pedido(i) {
    return {
      id: i, codigo: 'P' + (1000 + i), status: ['recebido', 'preparo', 'pronto', 'entrega'][i % 4],
      cliente_nome: 'Cliente Com Nome Bem Comprido ' + i, cliente_telefone: '11999990000',
      total_centavos: 5490 + i * 100, taxa_entrega_centavos: 0, desconto_centavos: 0,
      forma_pagamento: 'dinheiro', pagamento_status: 'na_entrega', tipo_entrega: 'entrega',
      criado_em: '2026-09-12T12:00:00Z', atualizado_em: '2026-09-12T12:00:00Z',
      endereco: 'Rua Com Nome Muito Comprido Para Testar, 1234 - Bairro Distante',
      itens: [{ id: 1, produto_nome: nomeComprido, quantidade: 2, preco_centavos: 1290, opcoes: [] }],
    };
  }

  var loja = {
    id: 1, nome: 'Loja de Teste', slug: 'teste', aberta: 1, taxa_entrega_centavos: 0,
    minimo_pedido_centavos: 0, tempo_estimado_min: 40, aceita_retirada: 1, pagamento_online: 0,
    horario_json: '[]', auto_horario: 0, cor_marca: '#e8a33d', canal_versao: 'estavel',
    logo_url: '', capa_url: '', telefone: '11999990000', endereco: 'Rua da Loja, 1',
  };

  function corpo(u) {
    if (u.indexOf('/produtos') >= 0) return { produtos: [1, 2, 3, 4, 5].map(produto), itens: [], grupos: [], candidatos: [] };
    if (u.indexOf('/pedidos') >= 0) return { pedidos: [1, 2, 3, 4, 5].map(pedido), total: 5 };
    if (u.indexOf('/relatorio') >= 0) {
      /* A FORMA E A DA TELA (interface Relatorio), nao a que eu imaginei: na
         primeira rodada eu inventei os nomes das chaves e o que eu medi foi a
         tela de erro do ErrorBoundary, nao o relatorio. */
      var intervalo = { de: '2026-09-01', ate: '2026-09-12', rotulo: 'Setembro de 2026' };
      return {
        periodo: 'mes', intervalo: intervalo,
        resumo: { pedidos: 128, faturamento_centavos: 1234567, comissao_centavos: 61728, ticket_medio_centavos: 9645 },
        mais_vendidos: [1, 2, 3].map(function (i) {
          return { nome_produto: nomeComprido + ' ' + i, quantidade: 30 - i, total_centavos: 900000 - i * 1000 };
        }),
        por_pagamento: [
          { forma_pagamento: 'dinheiro', qtd: 40, total_centavos: 400000 },
          { forma_pagamento: 'pix_entrega', qtd: 60, total_centavos: 600000 },
          { forma_pagamento: 'cartao_entrega', qtd: 28, total_centavos: 234567 },
        ],
        cancelamento: { cancelados: 3, total: 128, taxa_percent: 2.3 },
        por_hora: [18, 19, 20, 21, 22].map(function (h) { return { hora: h, qtd: h - 15 }; }),
        financeiro: { faturamento_bruto_centavos: 1234567, comissao_plataforma_centavos: 61728, liquido_centavos: 1172839 },
        comparacao: {
          intervalo: intervalo, pedidos: 100, faturamento_centavos: 1000000, ticket_medio_centavos: 10000,
          variacao: { pedidos_percent: 28, faturamento_percent: 23.4, ticket_percent: -3.5 },
        },
        curva_abc: {
          itens: [1, 2, 3].map(function (i) {
            return {
              nome_produto: nomeComprido + ' ' + i, produto_id: i, quantidade: 30 - i,
              total_centavos: 900000 - i * 1000, participacao_percent: 30 - i,
              acumulado_percent: 30 * i, classe: ['A', 'B', 'C'][i - 1],
            };
          }),
          classes: ['A', 'B', 'C'].map(function (c, i) {
            return { classe: c, itens: 3 - i, total_centavos: 300000, participacao_percent: 33 };
          }),
        },
        por_canal: [
          { canal: 'app', qtd: 90, total_centavos: 900000 },
          { canal: 'pdv', qtd: 38, total_centavos: 334567 },
        ],
        estoque: {
          itens: [1, 2].map(function (i) {
            return { nome: nomeComprido + ' ' + i, produto_id: i, estoque: i, valor_centavos: 1290 * i };
          }),
          sem_estoque: 2, baixo: 5, valor_total_centavos: 456789,
        },
      };
    }
    if (u.indexOf('/caixa') >= 0) {
      return {
        aberto: {
          id: 1, aberto_em: '2026-09-12T08:00:00Z', abertura_centavos: 20000,
          operador_nome: 'Operador Com Nome Comprido', saldo_centavos: 145000,
        },
        resumo: {
          dinheiro_centavos: 80000, cartao_centavos: 40000, pix_centavos: 25000,
          sangrias_centavos: 5000, suprimentos_centavos: 0, esperado_centavos: 145000,
        },
        vendas: { quantidade: 37 },
        movimentos: [1, 2, 3].map(function (i) {
          return {
            id: i, tipo: i % 2 ? 'sangria' : 'suprimento', valor_centavos: 5000 * i,
            motivo: 'Motivo do movimento numero ' + i, criado_em: '2026-09-12T10:00:00Z',
            operador_nome: 'Operador Com Nome Comprido',
          };
        }),
        historico: [1, 2].map(function (i) {
          return {
            id: i, aberto_em: '2026-09-11T08:00:00Z', fechado_em: '2026-09-11T22:00:00Z',
            abertura_centavos: 20000, fechamento_centavos: 150000, diferenca_centavos: -500,
            operador_nome: 'Operador Com Nome Comprido',
          };
        }),
        tempo: { horas: 6, alerta: false },
      };
    }
    if (u.indexOf('/mesas') >= 0) {
      return {
        mesas: [1, 2, 3, 4].map(function (i) {
          return {
            id: i, numero: i, lugares: 2 + i, status: i % 2 ? 'ocupada' : 'livre',
            comanda_id: i % 2 ? i : null, total_centavos: i % 2 ? 12900 * i : 0,
            aberta_em: '2026-09-12T11:00:00Z', cliente_nome: 'Cliente Da Mesa ' + i,
          };
        }),
        comandas: [1, 2].map(function (i) {
          return {
            id: i, mesa_id: i, mesa_numero: i, cliente_nome: 'Cliente Com Nome Comprido ' + i,
            total_centavos: 12900 * i, aberta_em: '2026-09-12T11:00:00Z', itens: [],
          };
        }),
      };
    }
    if (u.indexOf('/avaliacoes') >= 0) {
      return {
        avaliacoes: [1, 2, 3].map(function (i) {
          return {
            id: i, nota: 5 - (i % 3), comentario: 'Comentario de cliente bem comprido para testar quebra de linha ' + i,
            cliente_nome: 'Cliente Com Nome Comprido ' + i, criado_em: '2026-09-12T10:00:00Z',
            pedido_id: i, resposta: '', produto_nome: nomeComprido,
          };
        }),
        media: 4.3, qtd: 3,
      };
    }
    if (u.indexOf('/cupons') >= 0) {
      return {
        cupons: [1, 2].map(function (i) {
          return {
            id: i, codigo: 'CUPOMDEDESCONTOGRANDE' + i, tipo: i % 2 ? 'percentual' : 'valor',
            valor: i % 2 ? 10 : 500, minimo_centavos: 3000, ativo: 1, usos: 4, limite_usos: 100,
            validade: '2026-12-31', primeira_compra: 0,
          };
        }),
      };
    }
    if (u.indexOf('/clientes') >= 0) {
      return {
        clientes: [1, 2, 3].map(function (i) {
          return {
            id: i, nome: 'Cliente Com Nome Bem Comprido Numero ' + i, telefone: '11999990000',
            email: 'cliente.com.email.comprido' + i + '@exemplo.com.br', pedidos: 10 - i,
            total_centavos: 50000 - i * 1000, ultimo_pedido: '2026-09-10T20:00:00Z',
          };
        }),
        total: 3,
      };
    }
    if (u.indexOf('/categorias') >= 0) return { categorias: [{ nome: 'Cervejas', ordem: 1, icone: '', imagem: '' }] };
    if (u.indexOf('/caixa') >= 0) return { caixa: null, movimentos: [], aberto: false, resumo: {} };
    if (u.indexOf('/mesas') >= 0) return { mesas: [{ id: 1, numero: 1, lugares: 4, status: 'livre', comanda: null }] };
    if (u.indexOf('/cupons') >= 0) return { cupons: [] };
    if (u.indexOf('/banners') >= 0) return { banners: [] };
    if (u.indexOf('/clientes') >= 0) return { clientes: [], total: 0 };
    if (u.indexOf('/avaliacoes') >= 0) return { avaliacoes: [], media: 0, total: 0 };
    if (u.indexOf('/loja') >= 0 || u.indexOf('/me') >= 0) return { loja: loja, usuario: { id: 1, nome: 'Loja de Teste', perfil: 'lojista' } };
    /*
     * O PADRAO NAO PODE SER `{}`. Tela que faz `resposta.lista.map(...)` quebra
     * no `undefined`, e ai o que eu meco e a tela de erro — foi o que aconteceu
     * com Relatorios na primeira rodada. Este monte de chaves vazias cobre os
     * nomes que as telas usam, e o que faltar aparece como lista vazia, nao
     * como excecao.
     */
    return {
      itens: [], lista: [], dados: [], registros: [], historico: [], eventos: [],
      entregadores: [], usuarios: [], contas: [], setores: [], impressoras: [],
      zonas: [], areas: [], bairros: [], grupos: [], opcoes: [], combos: [],
      notas: [], movimentos: [], integracoes: [], assinaturas: [], planos: [],
      resumo: {}, total: 0, totais: {}, config: {}, status: {},
    };
  }

  var real = window.fetch.bind(window);
  window.fetch = function (url, init) {
    var u = String(url && url.url ? url.url : url);
    if (u.indexOf('/api/') >= 0) {
      return Promise.resolve(new Response(JSON.stringify(corpo(u)), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    return real(url, init);
  };

  /** Mede o que estoura a largura da tela. Usado pelo agente, pelo console. */
  window.medirEstouro = function () {
    var limite = document.documentElement.clientWidth;
    var culpados = [];
    document.querySelectorAll('body *').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > limite + 1 || r.left < -1) {
        var pai = el.parentElement;
        var paiR = pai ? pai.getBoundingClientRect() : null;
        /* só o culpado, não a cadeia inteira: quem estoura e cujo pai não */
        if (!paiR || (paiR.right <= limite + 1 && paiR.left >= -1)) {
          culpados.push({
            tag: el.tagName.toLowerCase(),
            classe: String(el.className || '').slice(0, 120),
            texto: (el.textContent || '').trim().slice(0, 50),
            largura: Math.round(r.width),
            passa: Math.round(r.right - limite),
          });
        }
      }
    });
    /*
     * SEGUNDA MEDIDA: CONTEUDO CORTADO DENTRO DO PROPRIO RECIPIENTE.
     *
     * A pagina pode medir 375 certinho e a tela ainda estar quebrada: o
     * "R$ 12.345,67" do cartao de faturamento cabe na tela, mas nao cabe no
     * CARTAO — encosta na borda e some a virgula. `scrollWidth > clientWidth`
     * e o navegador dizendo exatamente isso.
     */
    var apertados = [];
    document.querySelectorAll('body *').forEach(function (el) {
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        var e = getComputedStyle(el);
        /* rolagem horizontal DE PROPOSITO (faixa de abas, carrossel) nao conta */
        if (e.overflowX === 'auto' || e.overflowX === 'scroll') return;
        /*
         * RETICENCIA NAO E DEFEITO. `truncate` (text-overflow: ellipsis) e a
         * decisao de cortar com "..." — o nome do produto no card e o exemplo.
         * Contar isso como quebra afogaria o laudo em falso positivo e
         * esconderia o que quebra de verdade.
         */
        if (e.textOverflow === 'ellipsis') return;
        /* Conteudo so para leitor de tela nao ocupa pixel nenhum na tela. */
        if (String(el.className || '').indexOf('sr-only') >= 0) return;
        apertados.push({
          tag: el.tagName.toLowerCase(),
          classe: String(el.className || '').slice(0, 90),
          texto: (el.textContent || '').trim().slice(0, 40),
          falta: el.scrollWidth - el.clientWidth,
        });
      }
    });

    return {
      limite: limite,
      rolagem: document.documentElement.scrollWidth,
      culpados: culpados.slice(0, 12),
      apertados: apertados.slice(0, 12),
    };
  };

  /*
   * A VARREDURA ANDA SOZINHA. Cada tela precisa de uma carga limpa (o erro de
   * uma envenena a proxima quando a navegacao e so do roteador), e a cada carga
   * este arquivo roda de novo — entao o estado da varredura mora no
   * `sessionStorage` e o passo seguinte dispara aqui dentro.
   *
   *   window.varrer(['/lojista', '/lojista/pedidos', ...])   inicia
   *   window.laudo()                                          le o resultado
   */
  window.varrer = function (rotas) {
    sessionStorage.setItem('lab:rotas', JSON.stringify(rotas));
    sessionStorage.setItem('lab:i', '0');
    sessionStorage.setItem('lab:laudo', '[]');
    location.href = rotas[0] + '?laboratorio=1';
  };

  window.laudo = function () {
    return JSON.parse(sessionStorage.getItem('lab:laudo') || '[]');
  };

  window.addEventListener('load', function () {
    var rotas = JSON.parse(sessionStorage.getItem('lab:rotas') || 'null');
    if (!rotas) return;
    var i = Number(sessionStorage.getItem('lab:i') || '0');
    if (i >= rotas.length) return;
    setTimeout(function () {
      var m = window.medirEstouro();
      var laudo = JSON.parse(sessionStorage.getItem('lab:laudo') || '[]');
      laudo.push({
        rota: rotas[i],
        rolagem: m.rolagem,
        erro: document.body.innerText.indexOf('algo deu errado') >= 0,
        culpados: (m.culpados || []).slice(0, 4).map(function (c) {
          return c.tag + ' +' + c.passa + 'px ' + c.classe.slice(0, 40) + ' "' + c.texto.slice(0, 18) + '"';
        }),
        apertados: (m.apertados || []).slice(0, 4).map(function (c) {
          return c.tag + ' falta ' + c.falta + 'px ' + c.classe.slice(0, 40) + ' "' + c.texto.slice(0, 18) + '"';
        }),
      });
      sessionStorage.setItem('lab:laudo', JSON.stringify(laudo));
      sessionStorage.setItem('lab:i', String(i + 1));
      if (i + 1 < rotas.length) location.href = rotas[i + 1] + '?laboratorio=1';
      else sessionStorage.removeItem('lab:rotas');
    }, 2200);
  });
})();
