/**
 * TREINAMENTO — o lugar onde todo o material mora.
 *
 * Os `?` espalhados resolvem a dúvida NO MOMENTO em que ela aparece, e é assim
 * que a maioria das perguntas morre. Mas eles só existem para quem já está na
 * tela certa. Quem quer aprender antes, quem vai treinar um funcionário novo, ou
 * quem lembra que "tinha uma explicação sobre combo" e não lembra onde — esse
 * não tem por onde começar.
 *
 * Esta tela é esse começo, e a COBERTURA É TOTAL: toda tela do painel tem
 * entrada aqui. Ajuda pela metade ensina o lojista a não procurar.
 *
 * Ela NÃO duplica conteúdo: lê o mesmo catálogo `AJUDA` e usa o mesmo `CorpoAjuda`
 * do painel lateral. Duplicar o texto seria criar uma segunda verdade que
 * envelhece sozinha.
 */
import { useMemo, useState } from 'react';
import { HelpCircle, Printer, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AJUDA, CorpoAjuda, type ConteudoAjuda } from '@/components/ui/ajuda';

/**
 * A ordem é a de quem está começando, não a alfabética.
 *
 * Cada seção diz ONDE a coisa fica no painel: material que não leva à tela
 * obriga a pessoa a procurar duas vezes.
 */
const SECOES: Array<{ titulo: string; onde: string; chaves: string[] }> = [
  /*
   * OS TUTORIAIS VÊM PRIMEIRO, e separados da referência.
   *
   * São coisas diferentes: tutorial responde "como faço", referência responde
   * "o que é isto". Quem chega ao Treinamento quase sempre quer a primeira —
   * misturar as duas listas obrigaria a garimpar.
   */
  {
    titulo: 'Passo a passo',
    onde: 'as tarefas do dia a dia, na ordem de executar',
    chaves: [
      'tut-produto', 'tut-combo', 'tut-pdv', 'tut-mesa',
      'tut-pedido', 'tut-entregador', 'tut-rotas', 'tut-caixa', 'tut-pagamento',
    ],
  },
  {
    titulo: '1. Começar',
    onde: 'Configurações → Dados e Horário',
    chaves: ['loja-dados', 'horario-fechar'],
  },
  {
    titulo: '2. Montar o cardápio',
    onde: 'Produtos, e Mais → Categorias',
    chaves: ['produto-cadastrar', 'produtos-lista', 'produto-item', 'categorias', 'produtos-ordem'],
  },
  {
    titulo: '3. Complementos e combos',
    onde: 'Produtos → cadastro do item',
    chaves: [
      'complementos-grupo', 'complementos-preco', 'complementos-tamanho',
      'complementos-soltar', 'composicao-combo', 'produto-config',
    ],
  },
  {
    titulo: '4. Vender',
    onde: 'Vendas → Balcão, Mesas e Caixa · Pedidos · Cozinha',
    chaves: ['balcao-atalhos', 'mesa-fluxo', 'caixa-turno', 'pedidos-fluxo', 'kds'],
  },
  {
    titulo: '5. Dinheiro',
    onde: 'Configurações → Entrega, Pagamentos e Fiscal · Mais → Cupons e Relatórios',
    chaves: ['entrega-taxa', 'pagamentos', 'fiscal', 'cupons', 'relatorios', 'produto-fiscal'],
  },
  {
    titulo: '6. Aparência, equipe e acesso',
    onde: 'Configurações → Visual, Banners, WhatsApp, Impressão, Usuários, Segurança',
    chaves: [
      'visual', 'banners', 'whatsapp', 'impressao',
      'entregadores', 'usuarios', 'seguranca', 'clientes', 'avaliacoes',
    ],
  },
];

function Cartao({ item, aberto, onAlternar }: {
  item: ConteudoAjuda; aberto: boolean; onAlternar: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={onAlternar}
        className="flex w-full items-start gap-3 p-4 text-left hover:bg-accent/40"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-tight">{item.titulo}</p>
          {/* O "pra que serve" aparece FECHADO, porque é a resposta que a pessoa
              costuma estar procurando ao varrer a lista. */}
          {item.paraQue && (
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{item.paraQue}</p>
          )}
        </div>
        <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
          aberto && 'rotate-180')} />
      </button>

      {aberto && (
        <div className="space-y-4 border-t border-border p-4">
          <CorpoAjuda item={item} />
        </div>
      )}
    </div>
  );
}

