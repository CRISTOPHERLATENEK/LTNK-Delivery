/**
 * Gestão de produtos do lojista — CRUD com upload de imagem, subcategoria e grupos de opções.
 */
import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckSquare, ChevronDown, Copy, FileText, GripVertical, Image as ImageIcon, Layers, ListPlus, Pencil, Plus, Rows3, Rows4, Search, Square, Star, ToggleLeft, ToggleRight, Trash2, UtensilsCrossed, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Falha } from '@/components/ui/estado';
import { Modal, ModalClose, ModalConteudo, ModalTitulo, ModalDescricao } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { ImageUpload } from '@/components/ui/image-upload';
import { promocaoVigente, hojeBrasilia } from '@/lib/preco-produto';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError } from '@/lib/api';
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';
import { gtinValido } from '@/lib/gtin';
import { erroPrecoPromocional, nomeJaUsado, eanJaUsado, outrosProdutos, sugestoesFaltantes, mesclarSugestoes, indiceDeSugestoes, type SugestaoSalva } from '@/lib/avisos-produto';
import type { Produto } from '@/types';

/* ─────────────────────── tipos ──────────────────────── */
const FORM_VAZIO = {
  nome: '', descricao: '', categoria: '', subcategoria: '',
  preco: '', preco_promocional: '', promo_fim: '', foto_url: '',
  disponivel: true, disponivel_pdv: true, destaque: false, serve_pessoas: '',
  vendido_por: 'un' as 'un' | 'kg', codigo_barras: '',
  controla_estoque: false, estoque: '',
  // Dados fiscais (NFC-e) — mesmos valores padrão usados pelo backend ao
  // criar um produto (garantirColuna em db.ts), pra não sobrescrever com
  // vazio quando o lojista não mexe nessa seção.
  ncm: '21069090', cfop: '5102', csosn: '102', origem: '0', unidade_comercial: 'UN', cest: '',
};
type FormProduto = typeof FORM_VAZIO;

const CHAVE_DENSIDADE = 'lojista:produtos:densidade';
type Densidade = 'confortavel' | 'compacta';

/** Vende em algum canal? É o que o interruptor da lista liga e desliga. */
function ehVendido(p: { disponivel?: number | null; disponivel_pdv?: number | null }): boolean {
  return !!p.disponivel || !!p.disponivel_pdv;
}

/**
 * Rótulo do estado de venda. Com dois canais, "À venda"/"Pausado" deixou de
 * bastar: um item vendido só no balcão apareceria como "Pausado", o que é
 * mentira — e o lojista iria procurar o problema onde não estava.
 */
function rotuloVenda(p: { disponivel?: number | null; disponivel_pdv?: number | null }): string {
  if (p.disponivel && p.disponivel_pdv) return 'À venda';
  if (p.disponivel) return 'Só cardápio';
  if (p.disponivel_pdv) return 'Só PDV';
  return 'Pausado';
}

/*
 * Tipos LOCAIS, e não os de `@/types`, de propósito.
 *
 * O nome é o mesmo do tipo compartilhado, mas o shape é outro: a rota do
 * lojista devolve a linha inteira (grupo_id, disponivel, ordem — o que a tela
 * de edição precisa), e a rota pública devolve a versão enxuta que o cliente
 * consome. Unificar obrigaria um dos dois a carregar campos que não usa.
 *
 * O que TEM que andar junto nos dois: os campos de que a regra de preço
 * depende (`sabores`, `secao`, `papel`, `modo_preco`) — ver opcoes-preco.ts.
 */
interface OpcaoItem {
  id: number;
  grupo_id: number;
  nome: string;
  preco_adicional_centavos: number;
  /** Quantos sabores esta opção libera (só no grupo de tamanho). */
  sabores?: number;
  /** Faixa dentro do grupo ('Tradicionais', 'Especiais'…). Vazio = sem seção. */
  secao?: string | null;
  /** Ingredientes, mostrados embaixo do nome pro cliente. */
  descricao?: string | null;
  /** Foto do sabor (URL). Vazio = sem foto. */
  imagem?: string | null;
  disponivel: number;
  ordem: number;
}

interface GrupoOpcoes {
  id: number;
  produto_id: number;
  nome: string;
  /** 'tamanho' libera N sabores; 'sabores' herda esse limite. */
  papel?: string;
  /** 'maior' cobra só o acréscimo mais caro do grupo. */
  modo_preco?: string;
  tipo: 'unico' | 'multiplo';
  obrigatorio: number;
  max_escolhas: number;
  ordem: number;
  opcoes: OpcaoItem[];
}

/* Sugestões de opções por tipo de grupo */
const SUGESTOES: Record<string, string[]> = {
  'Adicionais':     ['Bacon', 'Queijo extra', 'Ovo', 'Molho especial', 'Cebola caramelizada', 'Pão extra'],
  'Tamanho':        ['Pequeno', 'Médio', 'Grande', 'GG', 'Família'],
  'Borda':          ['Sem borda', 'Catupiry', 'Cheddar', 'Chocolate', 'Cream cheese'],
  'Ponto da carne': ['Mal passado', 'Ao ponto', 'Bem passado'],
  'Sabores':        ['Chocolate', 'Morango', 'Creme', 'Napolitano', 'Maracujá', 'Misto'],
  'Bebida':         ['Coca-Cola', 'Coca Zero', 'Guaraná', 'Suco de laranja', 'Água', 'Suco de uva'],
};

/**
 * Famílias de produto usadas pra filtrar os modelos.
 *
 * As categorias são texto livre por loja ("Bebidas", "Bebidas geladas",
 * "Refrigerantes"), então não dá pra casar por igualdade — o casamento é por
 * palavra dentro do nome, que é o que sobrevive à criatividade de cada lojista.
 */
type Familia = 'bebida' | 'pizza' | 'lanche' | 'sobremesa' | 'prato';

const FAMILIAS: { chave: Familia; termos: RegExp }[] = [
  { chave: 'bebida',    termos: /bebida|drink|suco|refri|cerveja|chopp|vinho|caf[eé]|ch[aá]s?\b|[aá]gua|energ[eé]tic/i },
  { chave: 'pizza',     termos: /pizza|esfi|calzone|brotinho/i },
  { chave: 'sobremesa', termos: /sobremesa|doce|a[çc]a[íi]|sorvete|milk|gelato|bolo|torta|pudim/i },
  { chave: 'lanche',    termos: /lanche|burg|hamb[uú]|sandu|hot ?dog|cachorro|x-|bauru|wrap|p[aã]o/i },
  { chave: 'prato',     termos: /prato|refei[çc]|marmit|executiv|almo[çc]|jantar|churrasc|carne|grelhad|massa|risoto|por[çc][aã]o/i },
];

/** Família da categoria, ou `null` quando não dá pra afirmar nada. */
function familiaDaCategoria(categoria: string | null | undefined): Familia | null {
  const nome = (categoria || '').trim();
  if (!nome) return null;
  return FAMILIAS.find(f => f.termos.test(nome))?.chave ?? null;
}

interface Modelo {
  nome: string; dica: string;
  tipo: 'unico' | 'multiplo'; obrigatorio: boolean; max_escolhas: number;
  /**
   * O papel do grupo no mecanismo de pizza — e o motivo de existir aqui.
   *
   * O template criava o grupo SEM papel, então o vínculo tamanho → nº de sabores
   * nunca ligava: o lojista escolhia "Sabores", ganhava um grupo comum e a
   * pizza de 2 e 3 sabores simplesmente não existia até ele editar o grupo à mão
   * e marcar o papel — coisa que ninguém descobre sozinho.
   */
  papel?: 'tamanho' | 'sabores';
  /** 'maior' cobra só o acréscimo mais caro; vazio = somar (padrão do mercado). */
  modo_preco?: 'maior' | 'proporcional';
  /** Onde este modelo faz sentido. Vazio = em qualquer categoria. */
  familias: Familia[];
}

/* Templates prontos para criação rápida de grupos */
const TEMPLATES: Modelo[] = [
  { nome: 'Adicionais', dica: 'Bacon, queijo extra, molhos…', tipo: 'multiplo', obrigatorio: false, max_escolhas: 0, familias: ['lanche', 'pizza', 'prato', 'sobremesa'] },
  { nome: 'Tamanho', dica: 'P, M, G, GG, Família…', tipo: 'unico', obrigatorio: true, max_escolhas: 1, papel: 'tamanho', familias: [] },
  { nome: 'Borda', dica: 'Catupiry, cheddar, sem borda…', tipo: 'unico', obrigatorio: false, max_escolhas: 1, familias: ['pizza'] },
  { nome: 'Ponto da carne', dica: 'Mal passado, ao ponto…', tipo: 'unico', obrigatorio: true, max_escolhas: 1, familias: ['lanche', 'prato'] },
  /*
   * MÚLTIPLO, não único. Era 'unico' com max_escolhas 1 — um grupo de sabores
   * que aceita um sabor só, o que anula o recurso inteiro. Com `papel:
   * 'sabores'`, o limite passa a vir do TAMANHO escolhido e o max_escolhas aqui
   * é só o teto de quem não configurou tamanho nenhum.
   */
  { nome: 'Sabores', dica: 'Calabresa, 4 queijos, doces…', tipo: 'multiplo', obrigatorio: true, max_escolhas: 1, papel: 'sabores', familias: ['pizza', 'sobremesa', 'bebida'] },
  { nome: 'Bebida', dica: 'Coca, Suco, Água…', tipo: 'unico', obrigatorio: false, max_escolhas: 1, familias: ['lanche', 'pizza', 'prato'] },
];

/**
 * Modelos que fazem sentido para a categoria do produto.
 *
 * Oferecer "Ponto da carne" numa Coca-Cola não é só feio: cada modelo errado é
 * um clique acidental que vira um grupo esquisito no cardápio do cliente. Quando
 * a categoria não diz nada (vazia ou nome que não reconhecemos), mostra TUDO —
 * esconder por palpite seria pior que mostrar demais.
 */
function modelosDaCategoria(categoria: string | null | undefined): Modelo[] {
  const fam = familiaDaCategoria(categoria);
  if (!fam) return TEMPLATES;
  return TEMPLATES.filter(t => t.familias.length === 0 || t.familias.includes(fam));
}

/** "Obrigatório · escolha 1" / "Opcional · até 3" — a regra em palavras do lojista. */
function rotuloRegra(obrigatorio: boolean, tipo: 'unico' | 'multiplo', maxEscolhas: number): string {
  if (obrigatorio) return tipo === 'unico' ? 'Obrigatório · escolha 1' : `Obrigatório · até ${maxEscolhas || '∞'}`;
  if (tipo === 'unico') return 'Opcional · escolha 1';
  return maxEscolhas > 0 ? `Opcional · até ${maxEscolhas}` : 'Opcional · quantos quiser';
}
const regraDoModelo = (t: Modelo) => rotuloRegra(t.obrigatorio, t.tipo, t.max_escolhas);
const regraDoGrupo = (g: GrupoOpcoes) => rotuloRegra(!!g.obrigatorio, g.tipo, g.max_escolhas);

/** "Bacon +R$ 4 · Queijo extra +R$ 3" — o conteúdo do grupo sem precisar abri-lo. */
function resumoDosItens(g: GrupoOpcoes): string {
  if (g.opcoes.length === 0) return 'Nenhum item ainda — clique em "Editar itens"';
  return g.opcoes
    .map(o => o.preco_adicional_centavos > 0 ? `${o.nome} +${brl(o.preco_adicional_centavos)}` : o.nome)
    .join(' · ');
}

