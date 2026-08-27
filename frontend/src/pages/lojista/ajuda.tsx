/**
 * CENTRAL DE AJUDA — o lugar onde o treinamento mora.
 *
 * Os `?` espalhados resolvem a dúvida NO MOMENTO em que ela aparece, e é assim
 * que a maioria das perguntas morre. Mas eles têm um limite: só existem para
 * quem já está na tela certa. Quem quer aprender antes, quem vai treinar um
 * funcionário novo, ou quem lembra que "tinha uma explicação sobre combo" e não
 * lembra onde — esse não tem por onde começar.
 *
 * Esta tela é esse começo. Ela NÃO duplica conteúdo: lê o mesmo catálogo
 * `AJUDA`, então o que muda lá muda aqui. Duplicar o texto seria criar uma
 * segunda verdade que envelhece sozinha.
 */
import { useState } from 'react';
import { HelpCircle, Printer, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AJUDA, type ConteudoAjuda } from '@/components/ui/ajuda';

/**
 * A ordem é a de quem está começando, não a alfabética.
 *
 * Cada bloco diz ONDE a coisa fica no painel: material de treinamento que não
 * leva à tela obriga a pessoa a procurar duas vezes.
 */
const SECOES: Array<{ titulo: string; descricao: string; chaves: string[] }> = [
  {
    titulo: 'Montar o cardápio',
    descricao: 'Produtos → cadastro do item',
    chaves: ['complementos-grupo', 'complementos-preco', 'complementos-soltar', 'composicao-combo'],
  },
  {
    titulo: 'Organizar a vitrine',
    descricao: 'Produtos → lista, e Configurações → Horário',
    chaves: ['produtos-ordem', 'horario-fechar'],
  },
  {
    titulo: 'Atender',
    descricao: 'Vendas → Balcão, e Mesas',
    chaves: ['balcao-atalhos', 'mesa-fluxo'],
  },
];

function Cartao({ item }: { item: ConteudoAjuda }) {
  /* Fechado por padrão: a lista inteira aberta seria uma parede de imagens, e a
     pessoa veio procurar UMA coisa. O resumo já aparece fechado, então muitas
     vezes ela nem precisa abrir. */
  const [aberto, setAberto] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setAberto(a => !a)}
        className="flex w-full items-start gap-3 p-4 text-left hover:bg-accent/40"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-tight">{item.titulo}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{item.resumo}</p>
        </div>
        {(item.imagem || item.video) && (
          <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
            aberto && 'rotate-180')} />
        )}
      </button>

      {aberto && (item.imagem || item.video || item.imprimivel) && (
        <div className="space-y-3 border-t border-border p-4">
          {item.imagem && (
            <img src={item.imagem} alt={item.titulo}
              className="w-full rounded-xl border border-border bg-white" />
          )}
          {item.imprimivel && (
            <a href={item.imprimivel} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-[14px] font-semibold hover:bg-accent">
              <Printer className="size-4" /> Folha para imprimir
            </a>
          )}
          {item.video && (
            <a href={item.video} target="_blank" rel="noreferrer"
              className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-[14px] font-semibold hover:bg-accent">
              Ver o vídeo
              {item.duracao && <span className="text-[12px] font-normal text-muted-foreground">{item.duracao}</span>}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function AjudaLoja() {
  return (
    <div className="mx-auto max-w-[880px] space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <HelpCircle className="size-5 text-primary" /> Treinamento
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          O mesmo conteúdo aparece no <b>?</b> ao lado de cada tela, na hora que
          a dúvida surge. Aqui está tudo junto, para aprender antes ou treinar
          alguém.
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
          <p className="text-[15px] font-bold leading-tight">Cola do balcão</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Uma folha A4 para imprimir e colar ao lado do monitor: atalhos, caixa,
            mesa e o que fazer quando a impressora para.
          </p>
        </div>
      </a>

      {SECOES.map(s => (
        <section key={s.titulo}>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-[13px] font-bold uppercase tracking-wider text-muted-foreground">{s.titulo}</h3>
            <span className="text-[12px] text-muted-foreground/60">{s.descricao}</span>
          </div>
          <div className="space-y-2">
            {s.chaves.map(c => AJUDA[c] && <Cartao key={c} item={AJUDA[c]} />)}
          </div>
        </section>
      ))}

      <p className="pt-2 text-[12.5px] text-muted-foreground">
        Está faltando alguma explicação? Diga qual — material de ajuda serve para
        a dúvida que existe, não para a que imaginamos.
      </p>
    </div>
  );
}