export function AjudaLoja() {
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [busca, setBusca] = useState('');

  const termo = busca.trim().toLowerCase();

  /*
   * A BUSCA OLHA O TEXTO INTEIRO, não só o título.
   *
   * Quem procura ajuda digita o sintoma, não o nome da tela: "reabriu sozinha",
   * "sabor errado", "não imprime". Buscar só em título deixaria justamente
   * essas pessoas sem resposta.
   */
  const secoesFiltradas = useMemo(() => {
    if (!termo) return SECOES;
    return SECOES
      .map(s => ({
        ...s,
        chaves: s.chaves.filter(c => {
          const i = AJUDA[c];
          if (!i) return false;
          return [i.titulo, i.paraQue, i.resumo, i.cuidado]
            .filter(Boolean).join(' ').toLowerCase().includes(termo);
        }),
      }))
      .filter(s => s.chaves.length > 0);
  }, [termo]);

  const achados = secoesFiltradas.reduce((n, s) => n + s.chaves.length, 0);

  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <HelpCircle className="size-5 text-primary" /> Treinamento
        </h2>
        <p className="mt-1 max-w-[640px] text-sm leading-relaxed text-muted-foreground">
          Comece pelo <b>passo a passo</b>: são as tarefas do dia a dia, com a
          ordem exata de executar. Abaixo dele, cada tela do painel explicada —
          para que serve, como usar e onde se erra. O mesmo conteúdo aparece no
          <b> ?</b> ao lado de cada tela, na hora que a dúvida surge.
        </p>
      </div>

      {/*
        A COLA DO BALCÃO EM PRIMEIRO, e destacada.
        É a única peça que se usa COM O CLIENTE NA FRENTE — e por isso a única
        que precisa sair da tela e virar papel. Enterrá-la no meio da lista seria
        tratá-la como as outras, que são para ler sentado.
      */}
      <a
        href="/ajuda/cola-balcao.html" target="_blank" rel="noreferrer"
        className="flex items-center gap-4 rounded-2xl border border-primary/30 bg-primary/[0.04] p-4 hover:bg-primary/[0.07]"
      >
        <Printer className="size-6 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-tight">Cola do balcão — imprima e cole no caixa</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
            Uma folha A4 com o essencial para quem atende: atalhos do teclado,
            sangria, mesa e o que fazer quando a impressora para.
          </p>
        </div>
      </a>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por sintoma: reabriu sozinha, não imprime, preço errado…"
          className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3 text-[14px] placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/[0.14]"
        />
      </div>

      {termo && (
        <p className="-mt-2 text-[12.5px] text-muted-foreground">
          {achados === 0
            ? 'Nada encontrado. Tente outra palavra — ou diga o que faltou, para eu escrever.'
            : `${achados} ${achados === 1 ? 'assunto' : 'assuntos'} para “${busca.trim()}”.`}
        </p>
      )}

      {secoesFiltradas.map(s => (
        <section key={s.titulo}>
          <div className="mb-2">
            <h3 className={cn('text-[13px] font-bold uppercase tracking-wider',
              /* O bloco de tutoriais ganha a cor da marca: ele é a resposta pra
                 maioria de quem chega, e precisa se distinguir da referência. */
              s.titulo === 'Passo a passo' ? 'text-primary' : 'text-muted-foreground')}>
              {s.titulo}
            </h3>
            <p className="text-[12px] text-muted-foreground/60">{s.onde}</p>
          </div>
          <div className="space-y-2">
            {s.chaves.map(c => AJUDA[c] && (
              <Cartao
                key={c}
                item={AJUDA[c]}
                /* Aberto automaticamente quando há busca: quem filtrou já disse
                   o que quer ler, e obrigar um clique a mais é atrito puro. */
                aberto={!!termo || !!abertos[c]}
                onAlternar={() => setAbertos(a => ({ ...a, [c]: !a[c] }))}
              />
            ))}
          </div>
        </section>
      ))}

      <p className="pt-2 text-[12.5px] leading-relaxed text-muted-foreground">
        Está faltando alguma explicação? Diga qual — material de ajuda serve para
        a dúvida que existe, não para a que imaginamos.
      </p>
    </div>
  );
}