/* ─────────────────────── componente principal ──────────────────────── */
export function ProdutosLoja() {
  const [editando, setEditando] = useState<number | 'novo' | null>(null);
  const [form, setForm] = useState<FormProduto>(FORM_VAZIO);
  const [enviando, setEnviando] = useState(false);
  const [busca, setBusca] = useState('');
  /** Chip de categoria da toolbar. '' = todas. */
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [gerindoGrupos, setGerindoGrupos] = useState<Produto | null>(null);
  const [mostrarFiscal, setMostrarFiscal] = useState(false);
  type Aba = 'item' | 'complementos' | 'config' | 'fiscal';
  const [aba, setAba] = useState<Aba>('item');

  /** Qual dos dois botões de submit foi clicado (ver `salvar`). */
  const criarOutroRef = useRef(false);
  const [modoSelecao, setModoSelecao] = useState(false);
  const [densidade, setDensidade] = useState<Densidade>(
    () => (localStorage.getItem(CHAVE_DENSIDADE) as Densidade) || 'confortavel',
  );
  function alternarDensidade() {
    setDensidade(d => {
      const novo = d === 'confortavel' ? 'compacta' : 'confortavel';
      localStorage.setItem(CHAVE_DENSIDADE, novo);
      return novo;
    });
  }
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [aplicandoAcao, setAplicandoAcao] = useState(false);
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();

  const consulta = useQuery({
    queryKey: ['lojista-produtos'],
    queryFn: () => api<{ produtos: Produto[] }>('GET', '/api/lojista/produtos').then(r => r.produtos),
  });
  /*
   * GRUPOS DO PRODUTO ABERTO, pra mostrar dentro do cadastro.
   *
   * `enabled` só quando há id: em produto NOVO não existe o que consultar — o
   * grupo é vinculado a um produto, e ele ainda não foi criado. Sem esse guarda,
   * a tela dispararia uma requisição pra /produtos/novo/grupos a cada abertura.
   *
   * Mesma queryKey que o editor de complementos usa, então voltar dele já traz a
   * lista atualizada sem recarregar o formulário.
   */
  const grupoIdEmEdicao = typeof editando === 'number' ? editando : null;
  /*
   * O GruposModal recebe o Produto, não o id — e a fonte é a lista já carregada,
   * não o formulário: o form guarda rascunho (pode ter nome alterado e não
   * salvo), e passar rascunho pro editor faria o cabeçalho dele mostrar um nome
   * que ainda não existe no banco.
   */
  const produtoEmEdicao = grupoIdEmEdicao === null
    ? null
    : (consulta.data ?? []).find(p => p.id === grupoIdEmEdicao) ?? null;
  const gruposDoProduto = useQuery({
    queryKey: ['lojista-grupos', grupoIdEmEdicao],
    queryFn: () => api<{ grupos: GrupoOpcoes[] }>('GET', `/api/lojista/produtos/${grupoIdEmEdicao}/grupos`)
      .then(r => r.grupos),
    enabled: grupoIdEmEdicao !== null,
  });

  /*
   * AVISOS CALCULADOS NA HORA, sem ida ao servidor.
   *
   * O backend é a autoridade e continua validando tudo — mas descobrir que o
   * preço promocional está maior que o normal só DEPOIS de enviar, com o modal
   * inteiro preenchido, é atrito puro.
   *
   * A regra mora em lib/avisos-produto.ts, com teste: escrita aqui dentro do
   * componente, ela só era verificável abrindo o modal na mão — e a primeira
   * versão que eu escrevi assim esquecia o promocional zero ou negativo.
   */
  const outros = outrosProdutos(consulta.data, editando);
  const erroPromo = erroPrecoPromocional(form.preco, form.preco_promocional);
  const nomeRepetido = nomeJaUsado(form.nome, outros);
  const eanRepetido = eanJaUsado(form.codigo_barras, outros);

  function abrirNovo() {
    setAba('item');
    setForm(FORM_VAZIO);
    setEditando('novo');
    setTimeout(() => document.getElementById('campo-nome')?.focus(), 50);
  }

  function abrirEdicao(p: Produto) {
    setAba('item');
    setForm({
      nome: p.nome,
      descricao: p.descricao || '',
      categoria: p.categoria || '',
      subcategoria: p.subcategoria || '',
      preco: String((p.preco_centavos / 100).toFixed(2)),
      preco_promocional: p.preco_promocional_centavos
        ? String((p.preco_promocional_centavos / 100).toFixed(2)) : '',
      promo_fim: p.promo_fim || '',
      foto_url: p.foto_url || '',
      disponivel: !!p.disponivel,
      disponivel_pdv: !!p.disponivel_pdv,
      destaque: !!p.destaque,
      serve_pessoas: p.serve_pessoas ? String(p.serve_pessoas) : '',
      vendido_por: p.vendido_por === 'kg' ? 'kg' : 'un',
      codigo_barras: p.codigo_barras || '',
      controla_estoque: !!p.controla_estoque,
      estoque: p.controla_estoque ? String(p.estoque ?? 0) : '',
      ncm: p.ncm || '21069090',
      cfop: p.cfop || '5102',
      csosn: p.csosn || '102',
      origem: p.origem || '0',
      unidade_comercial: p.unidade_comercial || 'UN',
      cest: p.cest || '',
    });
    setEditando(p.id);
    setTimeout(() => document.getElementById('campo-nome')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function set<K extends keyof FormProduto>(k: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    /*
     * LEVA DE VOLTA PRA ABA DO PROBLEMA.
     *
     * Com abas, o `required` do HTML deixa de bastar: um campo obrigatório numa
     * aba desmontada não existe no DOM, então o navegador não bloqueia nem
     * aponta nada — o pedido iria ao servidor e voltaria um toast sem dizer ONDE
     * corrigir. Aqui o erro reabre a aba certa e foca o campo.
     */
    if (!form.nome.trim() || !form.preco || erroPromo) {
      setAba('item');
      setTimeout(() => document.getElementById(!form.nome.trim() ? 'campo-nome' : 'p-preco')?.focus(), 60);
      return;
    }
    setEnviando(true);
    const corpo = {
      nome: form.nome,
      descricao: form.descricao,
      categoria: form.categoria || 'Geral',
      subcategoria: form.subcategoria,
      // Input type="number" produz ponto decimal ("39.90"); enviar como número
      // evita que o backend interprete o ponto como separador de milhar.
      preco: form.preco === '' ? 0 : Number(form.preco),
      preco_promocional: form.preco_promocional ? Number(form.preco_promocional) : undefined,
      promo_fim: form.promo_fim,
      foto_url: form.foto_url,
      disponivel: form.disponivel,
      disponivel_pdv: form.disponivel_pdv,
      destaque: form.destaque,
      serve_pessoas: form.serve_pessoas ? Number(form.serve_pessoas) : undefined,
      vendido_por: form.vendido_por,
      codigo_barras: form.codigo_barras,
      controla_estoque: form.controla_estoque,
      estoque: form.controla_estoque ? (form.estoque === '' ? 0 : Number(form.estoque)) : 0,
    };
    const corpoFiscal = {
      ncm: form.ncm, cfop: form.cfop, csosn: form.csosn,
      origem: form.origem, unidade_comercial: form.unidade_comercial, cest: form.cest,
    };
    try {
      let produtoId: number;
      if (editando === 'novo') {
        const r = await api<{ produto_id: number }>('POST', '/api/lojista/produtos', corpo);
        produtoId = r.produto_id;
        mostrar({ tipo: 'sucesso', titulo: 'Produto criado!' });
      } else {
        produtoId = editando!;
        await api('PUT', `/api/lojista/produtos/${editando}`, corpo);
        mostrar({ tipo: 'sucesso', titulo: 'Produto atualizado!' });
      }
      // Dados fiscais salvos junto — endpoint próprio (compartilhado com a
      // tela Fiscal), mas agora o lojista não precisa sair do cadastro do
      // produto pra preencher isso.
      await api('PUT', `/api/lojista/fiscal/produtos/${produtoId}`, corpoFiscal).catch(() => {});
      qc.invalidateQueries({ queryKey: ['lojista-produtos'] });
      /*
       * "Salvar e criar outro" reabre o formulário LIMPO em vez de fechar.
       *
       * `ref` e não estado: o clique no botão precisa registrar a intenção ANTES do
       * submit disparar, e um `setState` só valeria no render seguinte — o `salvar`
       * leria o valor velho e fecharia o drawer. Cadastro de cardápio é trabalho em
       * lote (30 itens numa sentada), e reabrir o drawer a cada um dobra os cliques.
       *
       * A CATEGORIA É PRESERVADA de propósito: quem cadastra em lote está numa
       * categoria só ("Bebidas" inteira de uma vez), e zerá-la obrigaria a reescolher
       * a cada item.
       */
      if (criarOutroRef.current) {
        criarOutroRef.current = false;
        setForm({ ...FORM_VAZIO, categoria: form.categoria, subcategoria: form.subcategoria });
        setEditando('novo');
        setMostrarFiscal(false);
        setTimeout(() => document.getElementById('campo-nome')?.focus(), 50);
      } else {
        setEditando(null);
      }
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  async function duplicar(p: Produto) {
    try {
      await api('POST', `/api/lojista/produtos/${p.id}/duplicar`);
      mostrar({ tipo: 'sucesso', titulo: `"${p.nome}" duplicado!`, descricao: 'A cópia nasce indisponível — revise e ative quando estiver pronta.' });
      qc.invalidateQueries({ queryKey: ['lojista-produtos'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function excluir(id: number, nome: string) {
    if (!(await confirmar({ titulo: `Remover "${nome}"?`, confirmar: 'Remover', destrutivo: true }))) return;
    try {
      await api('DELETE', `/api/lojista/produtos/${id}`);
      mostrar({ tipo: 'sucesso', titulo: 'Produto removido.' });
      qc.invalidateQueries({ queryKey: ['lojista-produtos'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function alternarDisponivel(p: Produto) {
    try {
      /*
        O interruptor da LISTA é "pausar/voltar a vender", e vale pros dois
        canais. Separar cardápio de PDV é decisão item a item, e se faz no
        editor — aqui, um item pausado no cardápio mas vendendo no balcão
        viraria um estado que o interruptor não consegue nem representar.
      */
      const ligar = !ehVendido(p);
      await api('PUT', `/api/lojista/produtos/${p.id}`, { disponivel: ligar, disponivel_pdv: ligar });
      qc.invalidateQueries({ queryKey: ['lojista-produtos'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  function alternarSelecao(id: number) {
    setSelecionados(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function sairDaSelecao() {
    setModoSelecao(false);
    setSelecionados(new Set());
  }

  async function aplicarAcaoEmMassa(acao: 'ativar' | 'desativar' | 'excluir') {
    if (selecionados.size === 0) return;
    if (acao === 'excluir') {
      const ok = await confirmar({
        titulo: `Excluir ${selecionados.size} produto(s)?`,
        descricao: 'Esta ação não pode ser desfeita.',
        confirmar: 'Excluir', destrutivo: true,
      });
      if (!ok) return;
    }
    setAplicandoAcao(true);
    try {
      const r = await api<{ afetados: number }>('POST', '/api/lojista/produtos/bulk', { ids: [...selecionados], acao });
      mostrar({
        tipo: 'sucesso',
        titulo: acao === 'ativar' ? `${r.afetados} produto(s) ativado(s).`
          : acao === 'desativar' ? `${r.afetados} produto(s) desativado(s).`
          : `${r.afetados} produto(s) excluído(s).`,
      });
      sairDaSelecao();
      qc.invalidateQueries({ queryKey: ['lojista-produtos'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setAplicandoAcao(false);
    }
  }

  const todos = consulta.data ?? [];
  /*
   * Busca também no CÓDIGO DE BARRAS: é o que o placeholder promete, e é como se acha
   * um item bipando o produto em vez de lembrar como ele foi escrito. Sem isso o campo
   * dizia "ou código de barras" e não achava nada por código.
   */
  const termo = busca.trim().toLowerCase();
  const filtrados = todos.filter(p => {
    if (filtroCategoria && (p.categoria || 'Geral') !== filtroCategoria) return false;
    if (!termo) return true;
    return p.nome.toLowerCase().includes(termo)
      || (p.categoria || '').toLowerCase().includes(termo)
      || (p.codigo_barras || '').includes(termo);
  });

  const porCategoria = filtrados.reduce<Record<string, Record<string, Produto[]>>>((acc, p) => {
    const cat = p.categoria || 'Geral';
    const sub = p.subcategoria || '';
    if (!acc[cat]) acc[cat] = {};
    if (!acc[cat][sub]) acc[cat][sub] = [];
    acc[cat][sub].push(p);
    return acc;
  }, {});

  const disponiveis = todos.filter(ehVendido).length;

  const categoriasExistentes = [...new Set(todos.map(p => p.categoria).filter(Boolean))].sort() as string[];
  const subcategoriasDaCategoria = [...new Set(
    todos
      .filter(p => !form.categoria || p.categoria === form.categoria)
      .map(p => p.subcategoria)
      .filter(Boolean)
  )].sort() as string[];

  return (
    /*
     * PALETA DA ESPECIFICAÇÃO TRADUZIDA PARA TOKENS, não cravada em hexadecimal.
     *
     * A especificação pedia `#F6F5F3` de fundo, `#1C1917` de título, `#78716C` de
     * secundário, `#E7E5E1` de filete. Cravar isso deixaria a tela CERTA no tema claro
     * e QUEBRADA no escuro (este app tem alternador de tema): um retângulo off-white
     * com texto quase preto no meio de uma interface escura.
     *
     * O mapeamento é direto e preserva a intenção:
     *   #F6F5F3 fundo      → `bg-muted/40`      (off-white quente no claro, escuro no escuro)
     *   #1C1917 título     → `text-foreground`
     *   #78716C secundário → `text-muted-foreground`
     *   #A8A29E terciário  → `text-muted-foreground/70`
     *   #E7E5E1 filete     → `border-border`
     *   chip ativo preto   → `bg-foreground text-background`  (inverte junto, sem virar
     *                        branco-no-branco no tema escuro)
     *
     * Ficam FIXOS só o âmbar do "Destaque" e o verde de promoção/"à venda": são cores
     * SEMÂNTICAS, não de marca — igual aos vermelhos/verdes do KDS. Seguindo o tema,
     * uma loja de paleta verde perderia a distinção entre promoção e o resto.
     */
    <div className="-mx-4 -my-4 min-h-full bg-muted/40 px-4 py-6 sm:-mx-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1160px] space-y-5">
        {/* Modal de grupos de opções — sobrepõe tudo */}
        {gerindoGrupos && (
          <GruposEditor produto={gerindoGrupos} onFechar={() => setGerindoGrupos(null)} />
        )}

        {/* ─────────── Header ─────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[28px] font-extrabold leading-none tracking-[-0.03em]">Produtos</h2>
            {todos.length > 0 && (
              <p className="mt-2 text-[13.5px] text-muted-foreground">
                {todos.length} {todos.length === 1 ? 'item' : 'itens'} no cardápio
                {' · '}
                {/* Verde fixo: "quantos estão vendendo" é a informação que o lojista
                    procura primeiro, e verde é a convenção pra isso em qualquer marca. */}
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  {disponiveis} à venda
                </span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {todos.length > 3 && (
              <Button
                variant="outline"
                onClick={alternarDensidade}
                className="h-11 rounded-[11px] shadow-sm"
                title={densidade === 'confortavel' ? 'Mais colunas por linha' : 'Cards maiores'}
              >
                {densidade === 'confortavel' ? <Rows4 className="size-4" /> : <Rows3 className="size-4" />}
              </Button>
            )}
            {todos.length > 0 && (
              modoSelecao ? (
                <Button variant="outline" onClick={sairDaSelecao} className="h-11 rounded-[11px] shadow-sm">
                  <X className="size-4" /> Cancelar
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setModoSelecao(true)}
                  disabled={editando !== null}
                  className="h-11 rounded-[11px] shadow-sm"
                >
                  <CheckSquare className="size-4" /> Selecionar
                </Button>
              )
            )}
            {/* Sombra na cor da marca só aqui: é a ação principal da tela, e é o único
                lugar (com os interruptores e o anel de foco) onde a cor entra. */}
            <Button
              onClick={abrirNovo}
              disabled={editando !== null || modoSelecao}
              className="h-11 rounded-[11px] shadow-[0_10px_24px_-12px] shadow-primary/65"
            >
              <Plus className="size-4" /> Novo produto
            </Button>
          </div>
        </div>

        {/* Barra flutuante de ações em massa */}
        {modoSelecao && selecionados.size > 0 && (
          <div className="sticky top-2 z-20 flex items-center gap-2 rounded-2xl border border-primary/30 bg-card px-4 py-2.5 shadow-lg">
            <span className="shrink-0 text-sm font-bold">{selecionados.size} selecionado{selecionados.size > 1 ? 's' : ''}</span>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
              <Button size="sm" variant="outline" disabled={aplicandoAcao} onClick={() => aplicarAcaoEmMassa('ativar')}>
                <ToggleRight className="size-4" /> Ativar
              </Button>
              <Button size="sm" variant="outline" disabled={aplicandoAcao} onClick={() => aplicarAcaoEmMassa('desativar')}>
                <ToggleLeft className="size-4" /> Pausar
              </Button>
              <Button size="sm" variant="outline" disabled={aplicandoAcao} onClick={() => aplicarAcaoEmMassa('excluir')}
                className="text-destructive hover:text-destructive">
                <Trash2 className="size-4" /> Excluir
              </Button>
            </div>
          </div>
        )}

        {/* ─────────── Toolbar ─────────── */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por nome, categoria ou código de barras"
              className="h-12 rounded-xl border-border bg-card pl-11 text-[15px] shadow-sm focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/[0.13] focus-visible:ring-offset-0"
            />
          </div>

          {/*
            CHIP ATIVO EM PRETO, não na cor da marca. Com o laranja, o filtro
            selecionado disputava atenção com o botão "Novo produto" — dois elementos
            laranja na mesma dobra, e nenhum lendo como "o principal". Preto marca a
            seleção sem competir. (`bg-foreground` inverte no tema escuro.)
          */}
          {categoriasExistentes.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {['', ...categoriasExistentes].map(cat => {
                const ativo = filtroCategoria === cat;
                return (
                  <button
                    key={cat || '__todas'}
                    type="button"
                    onClick={() => setFiltroCategoria(cat)}
                    className={cn(
                      'h-[38px] rounded-full px-4 text-[13.5px] font-semibold transition-colors',
                      ativo
                        ? 'bg-foreground text-background'
                        : 'border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    {cat || 'Todas'}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/*
          CADASTRO EM MODAL CENTRADO DE DUAS COLUNAS.
          Antes era um card que se expandia NO MEIO DA LISTA, e o botão de salvar descia
          junto com o formulário — num cadastro longo ele saía da tela justo na hora de
          usar. Aqui o footer é fixo e o corpo rola por dentro.

          DUAS COLUNAS porque os campos se dividem em dois assuntos que não se leem em
          sequência: o que a foto mostra e o que o produto É. Empilhados, a foto empurra
          todo o resto pra baixo da dobra.

          Coluna esquerda = foto + interruptores de estado (as decisões de "aparece ou
          não"); direita = os dados que descrevem e precificam.
        */}
        <Modal open={editando !== null} onOpenChange={aberto => { if (!aberto) setEditando(null); }}>
          <ModalConteudo>
            {/* ─── Header fixo ─── */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-[22px] sm:px-8">
              <div className="min-w-0">
                <ModalTitulo className="text-[21px] font-extrabold leading-tight tracking-tight">
                  {editando === 'novo' ? 'Novo produto' : 'Editar produto'}
                </ModalTitulo>
                <ModalDescricao className="mt-0.5 truncate text-[13.5px] text-muted-foreground">
                  {editando === 'novo'
                    ? 'Preencha os dados e salve para publicar no cardápio.'
                    : [form.nome, form.categoria].filter(Boolean).join(' · ') || 'Produto'}
                </ModalDescricao>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {/*
                  Estado no HEADER e não no meio do formulário: é a informação que decide
                  se o cliente vê o produto, e no meio da lista de campos ela se perde. O
                  verde é a única cor fixa aqui — status "ok" em verde é convenção que
                  atravessa qualquer paleta de marca.
                */}
                <span className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-bold',
                  form.disponivel
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-900 dark:bg-emerald-950'
                    : 'border-border bg-muted text-muted-foreground',
                )}>
                  <span className={cn('size-1.5 rounded-full', form.disponivel ? 'bg-emerald-500' : 'bg-muted-foreground')} />
                  {form.disponivel ? 'À venda' : 'Pausado'}
                </span>
                <ModalClose
                  aria-label="Fechar"
                  className="flex size-[38px] items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="size-[18px]" />
                </ModalClose>
              </div>
            </div>

            <form onSubmit={salvar} className="flex min-h-0 flex-1 flex-col">
              {/*
                ─── ABAS ───

                O formulário tinha tudo numa rolagem só: no celular, chegar no
                fiscal exigia passar por foto, prévia, disponibilidade, nome,
                preço e complementos. As abas dão endereço a cada assunto.

                A ORDEM É A DO TRABALHO: primeiro o que o cliente vê (Item),
                depois o que ele escolhe (Complementos), depois como o item se
                comporta (Configurações) e por último o fiscal — que a maioria
                nunca abre.

                TODO CAMPO OBRIGATÓRIO VIVE NA ABA "ITEM". É o que impede o pior
                defeito de formulário com abas: erro de validação numa aba
                escondida, com o botão recusando salvar sem dizer onde está o
                problema. E `salvar` volta pra "Item" quando falta nome ou preço.
              */}
              <div className="shrink-0 border-b border-border px-6 sm:px-8">
                <div className="scrollbar-hide -mb-px flex gap-1 overflow-x-auto">
                  {([
                    ['item', 'Item'],
                    ['complementos', 'Complementos'],
                    ['config', 'Configurações'],
                    ['fiscal', 'Fiscal'],
                  ] as const).map(([id, rotulo]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setAba(id);
                        /*
                         * A aba Fiscal abre já expandida: o bloco nasceu
                         * colapsável quando dividia espaço com o resto do
                         * formulário, e numa aba dedicada exigir um clique pra
                         * ver o conteúdo é passo sem função.
                         *
                         * Aqui e não num `useEffect`: setState dentro de efeito
                         * dispara render em cascata, e a informação já está no
                         * próprio evento.
                         */
                        if (id === 'fiscal') setMostrarFiscal(true);
                      }}
                      aria-current={aba === id ? 'page' : undefined}
                      className={cn(
                        'shrink-0 border-b-2 px-3.5 py-3 text-[13.5px] font-semibold transition-colors',
                        aba === id
                          ? 'border-primary text-foreground'
                          : 'border-transparent text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {rotulo}
                      {/* Contagem só em Complementos: é a única aba cujo conteúdo
                          o lojista não vê de outro jeito sem entrar nela. */}
                      {id === 'complementos' && (gruposDoProduto.data ?? []).length > 0 && (
                        <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-bold">
                          {(gruposDoProduto.data ?? []).length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* ─── Item: duas colunas, rolagem por dentro ─── */}
              {aba === 'item' && (
              <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[320px_1fr] lg:overflow-hidden">
                {/* ── Esquerda: foto + disponibilidade ── */}
                <div className="border-b border-border px-6 py-7 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-8 lg:py-8">
                  <RotuloSecao>Foto</RotuloSecao>
                  {/*
                    256px e não miniatura: a foto é o assunto desta coluna, e em 96px não
                    dá pra julgar se o recorte ficou bom. No celular volta pra pequena —
                    ali a tela é o recurso escasso. (`square-lg` em image-upload.tsx.)
                  */}
                  <div className="hidden lg:block">
                    <ImageUpload
                      value={form.foto_url}
                      onChange={url => setForm(f => ({ ...f, foto_url: url }))}
                      aspectRatio="square-lg"
                    />
                  </div>
                  <div className="lg:hidden">
                    <ImageUpload
                      value={form.foto_url}
                      onChange={url => setForm(f => ({ ...f, foto_url: url }))}
                      aspectRatio="square"
                    />
                  </div>
                  <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
                    Quadrada, mínimo 500×500. É assim que ela aparece no cardápio e no PDV.
                  </p>

                  <div className="my-7 h-px bg-border" />

                  {/*
                    COMO O CLIENTE VÊ — prévia do card do cardápio.

                    O lojista escrevia nome e descrição num formulário e só
                    descobria o resultado abrindo o app. Aqui ele vê o corte da
                    descrição, o preço riscado e o selo de pausado enquanto
                    digita — o mesmo recurso da prévia do cupom fiscal, que já
                    existe no agente de impressão pelo mesmo motivo.

                    NADA CLICÁVEL DENTRO: é visualização, não campo. O fundo
                    `bg-muted/40` é o que diz isso sem precisar de aviso.
                  */}
                  <RotuloSecao>Como o cliente vê</RotuloSecao>
                  <div className="rounded-xl border border-border bg-muted/40 p-3">
                    <div className={cn('flex gap-3 rounded-xl border border-border bg-card p-2.5',
                      !ehVendido({ disponivel: form.disponivel ? 1 : 0, disponivel_pdv: form.disponivel_pdv ? 1 : 0 }) && 'opacity-55')}>
                      {form.foto_url ? (
                        <img src={form.foto_url} alt="" className="size-16 shrink-0 rounded-[10px] object-cover" />
                      ) : (
                        <div className="flex size-16 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground">
                          <ImageIcon className="size-5" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-1.5">
                          <span className={cn('flex-1 text-[13.5px] font-bold leading-snug',
                            !form.nome.trim() && 'text-muted-foreground/60')}>
                            {form.nome.trim() || 'Nome do produto'}
                          </span>
                          {form.destaque && (
                            <span className="shrink-0 rounded-md border border-[#F1E3C4] bg-[#FBF3E4] px-1.5 py-0.5 text-[10px] font-bold text-[#92610A] dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                              Destaque
                            </span>
                          )}
                          {!ehVendido({ disponivel: form.disponivel ? 1 : 0, disponivel_pdv: form.disponivel_pdv ? 1 : 0 }) && (
                            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                              Pausado
                            </span>
                          )}
                        </div>
                        <p className={cn('mt-0.5 line-clamp-2 text-xs leading-snug',
                          form.descricao.trim() ? 'text-muted-foreground' : 'text-muted-foreground/60')}>
                          {form.descricao.trim() || 'Sem descrição'}
                        </p>
                        <div className="mt-1 flex items-baseline gap-1.5">
                          <span className={cn('text-[13.5px] font-extrabold tabular-nums',
                            !form.preco && 'text-muted-foreground/60')}>
                            {form.preco ? brl(Math.round(Number(form.preco) * 100) || 0) : 'R$ 0,00'}
                          </span>
                          {/* Riscado só quando a promoção é válida: mostrar o "de" com
                              promocional maior que o preço seria prometer desconto que
                              o backend recusa. */}
                          {form.preco_promocional && !erroPromo && (
                            <span className="text-[11.5px] text-muted-foreground line-through tabular-nums">
                              {brl(Math.round(Number(form.preco) * 100) || 0)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {form.descricao.trim().length > 140 && (
                      <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                        A descrição será cortada no cardápio.
                      </p>
                    )}
                  </div>

                </div>

                {/* ── Direita: dados do produto ── */}
                <div className="px-6 py-7 lg:overflow-y-auto lg:px-9 lg:py-8">
                  <section>
                    <RotuloSecao>Produto</RotuloSecao>
                    <div>
                      <Label htmlFor="campo-nome">Nome *</Label>
                      <Input
                        id="campo-nome"
                        required
                        value={form.nome}
                        onChange={set('nome')}
                        placeholder="Ex.: X-Burguer Especial"
                        className={CAMPO_MODAL}
                      />
                      {nomeRepetido && (
                        <p role="status" className="mt-1 text-[12.5px] text-amber-700 dark:text-amber-400">
                          Já existe um produto chamado “{nomeRepetido}”. Pode salvar, mas no app os dois vão
                          aparecer com o mesmo nome.
                        </p>
                      )}
                    </div>
                    <div className="mt-4">
                      <Label htmlFor="p-descricao">
                        Descrição
                        <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>
                      </Label>
                      <textarea
                        id="p-descricao"
                        value={form.descricao}
                        onChange={set('descricao')}
                        rows={2}
                        placeholder="Ingredientes, tamanho, detalhes que ajudam o cliente a escolher…"
                        className="mt-1.5 w-full resize-none rounded-[10px] border border-input bg-background px-3.5 py-2.5 text-[15.5px] transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/[0.14]"
                      />
                    </div>
                    <div className="mt-4 space-y-4">
                      <SeletorChips
                        label="Categoria"
                        obrigatorio
                        valor={form.categoria}
                        opcoes={categoriasExistentes}
                        onChange={v => setForm(f => ({ ...f, categoria: v }))}
                        placeholderNovo="Ex.: Lanches, Bebidas, Sobremesas…"
                        rotuloNovo="Nova categoria"
                      />
                      <SeletorChips
                        label="Subcategoria"
                        valor={form.subcategoria}
                        opcoes={subcategoriasDaCategoria}
                        onChange={v => setForm(f => ({ ...f, subcategoria: v }))}
                        placeholderNovo="Ex.: Especiais, Veganos…"
                        rotuloNovo="Nova subcategoria"
                        dica={form.categoria ? undefined : 'Escolha uma categoria primeiro'}
                      />
                    </div>
                  </section>

                  <div className="my-[26px] h-px bg-border" />

                  <section>
                    <RotuloSecao>Preço e venda</RotuloSecao>
                    {/* SEGMENTED CONTROL: duas opções exclusivas do mesmo atributo. O
                        trilho com a ativa em branco diz isso sem precisar de rótulo. */}
                    <div>
                      {/* Nao aponta pra um campo porque nao existe campo: sao dois
                          botoes exclusivos. Entao o rotulo nomeia o GRUPO e cada botao
                          diz se esta escolhido. Sem isso o leitor de tela anuncia
                          "Por unidade, botao" sem dizer do que e a escolha. */}
                      <Label id="p-vendido-rotulo">Como é vendido?</Label>
                      <div role="group" aria-labelledby="p-vendido-rotulo" className="mt-1.5 flex rounded-xl bg-muted p-1">
                        {([['un', 'Por unidade'], ['kg', 'Por peso (kg)']] as const).map(([v, txt]) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setForm(f => ({ ...f, vendido_por: v }))}
                            aria-pressed={form.vendido_por === v}
                            className={cn(
                              'h-10 flex-1 rounded-lg text-sm font-semibold transition-all',
                              form.vendido_por === v
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {txt}
                          </button>
                        ))}
                      </div>
                      {form.vendido_por === 'kg' && (
                        <p role="status" className="mt-1.5 text-[12.5px] text-muted-foreground">
                          No PDV o operador informa o peso (ou lê a etiqueta da balança) e o preço é calculado por kg.
                        </p>
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div>
                        {/* O rótulo muda com a unidade: "Preço" num produto por peso é
                            ambíguo entre o preço do quilo e o da peça. */}
                        <Label htmlFor="p-preco">{form.vendido_por === 'kg' ? 'Preço por kg (R$) *' : 'Preço (R$) *'}</Label>
                        <div className="relative mt-1.5">
                          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">R$</span>
                          <Input
                            id="p-preco"
                            required type="number" step="0.01" min="0.01"
                            value={form.preco} onChange={set('preco')} placeholder="0,00"
                            className={cn(CAMPO_MODAL, 'mt-0 pl-10')}
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="p-preco-promo">
                          Preço promocional
                          <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>
                        </Label>
                        <div className="relative mt-1.5">
                          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">R$</span>
                          <Input
                            id="p-preco-promo"
                            type="number" step="0.01" min="0.01"
                            value={form.preco_promocional} onChange={set('preco_promocional')} placeholder="—"
                            className={cn(CAMPO_MODAL, 'mt-0 pl-10')}
                            aria-describedby={erroPromo ? 'p-promo-erro' : 'p-promo-ajuda'}
                            aria-invalid={!!erroPromo}
                          />
                        </div>
                        {erroPromo && (
                          <p id="p-promo-erro" role="alert" className="mt-1 text-[12.5px] font-medium text-destructive">
                            {erroPromo}
                          </p>
                        )}
                      </div>
                    </div>

                    {/*
                      PRAZO DA PROMOÇÃO — só aparece quando existe promoção.
                      Campo de data vazio numa tela sem promoção nenhuma é uma
                      pergunta sem contexto; aqui ele nasce junto do valor.

                      Sem prazo, a promoção fica no ar até alguém lembrar de
                      tirar — era assim antes, e é como terça-feira acabava
                      vendendo com desconto de sábado.
                    */}
                    {form.preco_promocional && (
                      <div className="mt-4">
                        <Label htmlFor="p-promo-fim">
                          Promoção vale até
                          <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>
                        </Label>
                        <Input
                          id="p-promo-fim"
                          type="date"
                          value={form.promo_fim}
                          onChange={set('promo_fim')}
                          min={hojeBrasilia()}
                          className={CAMPO_MODAL}
                          aria-describedby="p-promo-ajuda"
                        />
                        <p id="p-promo-ajuda" className="mt-1 text-[12.5px] text-muted-foreground">
                          {form.promo_fim
                            ? 'A partir do dia seguinte, o preço volta ao normal sozinho. O valor da promoção fica guardado.'
                            : 'Em branco, a promoção não tem fim — vale até você tirar na mão.'}
                        </p>
                      </div>
                    )}

                    <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px]">
                      <div>
                        <Label htmlFor="p-ean">
                          Código de barras
                          <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>
                        </Label>
                        <Input
                          id="p-ean"
                          /* As duas linhas de ajuda (o que o campo faz, e se o codigo
                             vale como GTIN) ficam LIGADAS ao campo: o leitor de tela le
                             ao focar, em vez de deixa-las como texto solto que so quem
                             enxerga associa ao campo de cima. */
                          aria-describedby={'p-ean-dica' + (form.codigo_barras.trim() !== '' ? ' p-ean-gtin' : '')}
                          value={form.codigo_barras}
                          onChange={e => setForm(f => ({ ...f, codigo_barras: e.target.value.replace(/\D/g, '') }))}
                          inputMode="numeric"
                          placeholder="7891234567890"
                          className={cn(CAMPO_MODAL, 'font-mono')}
                          maxLength={20}
                        />
                        <p id="p-ean-dica" className="mt-1 text-[12.5px] text-muted-foreground">
                          Permite bipar no PDV. Por peso, use o PLU da balança.
                        </p>
                        {eanRepetido && (
                          <p role="alert" className="mt-1 text-[12.5px] font-medium text-destructive">
                            “{eanRepetido}” já usa este código. Dois produtos com o mesmo código fazem o PDV
                            entrar no errado — o sistema vai recusar ao salvar.
                          </p>
                        )}
                        {/*
                          Diz na hora do cadastro se o código vai ou não pra nota fiscal.
                          Sem isso o lojista digita um EAN com um dígito errado, acha que
                          cadastrou, e só descobre — se descobrir — que a NFC-e saiu como
                          "SEM GTIN". Não bloqueia: PLU de balança é código interno
                          legítimo e não é um GTIN.
                        */}
                        {form.codigo_barras.trim() !== '' && (
                          <p id="p-ean-gtin" className={cn('mt-1 text-[12.5px]',
                            gtinValido(form.codigo_barras) ? 'text-emerald-600' : 'text-amber-600')}>
                            {gtinValido(form.codigo_barras)
                              ? '✓ EAN válido — vai na nota fiscal como código do produto.'
                              : 'Não é um EAN válido (dígito verificador não fecha). Serve pra bipar no PDV, '
                                + 'mas a nota sai como “SEM GTIN”.'}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label htmlFor="p-serve">
                          Serve pessoas
                          <span className="ml-1 text-xs font-normal text-muted-foreground">(opc.)</span>
                        </Label>
                        <Input
                          id="p-serve"
                          type="number" min="1" max="20"
                          value={form.serve_pessoas} onChange={set('serve_pessoas')} placeholder="Ex.: 2"
                          className={CAMPO_MODAL}
                        />
                      </div>
                    </div>
                  </section>

                  <div className="my-[26px] h-px bg-border" />

                </div>
              </div>
              )}

              {aba === 'complementos' && (
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7 sm:px-8">
                  {/*
                    O EDITOR INTEIRO AQUI DENTRO, não um resumo com um botão.

                    Eram três telas empilhadas: salvar o produto, voltar pra
                    lista, achar o item, clicar em "Complementos". A aba cortou
                    duas, mas ainda mostrava só um resumo de leitura e um botão
                    que abria o MESMO editor num segundo modal por cima deste —
                    e fechar aquele modal voltava pro resumo, não pro produto.

                    Aqui a aba é o editor. `GruposEditor` sem `onFechar` se
                    renderiza sem casca de modal e sem rodapé próprio; o mesmo
                    componente continua servindo o atalho "Ver opções" da lista,
                    com a casca. Um editor só, dois lugares de entrada.
                  */}
                  {grupoIdEmEdicao === null || !produtoEmEdicao ? (
                    <section>
                      <RotuloSecao>Complementos</RotuloSecao>
                      {/* Produto novo: o grupo e vinculado a um produto que ainda
                          nao existe. Dizer isso e melhor que mostrar um editor
                          cujo primeiro clique daria erro. */}
                      <p className="rounded-xl border border-dashed border-border px-3.5 py-3 text-[12.5px] text-muted-foreground">
                        Salve o produto primeiro para adicionar tamanhos, bordas e adicionais.
                      </p>
                    </section>
                  ) : (
                    <GruposEditor produto={produtoEmEdicao} />
                  )}
                </div>
              )}

              {aba === 'config' && (
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7 sm:px-8">
                  {/*
                    DISPONIBILIDADE COMO LINHAS COM INTERRUPTOR, não chips: chip comunica
                    "filtro selecionável", interruptor comunica "ligado/desligado". Eram
                    três controles de estado com três aparências diferentes (dois ícones
                    de toggle e uma estrela solta num card cinza).
                  */}
                  <RotuloSecao>Disponibilidade</RotuloSecao>
                  <div className="-mx-1 space-y-1">
                    {/*
                      CARDÁPIO E PDV SÃO DOIS INTERRUPTORES, não um.
                      Eram a mesma chave: pausar um item no delivery tirava ele
                      também do balcão. Mas as duas coisas se decidem por
                      motivos diferentes — o prato que só sai no salão, o combo
                      de entrega que não faz sentido no balcão, o item que
                      acabou pro delivery mas ainda dá pra vender pra quem está
                      na loja.
                    */}
                    <LinhaInterruptor
                      titulo="Vender no cardápio"
                      descricao="Aparece pro cliente no delivery e na retirada"
                      ativo={form.disponivel}
                      onAlternar={() => setForm(f => ({ ...f, disponivel: !f.disponivel }))}
                    />
                    <LinhaInterruptor
                      titulo="Vender no PDV"
                      descricao="Aparece na tela de venda no balcão"
                      ativo={form.disponivel_pdv}
                      onAlternar={() => setForm(f => ({ ...f, disponivel_pdv: !f.disponivel_pdv }))}
                    />
                    {!form.disponivel && !form.disponivel_pdv && (
                      <p className="px-1 pb-1 text-[12.5px] text-amber-600">
                        Com os dois desligados o produto fica pausado — não vende em lugar nenhum.
                      </p>
                    )}
                    <LinhaInterruptor
                      titulo="Destaque"
                      descricao="Aparece no topo do cardápio"
                      ativo={form.destaque}
                      onAlternar={() => setForm(f => ({ ...f, destaque: !f.destaque }))}
                    />
                    <LinhaInterruptor
                      titulo="Controlar estoque"
                      descricao="Esgota sozinho quando zera"
                      ativo={form.controla_estoque}
                      onAlternar={() => setForm(f => ({ ...f, controla_estoque: !f.controla_estoque }))}
                    >
                      {form.controla_estoque && (
                        <div className="mt-3">
                          <Label htmlFor="p-estoque">Quantidade disponível</Label>
                          <Input
                            id="p-estoque"
                            type="number" min="0" step="1"
                            value={form.estoque} onChange={set('estoque')} placeholder="Ex.: 20"
                            className={CAMPO_MODAL}
                          />
                          <p className="mt-1 text-[12.5px] text-muted-foreground">
                            Baixa a cada pedido. Em 0, aparece como “Esgotado”.
                          </p>
                        </div>
                      )}
                    </LinhaInterruptor>
                  </div>
                </div>
              )}

              {aba === 'fiscal' && (
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7 sm:px-8">
                  {/* Fiscal colapsado: já vem com padrão seguro, e quem não emite nota
                      não deve tropeçar em NCM/CFOP pra cadastrar um lanche. */}
                  <div className="rounded-xl border border-border">
                    <button
                      type="button"
                      onClick={() => setMostrarFiscal(v => !v)}
                      className="flex w-full items-center gap-2.5 p-4 text-left"
                    >
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 text-sm font-semibold">Dados fiscais (NFC-e)</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Opcional
                      </span>
                      <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', mostrarFiscal && 'rotate-180')} />
                    </button>
                    {mostrarFiscal && (
                      <div className="grid grid-cols-2 gap-3 border-t border-border p-4 sm:grid-cols-3">
                        {([
                          ['NCM', form.ncm, (v: string) => setForm(f => ({ ...f, ncm: v.replace(/\D/g, '').slice(0, 8) })), 8, '21069090'],
                          ['CEST', form.cest, (v: string) => setForm(f => ({ ...f, cest: v.replace(/\D/g, '').slice(0, 7) })), 7, '—'],
                          ['CFOP', form.cfop, (v: string) => setForm(f => ({ ...f, cfop: v.replace(/\D/g, '').slice(0, 4) })), 4, '5102'],
                          ['CSOSN', form.csosn, (v: string) => setForm(f => ({ ...f, csosn: v.replace(/\D/g, '').slice(0, 3) })), 3, '102'],
                          ['Origem', form.origem, (v: string) => setForm(f => ({ ...f, origem: v.replace(/\D/g, '').slice(0, 1) })), 1, '0'],
                          ['Unidade', form.unidade_comercial, (v: string) => setForm(f => ({ ...f, unidade_comercial: v.toUpperCase().slice(0, 6) })), 6, 'UN'],
                        ] as Array<[string, string, (v: string) => void, number, string]>).map(([rotulo, valor, aoMudar, max, dica]) => (
                          <div key={rotulo}>
                            <Label htmlFor={'p-fiscal-' + rotulo.toLowerCase()}>{rotulo}</Label>
                            <Input
                              id={'p-fiscal-' + rotulo.toLowerCase()}
                              aria-describedby="p-fiscal-dica"
                              value={valor}
                              onChange={e => aoMudar(e.target.value)}
                              maxLength={max}
                              placeholder={dica}
                              className={cn(CAMPO_MODAL, 'h-11 font-mono')}
                            />
                          </div>
                        ))}
                        <p id="p-fiscal-dica" className="col-span-2 text-[12.5px] text-muted-foreground sm:col-span-3">
                          Já vem com valores padrão genéricos. Se seu contador pedir códigos específicos, ajuste aqui.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/*
                ─── Footer fixo ───
                É a diferença prática: no card inline o salvar descia com o formulário e,
                num cadastro longo, saía da tela justo na hora de usar.
              */}
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-[18px] sm:px-8">
                <Button type="button" variant="ghost" onClick={() => setEditando(null)} disabled={enviando}>
                  Cancelar
                </Button>
                <div className="flex items-center gap-2">
                  {/* "Salvar e criar outro": cadastro de cardápio é trabalho em lote —
                      são 30 itens numa sentada, e reabrir o modal a cada um dobra os
                      cliques. */}
                  <Button
                    type="submit"
                    variant="outline"
                    className="h-12 rounded-[10px]"
                    disabled={enviando}
                    onClick={() => { criarOutroRef.current = true; }}
                  >
                    Salvar e criar outro
                  </Button>
                  <Button
                    type="submit"
                    className="h-12 rounded-[10px] px-[30px]"
                    loading={enviando}
                    loadingText="Salvando…"
                    onClick={() => { criarOutroRef.current = false; }}
                  >
                    {editando === 'novo' ? 'Criar produto' : 'Salvar alterações'}
                  </Button>
                </div>
              </div>
            </form>
          </ModalConteudo>
        </Modal>

      {/* ── Loading ── */}
      {consulta.isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      )}

      {/* ── Falha ── vem antes do vazio: sem isto, consulta que falhou mostrava
           "Nenhum produto ainda", ou seja, dizia que o cardápio está vazio
           quando na verdade não deu pra buscar. ── */}
      {consulta.isError && (
        <Falha compacto erro={consulta.error} aoTentar={() => consulta.refetch()} />
      )}

      {/* ── Vazio ── */}
      {!consulta.isLoading && todos.length === 0 && !consulta.isError && (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <UtensilsCrossed className="mx-auto size-12 text-muted-foreground/50" strokeWidth={1.5} />
            <p className="font-semibold text-muted-foreground">Nenhum produto ainda</p>
            <p className="text-sm text-muted-foreground">
              Clique em "Novo produto" para montar seu cardápio.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Lista agrupada por categoria ── */}
      {Object.entries(porCategoria).map(([cat, subs]) => (
        <CategoriaSection
          key={cat}
          categoria={cat}
          subs={subs}
          onEditar={abrirEdicao}
          onExcluir={excluir}
          onAlternarDisponivel={alternarDisponivel}
          onVerOpcoes={p => setGerindoGrupos(p)}
          onDuplicar={duplicar}
          modoSelecao={modoSelecao}
          selecionados={selecionados}
          onToggleSelecao={alternarSelecao}
          densidade={densidade}
          onAdicionar={cat => { setForm({ ...FORM_VAZIO, categoria: cat }); setEditando('novo'); }}
        />
      ))}
      </div>
    </div>
  );
}

/* ─────────────────────── seletor de chips (categoria/subcategoria) ──────────────────────── */
/**
 * Altura e canto dos campos do modal, num lugar só.
 *
 * O foco sobrescreve o padrão do `Input` (anel de 2px na cor `ring`, com offset) por
 * borda na cor da marca + anel de 3px translúcido sem offset: offset abre um vão branco
 * entre borda e anel, que num formulário com muitos campos lado a lado aparece como
 * falha de alinhamento.
 */
const CAMPO_MODAL = 'mt-1.5 h-12 rounded-[10px] px-3.5 text-[15.5px] shadow-none '
  + 'focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/[0.14] focus-visible:ring-offset-0';

/** Rótulo de seção: caixa alta pequena, o suficiente pra agrupar sem virar título. */
function RotuloSecao({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-3 text-[12px] font-bold uppercase tracking-wider text-muted-foreground">{children}</h4>
  );
}

/**
 * Linha com interruptor — título, descrição do efeito e o controle à direita.
 *
 * A DESCRIÇÃO NÃO É ENFEITE: "Destaque" sozinho não diz onde o produto aparece, e
 * "Controlar estoque" não diz que o item some do cardápio ao zerar. Sem a segunda
 * linha, o lojista liga e desliga pra descobrir o que faz.
 */
function LinhaInterruptor({ titulo, descricao, ativo, onAlternar, children }: {
  titulo: string; descricao: string; ativo: boolean; onAlternar: () => void; children?: React.ReactNode;
}) {
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{titulo}</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">{descricao}</div>
        </div>
        {/* `role="switch"` + `aria-checked`: é um botão, mas leitor de tela precisa
            anunciar o ESTADO, não só o rótulo. */}
        <button
          type="button"
          role="switch"
          aria-checked={ativo}
          aria-label={titulo}
          onClick={onAlternar}
          className={cn(
            'relative h-[26px] w-11 shrink-0 rounded-full transition-colors',
            ativo ? 'bg-primary' : 'bg-muted-foreground/30',
          )}
        >
          <span className={cn(
            'absolute top-[3px] size-5 rounded-full bg-white shadow-sm transition-all',
            ativo ? 'left-[21px]' : 'left-[3px]',
          )} />
        </button>
      </div>
      {children}
    </div>
  );
}

function SeletorChips({
  label, valor, opcoes, onChange, placeholderNovo, rotuloNovo, obrigatorio = false, dica,
}: {
  label: string;
  valor: string;
  opcoes: string[];
  onChange: (v: string) => void;
  placeholderNovo: string;
  rotuloNovo: string;
  obrigatorio?: boolean;
  dica?: string;
}) {
  const [criando, setCriando] = useState(false);
  const [novo, setNovo] = useState('');

  const valorForaDaLista = valor && !opcoes.includes(valor);

  function confirmarNovo() {
    const v = novo.trim();
    if (!v) return;
    onChange(v);
    setNovo('');
    setCriando(false);
  }

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <Label className="mb-0">{label}{obrigatorio && ' *'}</Label>
        {!obrigatorio && <span className="text-xs text-muted-foreground">(opcional)</span>}
        {valor && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="ml-auto text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            Limpar
          </button>
        )}
      </div>

      {dica && <p className="text-xs text-muted-foreground mb-2">{dica}</p>}

      <div className="flex flex-wrap gap-2">
        {opcoes.map(op => {
          const ativo = valor === op;
          return (
            <button
              key={op}
              type="button"
              onClick={() => onChange(ativo ? '' : op)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                ativo
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background hover:border-primary/50 hover:bg-accent',
              )}
            >
              {ativo && <Check className="size-3.5" strokeWidth={3} />}
              {op}
            </button>
          );
        })}

        {valorForaDaLista && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
            <Check className="size-3.5" strokeWidth={3} />
            {valor}
            <span className="text-[10px] opacity-80">(nova)</span>
          </span>
        )}

        {criando ? (
          <div className="inline-flex items-center gap-1">
            <Input
              autoFocus
              value={novo}
              onChange={e => setNovo(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); confirmarNovo(); }
                if (e.key === 'Escape') { setCriando(false); setNovo(''); }
              }}
              placeholder={placeholderNovo}
              className="h-11 w-52 rounded-full text-sm sm:h-9"
            />
            <button
              type="button"
              onClick={confirmarNovo}
              disabled={!novo.trim()}
              aria-label="Confirmar"
              className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40 sm:size-9"
            >
              <Check className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => { setCriando(false); setNovo(''); }}
              className="flex size-9 items-center justify-center rounded-full border border-input text-muted-foreground hover:bg-accent"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCriando(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-input px-3 py-1.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            <Plus className="size-3.5" /> {rotuloNovo}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── seção de uma categoria ─────────────────── */
function CategoriaSection({
  categoria, subs, onEditar, onExcluir, onAlternarDisponivel, onVerOpcoes, onDuplicar,
  modoSelecao, selecionados, onToggleSelecao, densidade, onAdicionar,
}: {
  categoria: string;
  subs: Record<string, Produto[]>;
  onEditar: (p: Produto) => void;
  onExcluir: (id: number, nome: string) => void;
  onAlternarDisponivel: (p: Produto) => void;
  onVerOpcoes: (p: Produto) => void;
  onDuplicar: (p: Produto) => void;
  modoSelecao: boolean;
  selecionados: Set<number>;
  onToggleSelecao: (id: number) => void;
  densidade: Densidade;
  onAdicionar: (categoria: string) => void;
}) {
  const [aberta, setAberta] = useState(true);
  const total = Object.values(subs).flat().length;

  return (
    <section>
      {/*
        FILETE QUE CORRE ATÉ A DIREITA no lugar do chevron isolado num canto: ele liga
        visualmente o nome da categoria ao "Adicionar item" daquela categoria, e separa
        um bloco do outro sem precisar de card em volta.

        O botão de colapsar é só o nome + chevron, não a faixa inteira: com a faixa toda
        clicável, tentar clicar em "Adicionar item" colapsava a seção.
      */}
      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setAberta(a => !a)}
          className="group flex shrink-0 items-center gap-2"
        >
          <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', !aberta && '-rotate-90')} />
          <span className="text-[12.5px] font-extrabold uppercase tracking-[0.11em] text-muted-foreground group-hover:text-foreground">
            {categoria}
          </span>
          <span className="text-[12px] text-muted-foreground/70">
            {total} {total === 1 ? 'item' : 'itens'}
          </span>
        </button>
        <div className="h-px flex-1 bg-border" />
        <button
          type="button"
          onClick={() => onAdicionar(categoria)}
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          + Adicionar item
        </button>
      </div>

      {aberta && (
        <div className="space-y-5">
          {Object.entries(subs).map(([sub, itens]) => (
            <div key={sub}>
              {sub && (
                <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {sub}
                </p>
              )}
              {/*
                `auto-fill` com mínimo em px: a grade decide sozinha quantas colunas
                cabem, sem breakpoint escrito à mão. A densidade mexe nesse mínimo —
                440px é o card confortável, 340px empacota mais por linha. É o que
                sobrou do antigo alternador de densidade, que antes trocava a altura da
                linha e não faz sentido numa grade.
              */}
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(${densidade === 'compacta' ? 340 : 440}px, 1fr))`,
                }}
              >
                {itens.map(p => (
                  <CardProduto
                    key={p.id}
                    produto={p}
                    onEditar={() => onEditar(p)}
                    onExcluir={() => onExcluir(p.id, p.nome)}
                    onAlternarDisponivel={() => onAlternarDisponivel(p)}
                    onVerOpcoes={() => onVerOpcoes(p)}
                    onDuplicar={() => onDuplicar(p)}
                    modoSelecao={modoSelecao}
                    selecionado={selecionados.has(p.id)}
                    onToggleSelecao={() => onToggleSelecao(p.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ─────────────────────── card do produto ──────────────────────── */

/** Ícone de ação do rodapé do card: 32px, alvo aceitável sem inflar a linha. */
function BotaoIcone({ titulo, onClick, destrutivo, children }: {
  titulo: string; onClick: () => void; destrutivo?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className={cn(
        'flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors',
        destrutivo
          ? 'hover:bg-destructive/10 hover:text-destructive'
          : 'hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function CardProduto({
  produto: p, onEditar, onExcluir, onAlternarDisponivel, onVerOpcoes, onDuplicar,
  modoSelecao, selecionado, onToggleSelecao,
}: {
  produto: Produto;
  onEditar: () => void;
  onExcluir: () => void;
  onAlternarDisponivel: () => void;
  onVerOpcoes: () => void;
  onDuplicar: () => void;
  modoSelecao: boolean;
  selecionado: boolean;
  onToggleSelecao: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const grupos = (p as any).grupos as GrupoOpcoes[] | undefined;
  const totalGrupos = grupos?.length ?? 0;
  const semEstoque = !!p.controla_estoque && (p.estoque ?? 0) <= 0;

  return (
    <div
      className={cn(
        // Sombra de repouso quase invisível + sombra difusa no hover. Borda E sombra
        // forte juntas é o que faz card parecer "caixa dentro de caixa".
        'group rounded-[18px] border border-border bg-card shadow-[0_1px_2px_rgba(28,25,23,0.04)] transition-all duration-[180ms]',
        'hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-20px_rgba(28,25,23,0.25)]',
        !ehVendido(p) && 'opacity-70',
        selecionado && 'ring-2 ring-primary',
        modoSelecao && 'cursor-pointer',
      )}
      onClick={modoSelecao ? onToggleSelecao : undefined}
    >
      <div className="flex gap-[18px] p-[18px]">
        {modoSelecao && (
          <button type="button" onClick={e => { e.stopPropagation(); onToggleSelecao(); }} className="shrink-0 text-primary">
            {selecionado ? <CheckSquare className="size-5" /> : <Square className="size-5 text-muted-foreground" />}
          </button>
        )}

        {/* Foto 96px com anel INTERNO: borda comum somaria 1px ao tamanho e desalinharia
            a foto do texto ao lado; `inset` fica dentro da caixa. */}
        {p.foto_url ? (
          <img
            src={p.foto_url}
            alt={p.nome}
            className="size-24 shrink-0 rounded-[15px] bg-muted object-cover shadow-[inset_0_0_0_1px_rgba(28,25,23,0.06)]"
          />
        ) : (
          <div className="flex size-24 shrink-0 items-center justify-center rounded-[15px] bg-muted text-muted-foreground shadow-[inset_0_0_0_1px_rgba(28,25,23,0.06)]">
            <UtensilsCrossed className="size-7" strokeWidth={1.5} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          {/* Nome à esquerda, preço à direita na MESMA linha de base: o preço é o
              número que se compara entre itens, e alinhado à direita a coluna de
              preços se lê de cima a baixo sem procurar. */}
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="truncate text-[16px] font-bold leading-tight">{p.nome}</h3>
            <span className="shrink-0 text-[16px] font-extrabold tabular-nums">{brl(p.preco_centavos)}</span>
          </div>

          {p.descricao && (
            <p className="mt-1 line-clamp-2 text-[13.5px] leading-snug text-muted-foreground">{p.descricao}</p>
          )}

          {/*
            BADGES COM BORDA TONAL, não chapados: chapado com cor forte grita mais que o
            nome do produto. Âmbar e verde ficam FIXOS porque são semânticos (destaque,
            promoção) — seguindo a cor da marca, uma loja de paleta verde perderia a
            distinção entre promoção e o resto.
          */}
          {(p.destaque || p.preco_promocional_centavos || semEstoque || p.controla_estoque) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {p.destaque && (
                <span className="inline-flex items-center gap-1 rounded-md border border-[#F1E3C4] bg-[#FBF3E4] px-2 py-0.5 text-[11.5px] font-bold text-[#92610A] dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                  <Star className="size-3 fill-current" /> Destaque
                </span>
              )}
              {/*
                Promoção VENCIDA continua aparecendo, em cinza e dizendo que
                venceu. Sumir o selo esconderia que o produto tem um preço
                promocional guardado — e o lojista abriria o cadastro sem
                entender por que o campo está preenchido.
              */}
              {p.preco_promocional_centavos ? (
                promocaoVigente(p) ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-[#CBEADB] bg-[#EBF7F1] px-2 py-0.5 text-[11.5px] font-bold text-[#047857] dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300">
                    Promoção {brl(p.preco_promocional_centavos)}
                    <span className="font-normal line-through opacity-70">antes {brl(p.preco_centavos)}</span>
                    {p.promo_fim && <span className="font-normal opacity-70">até {p.promo_fim.slice(8, 10)}/{p.promo_fim.slice(5, 7)}</span>}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 text-[11.5px] font-bold text-muted-foreground">
                    Promoção vencida {p.promo_fim && <span className="font-normal">em {p.promo_fim.slice(8, 10)}/{p.promo_fim.slice(5, 7)}</span>}
                  </span>
                )
              ) : null}
              {semEstoque ? (
                <span className="rounded-md border border-destructive/25 bg-destructive/10 px-2 py-0.5 text-[11.5px] font-bold text-destructive">
                  Esgotado
                </span>
              ) : p.controla_estoque ? (
                <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[11.5px] font-semibold text-muted-foreground">
                  {p.estoque} em estoque
                </span>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {!modoSelecao && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-[18px] py-[11px]">
          {/* Interruptor com RÓTULO: sozinho, um toggle não diz o que está ligado, e
              "à venda ou pausado" é a informação mais consultada do card. */}
          <button
            type="button"
            onClick={onAlternarDisponivel}
            className="flex items-center gap-2.5"
            role="switch"
            aria-checked={ehVendido(p)}
            aria-label={ehVendido(p) ? 'Pausar produto' : 'Colocar à venda'}
          >
            <span className={cn('relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors',
              ehVendido(p) ? 'bg-primary' : 'bg-muted-foreground/30')}>
              <span className={cn('absolute top-[3px] size-4 rounded-full bg-white shadow-sm transition-all',
                ehVendido(p) ? 'left-[19px]' : 'left-[3px]')} />
            </span>
            <span className={cn('text-[12.5px] font-semibold',
              ehVendido(p) ? 'text-foreground' : 'text-muted-foreground')}>
              {rotuloVenda(p)}
            </span>
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onVerOpcoes}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ListPlus className="size-[15px]" />
              Complementos
              {totalGrupos > 0 && <span className="text-muted-foreground/70">({totalGrupos})</span>}
            </button>
            <span className="mx-0.5 h-5 w-px bg-border" />
            <BotaoIcone titulo="Editar" onClick={onEditar}><Pencil className="size-[15px]" /></BotaoIcone>
            <BotaoIcone titulo="Duplicar" onClick={onDuplicar}><Copy className="size-[15px]" /></BotaoIcone>
            <BotaoIcone titulo="Excluir" onClick={onExcluir} destrutivo><Trash2 className="size-[15px]" /></BotaoIcone>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Editor de complementos — modal centrado.
 *
 * Toda mutação continua indo direto pra API (criar grupo, criar opção, alternar
 * obrigatório...). Isso é intencional e é por isso que o rodapé NÃO diz
 * "Cancelar": não existe rascunho pra descartar, e um botão que promete desfazer
 * o que já foi gravado é pior que botão nenhum.
 */

/**
 * A CASCA DO EDITOR DE COMPLEMENTOS: modal quando vem da lista, bloco nu quando
 * vem da aba "Complementos" do cadastro.
 *
 * Por que existir: a aba mostrava um resumo so de leitura e um botao que abria
 * ESTE editor num segundo modal, por cima do primeiro. Uma aba inteira cuja
 * unica funcao era abrir outra janela -- e, dentro dela, fechar o editor levava
 * de volta pro resumo, nao pro produto. Embutido, a aba passa a ser o editor.
 *
 * O rodape com "Fechar / Concluir" so existe na versao modal: embutido, quem
 * fecha e o rodape do proprio cadastro, e dois pares de botoes de encerrar na
 * mesma tela e a pergunta "qual deles salva?".
 */
function CascaGrupos({ produto, nGrupos, onFechar, children }: {
  produto: Produto;
  nGrupos: number;
  /** Ausente = embutido no cadastro, sem modal e sem rodape proprio. */
  onFechar?: () => void;
  children: React.ReactNode;
}) {
  if (!onFechar) {
    return (
      /*
        ENTER NAO PODE SALVAR O PRODUTO AQUI.
        Embutido, este editor fica DENTRO do <form> do cadastro, e num form o
        Enter em qualquer campo de texto aciona o submit -- teclar Enter no
        preco de uma borda salvaria o produto e fecharia o modal por cima do
        trabalho. Os campos que tratam Enter (criar opcao, renomear) ja chamam
        preventDefault; este `capture` cobre os que nao tratam, e os futuros.
        `preventDefault` nao interrompe a propagacao, entao os handlers de cada
        campo continuam rodando normalmente.
      */
      <div
        className="space-y-6"
        onKeyDownCapture={e => {
          if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
        }}
      >
        <p className="text-[12.5px] text-muted-foreground">
          Valem so para este produto e sao salvos na hora, sem depender do botao do cadastro.
        </p>
        {children}
      </div>
    );
  }
  return (
    <Modal open onOpenChange={aberto => { if (!aberto) onFechar(); }}>
      <ModalConteudo className="sm:w-[min(880px,calc(100vw-56px))]">
        {/* ── Header fixo ── */}
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-7 py-5 max-sm:px-4">
          <div className="min-w-0 flex-1">
            <ModalTitulo className="text-[19px] font-extrabold leading-tight">Complementos</ModalTitulo>
            <ModalDescricao className="mt-0.5 truncate text-[13.5px] text-muted-foreground">
              {produto.nome}{produto.categoria ? ` · ${produto.categoria}` : ''}
            </ModalDescricao>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            {nGrupos} {nGrupos === 1 ? 'grupo' : 'grupos'}
          </span>
          <ModalClose
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent"
            title="Fechar"
          >
            <X className="size-5" />
          </ModalClose>
        </div>

        {/* ── Corpo rolável ── */}
        <div className="flex-1 space-y-6 overflow-y-auto px-7 py-6 max-sm:px-4">
{children}
        </div>

        {/* ── Footer fixo ── */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-7 py-4 max-sm:px-4">
          {/*
            Diz que já está salvo. O rodapé de um modal cheio de campos é lido
            como "confirme aqui", e sem esta linha o lojista fecharia no X
            achando que perdeu tudo — ou pior, não fecharia.
          */}
          <p className="text-[13px] text-muted-foreground">
            As mudanças valem só para este produto e são salvas na hora.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={onFechar}>
              Fechar
            </Button>
            <Button type="button" className="h-11 rounded-[11px]" disabled={nGrupos === 0} onClick={onFechar}>
              <Check className="size-4" /> Concluir
            </Button>
          </div>
        </div>
      </ModalConteudo>
    </Modal>
  );
}

function GruposEditor({ produto, onFechar }: { produto: Produto; onFechar?: () => void }) {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();
  const queryKey = ['lojista-grupos', produto.id];
  const [grupoFocoId, setGrupoFocoId] = useState<number | null>(null);
  const [salvandoGrupo, setSalvandoGrupo] = useState(false);
  /** Qual grupo está com o painel de itens aberto (só um por vez). */
  const [abertoId, setAbertoId] = useState<number | null>(null);
  /**
   * Grupos em que o lojista pediu pra ver ingredientes e seção.
   *
   * Os dois campos estavam sempre na tela, em TODO grupo: quem cadastra "Sem
   * borda / Catupiry / Cheddar" passava por duas linhas de campo vazio a cada
   * item, por causa de um recurso que e de pizza. Aparecem sozinhos onde fazem
   * sentido (grupo de sabores, ou grupo que ja usa algum dos dois) e sob
   * demanda no resto -- nunca escondem valor ja preenchido.
   */
  const [detalhesAbertos, setDetalhesAbertos] = useState<Record<number, boolean>>({});
  /** Índice sendo arrastado, pra saber o que soltar onde. */
  const [arrastando, setArrastando] = useState<number | null>(null);

  /*
   * As opções que ESTA LOJA já usa, por nome de grupo.
   *
   * `staleTime` longo porque isso muda devagar (só quando o lojista cria uma
   * opção nova) e o modal abre e fecha muitas vezes numa sessão de cadastro —
   * refazer a consulta a cada abertura seria pedir a mesma lista de novo.
   *
   * Falha em silêncio de propósito: sem histórico, os chips padrão continuam
   * valendo, e um erro aqui não pode impedir de cadastrar complemento.
   */
  const { data: historico } = useQuery({
    queryKey: ['lojista-sugestoes-opcoes'],
    queryFn: () =>
      api<{ sugestoes: Record<string, SugestaoSalva[]> }>('GET', '/api/lojista/opcoes/sugestoes')
        .then(r => r.sugestoes)
        .catch((): Record<string, SugestaoSalva[]> => ({})),
    staleTime: 5 * 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      api<{ grupos: GrupoOpcoes[] }>('GET', `/api/lojista/produtos/${produto.id}/grupos`)
        .then(r => r.grupos),
  });

  const grupos = data ?? [];

  // Ao criar um grupo, abre o painel dele e põe o cursor no campo de item: o
  // grupo vazio não serve pra nada, e o passo seguinte é sempre o mesmo.
  useEffect(() => {
    if (grupoFocoId === null || grupos.length === 0) return;
    const tentar = () => {
      const input = document.getElementById(`opcao-nome-${grupoFocoId}`) as HTMLInputElement | null;
      if (input) {
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setGrupoFocoId(null);
      }
    };
    tentar();
    const t = setTimeout(tentar, 80);
    return () => clearTimeout(t);
  }, [grupos, grupoFocoId]);

  type FormGrupo = { nome: string; tipo: 'unico' | 'multiplo'; obrigatorio: boolean; max_escolhas: string; papel: string; modo_preco: string };
  const [novoGrupo, setNovoGrupo] = useState<FormGrupo | null>(null);
  const [novasOpcoes, setNovasOpcoes] = useState<Record<number, { nome: string; preco: string; secao: string; descricao: string }>>({});
  const [editandoGrupoId, setEditandoGrupoId] = useState<number | null>(null);
  const [editandoGrupoForm, setEditandoGrupoForm] = useState<FormGrupo | null>(null);
  const [editandoOpcaoId, setEditandoOpcaoId] = useState<number | null>(null);
  const [editandoOpcaoNome, setEditandoOpcaoNome] = useState('');
  const [editandoOpcaoPreco, setEditandoOpcaoPreco] = useState('');
  const [editandoOpcaoSecao, setEditandoOpcaoSecao] = useState('');
  const [editandoOpcaoDesc, setEditandoOpcaoDesc] = useState('');
  const [editandoOpcaoImg, setEditandoOpcaoImg] = useState('');

  function opcaoForm(grupoId: number) {
    return novasOpcoes[grupoId] ?? { nome: '', preco: '', secao: '', descricao: '' };
  }
  function setOpcaoForm(grupoId: number, campo: 'nome' | 'preco' | 'secao' | 'descricao', valor: string) {
    setNovasOpcoes(prev => ({ ...prev, [grupoId]: { ...opcaoForm(grupoId), [campo]: valor } }));
  }

  function abrirEdicaoGrupo(grupo: GrupoOpcoes) {
    setEditandoGrupoId(grupo.id);
    setEditandoGrupoForm({
      nome: grupo.nome,
      tipo: grupo.tipo,
      obrigatorio: !!grupo.obrigatorio,
      max_escolhas: grupo.max_escolhas > 0 ? String(grupo.max_escolhas) : '',
      papel: grupo.papel || '',
      modo_preco: grupo.modo_preco || 'somar',
    });
  }

  async function salvarEdicaoGrupo() {
    if (!editandoGrupoForm || !editandoGrupoId) return;
    if (!editandoGrupoForm.nome.trim()) {
      mostrar({ tipo: 'erro', titulo: 'O nome do grupo não pode ser vazio.' });
      return;
    }
    try {
      await api('PUT', `/api/lojista/grupos/${editandoGrupoId}`, {
        nome: editandoGrupoForm.nome.trim(),
        tipo: editandoGrupoForm.tipo,
        obrigatorio: editandoGrupoForm.obrigatorio,
        max_escolhas: editandoGrupoForm.tipo === 'multiplo'
          ? (Number(editandoGrupoForm.max_escolhas) || 0)
          : 1,
        papel: editandoGrupoForm.papel,
        /*
         * A COBRANÇA DO SABOR É ESCOLHA DO LOJISTA, não decisão nossa.
         *
         * Isto forçava 'maior' sempre que o papel era 'sabores'. Dois problemas:
         *
         *  - Cobrava MENOS que o mercado. Pizzaria brasileira soma 100% do
         *    acréscimo de cada sabor especial, mesmo ocupando meia pizza
         *    (R$ 94,90 + R$ 16,00 = R$ 110,90). 'maior' cobraria só R$ 16,00 de
         *    acréscimo no total.
         *  - E era INCONSISTENTE: criar o grupo pelo modelo gravava 'somar',
         *    editar o grupo gravava 'maior'. Mexer no nome do grupo mudava o
         *    preço da pizza em silêncio.
         *
         * Grupo que não é de sabores continua somando: dois bacons custam dois
         * bacons, e não faz sentido oferecer 'maior' ali.
         */
        modo_preco: editandoGrupoForm.papel === 'sabores' ? editandoGrupoForm.modo_preco : 'somar',
      });
      await qc.refetchQueries({ queryKey });
      setEditandoGrupoId(null);
      setEditandoGrupoForm(null);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao salvar grupo.';
      mostrar({ tipo: 'erro', titulo: msg });
    }
  }

  /**
   * Liga/desliga "obrigatório" direto na lista.
   *
   * Vem junto o `tipo`: obrigatório com múltipla escolha e sem mínimo é uma
   * regra que o cardápio não sabe cobrar, então o switch já deixa o grupo em
   * escolha única — que é o que "obrigatório" quer dizer na prática (escolha 1).
   */
  async function alternarObrigatorio(grupo: GrupoOpcoes) {
    const virando = !grupo.obrigatorio;
    try {
      await api('PUT', `/api/lojista/grupos/${grupo.id}`, {
        nome: grupo.nome,
        tipo: virando ? 'unico' : grupo.tipo,
        obrigatorio: virando,
        max_escolhas: virando ? 1 : grupo.max_escolhas,
      });
      await qc.refetchQueries({ queryKey });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao mudar a regra do grupo.';
      mostrar({ tipo: 'erro', titulo: msg });
    }
  }

  /**
   * Solta o grupo arrastado na posição de destino.
   *
   * Grava otimista: a lista reordena na hora e as gravações vão atrás. Arrastar
   * é um gesto contínuo — se a lista só se mexesse depois da resposta do
   * servidor, o lojista soltaria e veria o item voltar pro lugar antigo por meio
   * segundo, o que parece bug mesmo quando dá tudo certo.
   */
  async function soltarEm(destino: number) {
    const origem = arrastando;
    setArrastando(null);
    if (origem === null || origem === destino) return;
    const novos = [...grupos];
    const [movido] = novos.splice(origem, 1);
    novos.splice(destino, 0, movido);
    qc.setQueryData(queryKey, novos.map((g, i) => ({ ...g, ordem: i })));
    try {
      await Promise.all(novos.map((g, i) =>
        api('PUT', `/api/lojista/grupos/${g.id}`, { nome: g.nome, ordem: i })));
      await qc.refetchQueries({ queryKey });
    } catch {
      // Falhou a gravação: refaz do servidor pra tela não mentir sobre a ordem
      // que o cliente vai ver no cardápio.
      await qc.refetchQueries({ queryKey });
      mostrar({ tipo: 'erro', titulo: 'Não consegui salvar a nova ordem.' });
    }
  }

  async function criarGrupoComDados(dados: {
    nome: string; tipo: 'unico' | 'multiplo'; obrigatorio: boolean; max_escolhas: number;
    papel?: 'tamanho' | 'sabores'; modo_preco?: 'maior' | 'proporcional';
  }) {
    setSalvandoGrupo(true);
    try {
      const res = await api<{ grupo_id: number }>('POST', `/api/lojista/produtos/${produto.id}/grupos`, {
        ...dados,
        ordem: grupos.length,
      });
      await qc.refetchQueries({ queryKey });
      // Abre o painel do grupo recém-criado: grupo vazio não serve pra nada, e o
      // passo seguinte é sempre adicionar o primeiro item.
      setAbertoId(res.grupo_id);
      setGrupoFocoId(res.grupo_id);
      setNovoGrupo(null);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao criar grupo. Tente novamente.';
      mostrar({ tipo: 'erro', titulo: msg });
    } finally {
      setSalvandoGrupo(false);
    }
  }

  async function adicionarSugestao(grupoId: number, nome: string, grupoNome: string) {
    try {
      /*
       * O CHIP RECRIA A CONFIGURAÇÃO, não só o nome.
       *
       * Antes mandava `preco_adicional: '0'` fixo: clicar em "Catupiry" recriava
       * o sabor de graça, sem seção e sem ingredientes, e o lojista redigitava
       * tudo. Se a loja já cadastrou aquele item antes, o histórico sabe o preço,
       * a faixa e a descrição — é isso que faz "não precisar fazer de novo"
       * valer.
       *
       * Sugestão do padrão do sistema (que a loja nunca usou) não tem histórico:
       * cai no preço 0, que é o comportamento anterior e o certo pra um nome que
       * ninguém precificou ainda.
       */
      const salva = indiceDeSugestoes(historico?.[grupoNome]).get(nome.trim().toLowerCase());
      await api('POST', `/api/lojista/grupos/${grupoId}/opcoes`, {
        nome,
        preco_adicional: salva?.preco_adicional_centavos
          ? String(salva.preco_adicional_centavos / 100) : '0',
        secao: salva?.secao || '',
        descricao: salva?.descricao || '',
        imagem: salva?.imagem || '',
      });
      await qc.refetchQueries({ queryKey });
      // O histórico ganhou um nome novo — sem invalidar, o chip só apareceria
      // pro próximo produto depois do staleTime.
      qc.invalidateQueries({ queryKey: ['lojista-sugestoes-opcoes'] });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao adicionar opção.';
      mostrar({ tipo: 'erro', titulo: msg });
    }
  }

  async function atualizarOpcao(opcaoId: number) {
    if (!editandoOpcaoNome.trim()) return;
    try {
      await api('PUT', `/api/lojista/opcoes/${opcaoId}`, {
        nome: editandoOpcaoNome.trim(),
        preco_adicional: editandoOpcaoPreco || '0',
        secao: editandoOpcaoSecao,
        descricao: editandoOpcaoDesc,
        imagem: editandoOpcaoImg,
      });
      await qc.refetchQueries({ queryKey });
      setEditandoOpcaoId(null);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao salvar opção.';
      mostrar({ tipo: 'erro', titulo: msg });
    }
  }

  async function criarGrupoManual() {
    if (!novoGrupo || !novoGrupo.nome.trim()) return;
    await criarGrupoComDados({
      nome: novoGrupo.nome.trim(),
      tipo: novoGrupo.tipo,
      obrigatorio: novoGrupo.obrigatorio,
      max_escolhas: novoGrupo.tipo === 'multiplo' ? (Number(novoGrupo.max_escolhas) || 0) : 1,
    });
  }

  async function excluirGrupo(grupoId: number) {
    if (!(await confirmar({ titulo: 'Remover este grupo?', descricao: 'Todas as opções dele serão removidas também.', confirmar: 'Remover', destrutivo: true }))) return;
    try {
      await api('DELETE', `/api/lojista/grupos/${grupoId}`);
      qc.invalidateQueries({ queryKey });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  async function criarOpcao(grupoId: number) {
    const f = opcaoForm(grupoId);
    if (!f.nome.trim()) return;
    try {
      await api('POST', `/api/lojista/grupos/${grupoId}/opcoes`, {
        nome: f.nome.trim(),
        preco_adicional: f.preco || '0',
        secao: f.secao || '',
        descricao: f.descricao || '',
      });
      await qc.refetchQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['lojista-sugestoes-opcoes'] });
      /*
       * A SEÇÃO PERMANECE ao limpar o formulário, o nome e o preço não.
       * Cadastrar sabores é cadastrar em lote: dez tradicionais seguidos. Zerar
       * a seção a cada item obrigaria a redigitar "Tradicionais" dez vezes —
       * exatamente o tipo de trabalho manual que a gente veio tirar daqui.
       */
      setNovasOpcoes(prev => ({ ...prev, [grupoId]: { nome: '', preco: '', secao: f.secao || '', descricao: '' } }));
      setTimeout(() => document.getElementById(`opcao-nome-${grupoId}`)?.focus(), 50);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao adicionar opção. Tente novamente.';
      mostrar({ tipo: 'erro', titulo: msg });
    }
  }

  /** Grava quantos sabores a opção de tamanho libera. */
  async function definirSabores(opcao: OpcaoItem, sabores: number) {
    try {
      await api('PUT', `/api/lojista/opcoes/${opcao.id}`, { sabores });
      await qc.refetchQueries({ queryKey });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao salvar.';
      mostrar({ tipo: 'erro', titulo: msg });
    }
  }

  async function excluirOpcao(opcaoId: number) {
    try {
      await api('DELETE', `/api/lojista/opcoes/${opcaoId}`);
      qc.refetchQueries({ queryKey });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao excluir opção.';
      mostrar({ tipo: 'erro', titulo: msg });
    }
  }

  async function toggleDisponivel(opcao: OpcaoItem) {
    try {
      await api('PUT', `/api/lojista/opcoes/${opcao.id}`, { disponivel: !opcao.disponivel });
      qc.refetchQueries({ queryKey });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao atualizar opção.';
      mostrar({ tipo: 'erro', titulo: msg });
    }
  }

  /* Modelos que sobram: os que combinam com a categoria e ainda não foram usados. */
  const modelos = modelosDaCategoria(produto.categoria)
    .filter(t => !grupos.some(g => g.nome.toLowerCase() === t.nome.toLowerCase()));

  return (
    <CascaGrupos produto={produto} nGrupos={grupos.length} onFechar={onFechar}>
          {isLoading && <Skeleton className="h-24" />}

          {/* 1. Grupos já criados */}
          {grupos.length > 0 && (
            <div className="space-y-2.5">
              {grupos.map((grupo, i) => {
                /* Com um grupo so, o painel de itens ja nasce aberto: fechado, a
                   tela mostrava um titulo e nada mais, e o proximo passo era
                   sempre o mesmo clique. */
                const aberto = abertoId === grupo.id || (abertoId === null && grupos.length === 1);
                const editando = editandoGrupoId === grupo.id && editandoGrupoForm;
                const detalhes = grupo.papel === 'sabores'
                  || grupo.opcoes.some(o => o.secao || o.descricao)
                  || !!detalhesAbertos[grupo.id];
                return (
                  <div
                    key={grupo.id}
                    onDragOver={e => { if (arrastando !== null) e.preventDefault(); }}
                    onDrop={() => soltarEm(i)}
                    className={cn('rounded-2xl border border-border bg-card shadow-sm transition-opacity',
                      arrastando === i && 'opacity-40')}
                  >
                    {editando ? (
                      /* ── Renomear / trocar a regra ── */
                      <div className="space-y-2 rounded-2xl bg-accent/40 px-4 py-3.5">
                        <Input
                          autoFocus
                          value={editandoGrupoForm.nome}
                          onChange={e => setEditandoGrupoForm(f => f && ({ ...f, nome: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); salvarEdicaoGrupo(); } if (e.key === 'Escape') setEditandoGrupoId(null); }}
                          className="h-9 text-sm font-bold"
                          placeholder="Nome do grupo"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex overflow-hidden rounded-lg border border-border text-xs font-semibold">
                            <button type="button" onClick={() => setEditandoGrupoForm(f => f && ({ ...f, tipo: 'unico' }))}
                              className={cn('px-2.5 py-1 transition-colors', editandoGrupoForm.tipo === 'unico' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent')}>
                              Única escolha
                            </button>
                            <button type="button" onClick={() => setEditandoGrupoForm(f => f && ({ ...f, tipo: 'multiplo' }))}
                              className={cn('border-l border-border px-2.5 py-1 transition-colors', editandoGrupoForm.tipo === 'multiplo' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent')}>
                              Múltipla
                            </button>
                          </div>
                          <button type="button" onClick={() => setEditandoGrupoForm(f => f && ({ ...f, obrigatorio: !f.obrigatorio }))}
                            className={cn('flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors', editandoGrupoForm.obrigatorio ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-accent')}>
                            <Check className={cn('size-3', editandoGrupoForm.obrigatorio ? 'opacity-100' : 'opacity-0')} />
                            Obrigatório
                          </button>
                          {/*
                            PAPEL NA PIZZA. Sem isto, o grupo de sabores usaria
                            um limite fixo (a P aceitaria os mesmos 3 sabores da
                            G) e somaria o preço dos três em vez de cobrar o
                            mais caro.
                          */}
                          <select
                            value={editandoGrupoForm.papel}
                            onChange={e => setEditandoGrupoForm(f => f && ({ ...f, papel: e.target.value }))}
                            className="h-7 rounded-lg border border-border bg-card px-1.5 text-xs font-semibold text-muted-foreground"
                            title="Este grupo é o tamanho, a lista de sabores, ou nenhum dos dois"
                          >
                            {/*
                              O RÓTULO DIZ O QUE O GRUPO É, não o efeito dele.
                              Era "Tamanho (define nº de sabores)" e
                              "Sabores (limite vem do tamanho)" — quem estava
                              configurando o grupo de SABORES lia "define nº de
                              sabores" e marcava Tamanho, porque é literalmente
                              o que a frase promete. Aconteceu na base real: um
                              grupo chamado "Sabores" ficou com papel=tamanho, e
                              aí o campo de sabores por tamanho apareceu em cada
                              sabor.
                            */}
                            <option value="">Nenhum (grupo comum)</option>
                            <option value="tamanho">Este grupo é o TAMANHO da pizza</option>
                            <option value="sabores">Este grupo é a lista de SABORES</option>
                          </select>
                          {/*
                            COMO COBRAR VÁRIOS SABORES. Só aparece no grupo de
                            sabores, porque é a única situação em que a pergunta
                            existe — em adicionais, somar é o certo.

                            O padrão é SOMAR porque é o que a pizzaria brasileira
                            cobra. 'Maior' é legítimo (algumas casas fazem), mas
                            cobra menos, e quem escolhe é o dono.
                          */}
                          {editandoGrupoForm.papel === 'sabores' && (
                            <select
                              value={editandoGrupoForm.modo_preco}
                              onChange={e => setEditandoGrupoForm(f => f && ({ ...f, modo_preco: e.target.value }))}
                              className="h-7 rounded-lg border border-border bg-card px-1.5 text-xs font-semibold text-muted-foreground"
                              title="Como cobrar quando há mais de um sabor"
                            >
                              <option value="somar">Cada sabor cobra 100%</option>
                              <option value="maior">Só o sabor mais caro</option>
                              <option value="proporcional">Proporcional à fração</option>
                            </select>
                          )}
                          {editandoGrupoForm.tipo === 'multiplo' && editandoGrupoForm.papel !== 'sabores' && (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">Máx.</span>
                              <Input
                                type="number" min="0" placeholder="∞"
                                value={editandoGrupoForm.max_escolhas}
                                onChange={e => setEditandoGrupoForm(f => f && ({ ...f, max_escolhas: e.target.value }))}
                                className="h-7 w-14 px-1 text-center text-xs"
                              />
                            </div>
                          )}
                          <div className="ml-auto flex gap-1">
                            <button type="button" onClick={salvarEdicaoGrupo}
                              className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90">
                              <Check className="size-3" /> Salvar
                            </button>
                            <button type="button" onClick={() => setEditandoGrupoId(null)}
                              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent">
                              <X className="size-3" /> Cancelar
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* ── Linha do grupo ── */
                      <div className="flex items-center gap-3 px-3 py-3 max-sm:flex-wrap">
                        <span
                          draggable
                          onDragStart={() => setArrastando(i)}
                          onDragEnd={() => setArrastando(null)}
                          title="Arraste para reordenar"
                          className="shrink-0 cursor-grab px-1 text-muted-foreground/60 active:cursor-grabbing"
                        >
                          <GripVertical className="size-4" />
                        </span>

                        <button
                          type="button"
                          onClick={() => setAbertoId(aberto ? null : grupo.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-[15px] font-bold">{grupo.nome}</span>
                            <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-bold',
                              grupo.obrigatorio
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400'
                                : 'bg-muted text-muted-foreground')}>
                              {regraDoGrupo(grupo)}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {resumoDosItens(grupo)}
                          </span>
                        </button>

                        <div className="flex shrink-0 items-center gap-1 max-sm:w-full max-sm:justify-end">
                          {/* Mini-switch: a regra que mais muda é essa, e trocá-la
                              não deveria custar abrir o editor do grupo. */}
                          <button
                            type="button"
                            role="switch" aria-checked={!!grupo.obrigatorio}
                            onClick={() => alternarObrigatorio(grupo)}
                            title="Obrigatório"
                            className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors hover:bg-accent"
                          >
                            <span className="text-[11px] font-semibold text-muted-foreground">Obrigatório</span>
                            <span className={cn('flex h-5 w-[34px] shrink-0 items-center rounded-full p-0.5 transition-colors',
                              grupo.obrigatorio ? 'bg-primary' : 'bg-muted-foreground/25')}>
                              <span className={cn('size-4 rounded-full bg-white shadow-sm transition-transform',
                                grupo.obrigatorio && 'translate-x-[14px]')} />
                            </span>
                          </button>

                          <span className="h-5 w-px bg-border" />

                          <button
                            type="button"
                            onClick={() => setAbertoId(aberto ? null : grupo.id)}
                            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <Pencil className="size-3.5" />
                            {aberto ? 'Fechar' : 'Editar itens'}
                          </button>
                          <button
                            type="button"
                            onClick={() => excluirGrupo(grupo.id)}
                            title="Remover grupo"
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── Painel de itens ── */}
                    {aberto && !editando && (
                      <div className="border-t border-border">
                        <div className="flex items-center justify-between gap-2 px-4 pt-3">
                          <p className="text-[11px] font-extrabold uppercase tracking-[.11em] text-muted-foreground">
                            Itens deste grupo
                          </p>
                          <button
                            type="button"
                            onClick={() => abrirEdicaoGrupo(grupo)}
                            className="text-[11px] font-semibold text-primary hover:underline"
                          >
                            Editar nome e regra
                          </button>
                        </div>

                        {/*
                          AS SUGESTÕES FICAM NA TELA ATÉ ACABAREM.
                          A condição era `grupo.opcoes.length === 0`: a fileira
                          inteira sumia no instante em que a primeira opção
                          entrava. Pra montar "Sem borda, Catupiry, Cheddar" o
                          lojista clicava uma e digitava as outras duas — numa
                          pizzaria, isso repetido por dezenas de produtos é
                          trabalho manual que o sistema estava criando.

                          Cada chip sai da lista quando JÁ EXISTE no grupo
                          (comparando sem caixa e sem espaço, porque "catupiry"
                          digitado à mão é o mesmo item). Assim não vira botão
                          que gera duplicata, e a fileira encolhe conforme o
                          grupo enche — quando a última é usada, ela desaparece
                          sozinha em vez de virar uma linha vazia.
                        */}
                        {(() => {
                          const disponiveis = mesclarSugestoes(
                            (historico?.[grupo.nome] || []).map(x => x.nome),
                            SUGESTOES[grupo.nome]);
                          const faltam = sugestoesFaltantes(disponiveis, grupo.opcoes);
                          if (faltam.length === 0) return null;
                          return (
                            <div className="px-4 pt-3">
                              <p className="mb-2 text-xs text-muted-foreground">
                                {grupo.opcoes.length === 0 ? 'Clique para adicionar:' : 'Adicionar mais:'}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {faltam.map(sug => (
                                  <button
                                    key={sug}
                                    type="button"
                                    onClick={() => adicionarSugestao(grupo.id, sug, grupo.nome)}
                                    className="flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary active:scale-95"
                                  >
                                    <Plus className="size-3" />{sug}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        <div className={cn('space-y-1 px-3', grupo.opcoes.length > 0 ? 'py-2' : 'pt-2')}>
                          {grupo.opcoes.map(o => (
                            editandoOpcaoId === o.id ? (
                              <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-accent/60 px-2 py-2">
                                <Input
                                  autoFocus
                                  value={editandoOpcaoNome}
                                  onChange={e => setEditandoOpcaoNome(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); atualizarOpcao(o.id); } if (e.key === 'Escape') setEditandoOpcaoId(null); }}
                                  className="h-8 flex-1 text-sm"
                                  placeholder="Nome da opção"
                                />
                                <div className="relative w-20 shrink-0">
                                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">+R$</span>
                                  <Input
                                    type="number" step="0.01" min="0" placeholder="0,00"
                                    value={editandoOpcaoPreco}
                                    onChange={e => setEditandoOpcaoPreco(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); atualizarOpcao(o.id); } }}
                                    className="h-8 pl-6 text-xs"
                                  />
                                </div>
                                {/*
                                  SEÇÃO TAMBÉM NA EDIÇÃO.
                                  O campo só existia ao CRIAR a opção — quem já
                                  tinha os sabores cadastrados teria que apagar e
                                  recadastrar os quatro só pra agrupá-los, que é
                                  o trabalho manual que a seção veio evitar.

                                  `list` reaproveita as seções já usadas no grupo,
                                  pra "Doces" e "doces" não virarem dois títulos.
                                */}
                                {(detalhes || o.descricao || o.secao) && (<>
                                <Input
                                  value={editandoOpcaoDesc}
                                  onChange={e => setEditandoOpcaoDesc(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); atualizarOpcao(o.id); } if (e.key === 'Escape') setEditandoOpcaoId(null); }}
                                  placeholder="Ingredientes"
                                  maxLength={160}
                                  className="h-8 w-36 shrink-0 text-xs"
                                  aria-label="Ingredientes deste item"
                                />
                                <Input
                                  value={editandoOpcaoSecao}
                                  onChange={e => setEditandoOpcaoSecao(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); atualizarOpcao(o.id); } if (e.key === 'Escape') setEditandoOpcaoId(null); }}
                                  placeholder="Seção"
                                  maxLength={40}
                                  className="h-8 w-28 shrink-0 text-xs"
                                  list={`secoes-${grupo.id}`}
                                  aria-label="Seção deste item"
                                />
                                </>)}
                                {/*
                                  A FOTO OCUPA A LINHA INTEIRA, abaixo dos campos.
                                  O ImageUpload tem área de arrastar e três botões;
                                  espremido entre nome e preço ele viraria o
                                  elemento dominante de uma linha que é sobre
                                  texto. Aqui embaixo, quem só quer corrigir o
                                  nome não passa por ele.
                                */}
                                <div className="w-full">
                                  <ImageUpload
                                    value={editandoOpcaoImg}
                                    onChange={setEditandoOpcaoImg}
                                    label="Foto do sabor (opcional)"
                                  />
                                </div>
                                <button type="button" onClick={() => atualizarOpcao(o.id)} className="shrink-0 rounded-lg bg-primary p-1.5 text-primary-foreground transition-colors hover:bg-primary/90">
                                  <Check className="size-3.5" />
                                </button>
                                <button type="button" onClick={() => setEditandoOpcaoId(null)} className="shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent">
                                  <X className="size-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div
                                key={o.id}
                                className={cn('group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-accent/40', !o.disponivel && 'opacity-45')}
                              >
                                {/* Miniatura na lista: dá pra conferir quais sabores
                                    já têm foto sem abrir um por um. */}
                                {o.imagem && (
                                  <img src={o.imagem} alt="" loading="lazy"
                                    className="size-8 shrink-0 rounded-md border border-border/60 object-cover" />
                                )}
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 text-left"
                                  onClick={() => { setEditandoOpcaoId(o.id); setEditandoOpcaoNome(o.nome); setEditandoOpcaoPreco(o.preco_adicional_centavos > 0 ? String(o.preco_adicional_centavos / 100) : ''); setEditandoOpcaoSecao(o.secao || ''); setEditandoOpcaoDesc(o.descricao || ''); setEditandoOpcaoImg(o.imagem || ''); }}
                                >
                                  <span className="block truncate text-sm font-medium">{o.nome}</span>
                                  {o.descricao && (
                                    <span className="block truncate text-[11px] text-muted-foreground">{o.descricao}</span>
                                  )}
                                </button>
                                {/* A seção precisa ser VISÍVEL na lista: sem isso não
                                    dá pra conferir o agrupamento sem abrir cada item. */}
                                {o.secao && (
                                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                                    {o.secao}
                                  </span>
                                )}
                                {o.preco_adicional_centavos > 0 && (
                                  <span className="shrink-0 text-xs font-bold text-primary">+ {brl(o.preco_adicional_centavos)}</span>
                                )}
                                {/*
                                  QUANTOS SABORES ESTE TAMANHO LIBERA.
                                  O CONTROLE QUE FALTAVA: a coluna existia, a
                                  função de gravar existia (`definirSabores`) e
                                  NINGUÉM a chamava — era código morto. Sem
                                  este campo, `opcoes_itens.sabores` ficava
                                  inalcançável pelo painel, `saboresLiberados`
                                  sempre devolvia 0, e a pizza de 2 e 3 sabores
                                  não funcionava mesmo com tudo o resto no lugar.

                                  Só no grupo de TAMANHO: em borda ou adicional
                                  a pergunta não existe.

                                  Vazio = não define nada, e aí o limite cai no
                                  máximo do grupo de sabores. É o estado de todo
                                  tamanho já cadastrado — ninguém muda de preço
                                  nem de regra por causa deste campo aparecer.
                                */}
                                {grupo.papel === 'tamanho' && (
                                  <span className="flex shrink-0 items-center gap-1" title="Quantos sabores este tamanho permite">
                                    <Input
                                      type="number" min="1" max="8" placeholder="—"
                                      defaultValue={o.sabores ? String(o.sabores) : ''}
                                      onBlur={e => {
                                        const n = Number(e.target.value) || 0;
                                        if (n !== (o.sabores || 0)) definirSabores(o, n);
                                      }}
                                      className="h-7 w-12 px-1 text-center text-xs"
                                      aria-label={`Sabores liberados por ${o.nome}`}
                                    />
                                    <span className="text-[10.5px] text-muted-foreground">sabores</span>
                                  </span>
                                )}
                                <Pencil
                                  className="size-3.5 shrink-0 cursor-pointer text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60"
                                  onClick={() => { setEditandoOpcaoId(o.id); setEditandoOpcaoNome(o.nome); setEditandoOpcaoPreco(o.preco_adicional_centavos > 0 ? String(o.preco_adicional_centavos / 100) : ''); setEditandoOpcaoSecao(o.secao || ''); setEditandoOpcaoDesc(o.descricao || ''); setEditandoOpcaoImg(o.imagem || ''); }}
                                />
                                <button type="button" onClick={() => toggleDisponivel(o)} title={o.disponivel ? 'Desativar' : 'Ativar'} className="shrink-0">
                                  {o.disponivel ? <ToggleRight className="size-5 text-primary" /> : <ToggleLeft className="size-5 text-muted-foreground" />}
                                </button>
                                <button type="button" onClick={() => excluirOpcao(o.id)} className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-destructive">
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            )
                          ))}
                        </div>

                        <div className="border-t border-border/60 px-3 py-3">
                          <div className="flex items-center gap-2 max-sm:flex-wrap">
                            <Input
                              id={`opcao-nome-${grupo.id}`}
                              placeholder={SUGESTOES[grupo.nome]?.[0] ? `Ex.: ${SUGESTOES[grupo.nome][0]}…` : 'Nome da opção…'}
                              value={opcaoForm(grupo.id).nome}
                              onChange={e => setOpcaoForm(grupo.id, 'nome', e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), criarOpcao(grupo.id))}
                              className="h-10 flex-1 text-sm max-sm:w-full max-sm:flex-none"
                            />
                            <div className="relative w-24 shrink-0">
                              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">+R$</span>
                              <Input
                                type="number" step="0.01" min="0" placeholder="0,00"
                                value={opcaoForm(grupo.id).preco}
                                onChange={e => setOpcaoForm(grupo.id, 'preco', e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), criarOpcao(grupo.id))}
                                className="h-10 pl-7 text-sm"
                              />
                            </div>
                            <Button
                              type="button"
                              className="h-10 shrink-0 px-4"
                              onClick={() => criarOpcao(grupo.id)}
                              disabled={!opcaoForm(grupo.id).nome.trim()}
                            >
                              <Plus className="size-4" /> Adicionar
                            </Button>
                          </div>

                          {/*
                            SEÇÃO — separa sabor por faixa ('Tradicionais',
                            'Especiais', 'Doces') DENTRO do grupo.

                            Não são grupos separados de propósito: o limite de
                            sabores vem do tamanho e o preço cobra só o maior
                            acréscimo. Três grupos deixariam a pizza de 3 sabores
                            aceitar 3 de cada, e somariam três "maiores".

                            O campo fica embaixo, não ao lado do nome: a maioria
                            dos grupos (bordas, adicionais, bebida) não usa
                            seção, e um campo a mais na linha principal cobraria
                            atenção de todo mundo por causa de um caso.
                          */}
                          {/*
                            INGREDIENTES. Uma linha, embaixo do nome do sabor na
                            tela do cliente — é o que faz "Portuguesa" virar uma
                            escolha informada em vez de um chute.

                            Junto da seção e não na linha principal: nem todo
                            grupo precisa (borda, bebida), e mais um campo na
                            linha de cima cobraria atenção de todos por causa de
                            um caso.
                          */}
                          {detalhes ? (<>
                          <div className="mt-2 flex items-center gap-2">
                            <label htmlFor={`opcao-desc-${grupo.id}`} className="shrink-0 text-[11px] text-muted-foreground">
                              Ingredientes
                            </label>
                            <Input
                              id={`opcao-desc-${grupo.id}`}
                              placeholder="opcional — ex.: molho, mussarela, presunto, ovo"
                              value={opcaoForm(grupo.id).descricao}
                              onChange={e => setOpcaoForm(grupo.id, 'descricao', e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), criarOpcao(grupo.id))}
                              maxLength={160}
                              className="h-8 flex-1 text-xs"
                            />
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <label htmlFor={`opcao-secao-${grupo.id}`} className="shrink-0 text-[11px] text-muted-foreground">
                              Seção
                            </label>
                            <Input
                              id={`opcao-secao-${grupo.id}`}
                              placeholder="opcional — ex.: Tradicionais, Especiais, Doces"
                              value={opcaoForm(grupo.id).secao}
                              onChange={e => setOpcaoForm(grupo.id, 'secao', e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), criarOpcao(grupo.id))}
                              maxLength={40}
                              className="h-8 flex-1 text-xs"
                              list={`secoes-${grupo.id}`}
                            />
                            {/*
                              As seções que este grupo já usa, como autocomplete.
                              Sem isso, "Tradicionais" e "tradicionais" viram duas
                              seções na tela do cliente por causa de uma letra.
                            */}
                            <datalist id={`secoes-${grupo.id}`}>
                              {[...new Set(grupo.opcoes.map(o => (o.secao || '').trim()).filter(Boolean))]
                                .map(sec => <option key={sec} value={sec} />)}
                            </datalist>
                          </div>
                          </>) : (
                            <button
                              type="button"
                              onClick={() => setDetalhesAbertos(d => ({ ...d, [grupo.id]: true }))}
                              className="mt-2 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-primary"
                            >
                              + ingredientes e seção
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 2. Modelos prontos */}
          {novoGrupo === null && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="shrink-0 text-[12px] font-extrabold uppercase tracking-[.11em] text-muted-foreground">
                  {grupos.length === 0
                    ? `Modelos prontos${produto.categoria ? ` para ${produto.categoria}` : ''}`
                    : 'Adicionar mais um grupo'}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>

              {grupos.length === 0 && !isLoading && (
                <div className="mx-auto max-w-md pb-1 text-center">
                  <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10">
                    <Layers className="size-6 text-primary" />
                  </div>
                  <p className="text-[19px] font-extrabold">Quais opções este produto tem?</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Comece por um modelo — dá pra ajustar tudo depois.
                  </p>
                </div>
              )}

              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
                {modelos.map(t => (
                  <button
                    key={t.nome}
                    type="button"
                    disabled={salvandoGrupo}
                    onClick={() => criarGrupoComDados({
                      nome: t.nome, tipo: t.tipo, obrigatorio: t.obrigatorio,
                      max_escolhas: t.max_escolhas,
                      papel: t.papel, modo_preco: t.modo_preco,
                    })}
                    className="group flex flex-col gap-1.5 rounded-2xl border border-border bg-card p-3.5 text-left shadow-sm transition-all hover:-translate-y-px hover:border-primary hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="flex w-full items-start justify-between gap-2">
                      <span className="text-[14.5px] font-bold">{t.nome}</span>
                      <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <Plus className="size-3.5 text-primary" />
                      </span>
                    </span>
                    <span className="text-[13px] leading-snug text-muted-foreground">{t.dica}</span>
                    <span className="mt-0.5 w-fit rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold text-muted-foreground">
                      {regraDoModelo(t)}
                    </span>
                  </button>
                ))}

                <button
                  type="button"
                  disabled={salvandoGrupo}
                  onClick={() => setNovoGrupo({ nome: '', tipo: 'multiplo', obrigatorio: false, max_escolhas: '', papel: '', modo_preco: 'somar' })}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border p-3.5 text-center text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="size-4" />
                  <span className="text-[14.5px] font-bold">Criar grupo do zero</span>
                  <span className="text-[13px] leading-snug">Você define o nome e a regra</span>
                </button>
              </div>
            </div>
          )}

          {/* Formulário de grupo do zero */}
          {novoGrupo !== null && (
            <Card className="border-primary/40">
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">Novo grupo</span>
                  <button type="button" onClick={() => setNovoGrupo(null)} className="rounded-lg p-1 hover:bg-accent">
                    <X className="size-4" />
                  </button>
                </div>
                <div>
                  <Label htmlFor="grupo-nome">Nome do grupo *</Label>
                  <Input
                    id="grupo-nome"
                    autoFocus
                    placeholder="Ex.: Tamanho, Borda, Adicionais, Ponto da carne…"
                    value={novoGrupo.nome}
                    onChange={e => setNovoGrupo(g => g && ({ ...g, nome: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), criarGrupoManual())}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex gap-3">
                    {(['unico', 'multiplo'] as const).map(t => (
                      <label key={t} className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="radio"
                          name={`tipo-grupo-${produto.id}`}
                          checked={novoGrupo.tipo === t}
                          onChange={() => setNovoGrupo(g => g && ({ ...g, tipo: t }))}
                          className="accent-primary"
                        />
                        <span className="text-sm">{t === 'unico' ? 'Escolha única' : 'Múltipla escolha'}</span>
                      </label>
                    ))}
                  </div>
                  {novoGrupo.tipo === 'multiplo' && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Máx.:</span>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0 = sem limite"
                        value={novoGrupo.max_escolhas}
                        onChange={e => setNovoGrupo(g => g && ({ ...g, max_escolhas: e.target.value }))}
                        className="h-8 w-28 text-sm"
                      />
                    </div>
                  )}
                </div>

                <label className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={novoGrupo.obrigatorio}
                    onChange={e => setNovoGrupo(g => g && ({ ...g, obrigatorio: e.target.checked }))}
                    className="size-4 rounded accent-primary"
                  />
                  <span className="text-sm">Obrigatório</span>
                  <span className="text-xs text-muted-foreground">(cliente deve selecionar antes de adicionar ao carrinho)</span>
                </label>

                <div className="flex gap-2 pt-1">
                  <Button type="button" onClick={criarGrupoManual} disabled={!novoGrupo.nome.trim()} className="flex-1">
                    <Plus className="size-4" /> Criar grupo
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setNovoGrupo(null)}>
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
    </CascaGrupos>
  );
}
