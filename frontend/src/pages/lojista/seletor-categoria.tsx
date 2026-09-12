/**
 * ESCOLHER CATEGORIA (e subcategoria) NO CADASTRO DE PRODUTO.
 *
 * POR QUE SAIU A NUVEM DE CHIPS. Com 40 categorias os chips ocupavam sete
 * linhas — cerca de 210 px dentro de um corpo de modal com ~310 px de altura
 * útil. O lojista rolava meia tela de chips antes de chegar ao preço, e achar
 * "SORVETES" era varredura visual. Campo com busca troca a varredura por três
 * letras digitadas, e devolve a tela para o resto do cadastro.
 *
 * A CONTAGEM POR CATEGORIA É PARTE DA ESCOLHA, não enfeite: é ela que separa
 * "SALGADOS 12" de "SALGADINHOS 7" — dois nomes que, sem o número, o lojista só
 * distingue abrindo cada uma.
 *
 * O PAINEL É EM FLUXO, E ISSO NÃO É DETALHE DE ESTILO. O corpo do modal é o
 * scroller (`overflow-y: auto`); um painel `absolute` fica recortado por ele e
 * a busca e o fim da lista viram inalcançáveis. Aberto, o campo cresce e o
 * modal rola até ele — que é o comportamento que funciona em qualquer altura
 * de tela, inclusive no celular.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Search, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface OpcaoCategoria {
  nome: string;
  /** Quantos produtos usam. É o que distingue nomes parecidos. */
  itens: number;
}

interface Props {
  label: string;
  obrigatorio?: boolean;
  valor: string;
  opcoes: OpcaoCategoria[];
  onChange: (valor: string) => void;
  /** Cria de verdade (grava no servidor). Sem isto, o rodapé não aparece. */
  onCriar?: (nome: string) => Promise<void>;
  /**
   * Apaga de verdade. `destino` vem preenchido quando há produtos dentro — a
   * decisão de para onde eles vão é de quem apaga, nunca minha.
   */
  onApagar?: (nome: string, destino: string) => Promise<void>;
  /** Desligado (ex.: subcategoria antes de escolher a categoria). */
  desabilitado?: boolean;
  textoDesabilitado?: string;
  placeholderVazio: string;
  placeholderBusca: string;
  rotuloNovo: string;
  /** Linha de apoio abaixo do campo. */
  apoio?: string;
  vazioPermitido?: string;
}

const LINHA = 'flex h-[38px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13.5px] transition-colors';

export function SeletorCategoria({
  label, obrigatorio = false, valor, opcoes, onChange, onCriar, onApagar,
  desabilitado = false, textoDesabilitado = 'Nenhuma nesta categoria',
  placeholderVazio, placeholderBusca, rotuloNovo, apoio, vazioPermitido,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [ocupado, setOcupado] = useState(false);
  /** Qual linha está no meio da pergunta "apagar?". Vazio = nenhuma. */
  const [apagando, setApagando] = useState('');
  const [erro, setErro] = useState('');
  const caixa = useRef<HTMLDivElement>(null);

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return opcoes;
    return opcoes.filter(o => o.nome.toLowerCase().includes(t));
  }, [opcoes, busca]);

  const selecionada = opcoes.find(o => o.nome === valor);
  /* Valor que ainda não é categoria de ninguém (nome digitado num produto que
     nunca foi salvo). Aparece como escolhido, mas sem contagem. */
  const foraDaLista = !!valor && !selecionada;

  /* Fecha no clique fora e no Esc: as duas saídas que a pessoa tenta primeiro. */
  useEffect(() => {
    if (!aberto) return;
    const foraDaCaixa = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) fechar();
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
    document.addEventListener('mousedown', foraDaCaixa);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', foraDaCaixa);
      document.removeEventListener('keydown', tecla);
    };
  }, [aberto]);

  function fechar() {
    setAberto(false);
    setBusca('');
    setApagando('');
    setErro('');
  }

  function escolher(nome: string) {
    onChange(nome);
    fechar();
  }

  async function criar() {
    const nome = busca.trim();
    if (!nome || !onCriar) return;
    setOcupado(true);
    setErro('');
    try {
      await onCriar(nome);
      escolher(nome);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu pra criar.');
    } finally {
      setOcupado(false);
    }
  }

  async function apagar(nome: string, destino: string) {
    if (!onApagar) return;
    setOcupado(true);
    setErro('');
    try {
      await onApagar(nome, destino);
      /* Quem apagou a categoria escolhida fica sem escolha — e é melhor o campo
         dizer isso vazio do que continuar mostrando um nome que não existe. */
      if (valor === nome) onChange(destino || '');
      setApagando('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu pra apagar.');
    } finally {
      setOcupado(false);
    }
  }

  const emApagamento = apagando ? opcoes.find(o => o.nome === apagando) : undefined;

  return (
    <div ref={caixa}>
      <div className="mb-1.5 flex items-baseline gap-2">
        {/*
          `whitespace-nowrap` no rótulo: sem ele o asterisco do obrigatório cai
          para a segunda linha quando a coluna aperta, e "Categoria" com um "*"
          solto embaixo parece defeito.
        */}
        <span className="whitespace-nowrap text-[13.5px] font-semibold text-foreground/80">
          {label}{obrigatorio && ' *'}
          {!obrigatorio && <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>}
        </span>
        {!!opcoes.length && (
          <span className="ml-auto truncate text-[12px] text-muted-foreground">
            {opcoes.length} cadastrada{opcoes.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <button
        type="button"
        disabled={desabilitado}
        onClick={() => (aberto ? fechar() : setAberto(true))}
        aria-expanded={aberto}
        aria-haspopup="listbox"
        className={cn(
          'flex h-12 w-full items-center gap-2 rounded-[10px] border bg-background px-3.5 text-left transition-colors',
          aberto ? 'border-primary' : 'border-input',
          desabilitado && 'cursor-not-allowed bg-muted/50 text-muted-foreground',
        )}
      >
        <span className={cn('flex-1 truncate text-[15.5px]', !valor && 'text-muted-foreground')}>
          {desabilitado ? textoDesabilitado : (valor || placeholderVazio)}
        </span>
        {!desabilitado && selecionada && (
          <span className="shrink-0 text-[12.5px] text-muted-foreground">
            {selecionada.itens} {selecionada.itens === 1 ? 'item' : 'itens'}
          </span>
        )}
        {!desabilitado && foraDaLista && (
          <span className="shrink-0 text-[12.5px] text-primary">nova</span>
        )}
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', aberto && 'rotate-180')} />
      </button>

      {aberto && !desabilitado && (
        <div className="mt-1.5 rounded-xl border border-input bg-card shadow-[0_10px_26px_-16px_rgba(24,24,27,0.22)]">
          {emApagamento || apagando ? (
            /*
              A PERGUNTA DO APAGAR FICA NO MESMO PAINEL, e não num segundo
              diálogo: o que está em jogo — quantos produtos e para onde vão —
              cabe aqui, e tirar a pessoa da tela para decidir isso é onde a
              decisão vira clique no escuro.
            */
            <div className="p-3">
              <p className="text-[13.5px] font-bold">Apagar “{apagando}”?</p>
              {emApagamento && emApagamento.itens > 0 ? (
                <>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                    {emApagamento.itens} produto{emApagamento.itens > 1 ? 's' : ''} {emApagamento.itens > 1 ? 'estão' : 'está'} nela.
                    Escolha para onde {emApagamento.itens > 1 ? 'eles vão' : 'ele vai'} — a subcategoria deles é limpa na mudança.
                  </p>
                  <div className="mt-2 max-h-[180px] overflow-y-auto">
                    {opcoes.filter(o => o.nome !== apagando).map(o => (
                      <button
                        key={o.nome}
                        type="button"
                        disabled={ocupado}
                        onClick={() => apagar(apagando, o.nome)}
                        className={cn(LINHA, 'hover:bg-accent')}
                      >
                        <span className="flex-1 truncate">{o.nome}</span>
                        <span className="shrink-0 text-[12px] text-muted-foreground">{o.itens}</span>
                      </button>
                    ))}
                    {opcoes.filter(o => o.nome !== apagando).length === 0 && (
                      <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">
                        Não há outra categoria para receber os produtos. Crie uma antes.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[12.5px] text-muted-foreground">Nenhum produto usa esta categoria.</span>
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => apagar(apagando, '')}
                    className="ml-auto rounded-lg bg-destructive px-3 py-1.5 text-[12.5px] font-semibold text-destructive-foreground disabled:opacity-60"
                  >
                    Apagar
                  </button>
                </div>
              )}
              {erro && <p className="mt-2 text-[12.5px] font-semibold text-destructive">{erro}</p>}
              <button
                type="button"
                onClick={() => { setApagando(''); setErro(''); }}
                className="mt-2 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-border px-3">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder={placeholderBusca}
                  className="h-[38px] w-full bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
                />
                {!!busca && (
                  <button type="button" onClick={() => setBusca('')} className="shrink-0 text-muted-foreground hover:text-foreground">
                    <X className="size-4" />
                  </button>
                )}
              </div>

              <div className="max-h-[252px] overflow-y-auto p-1.5">
                {vazioPermitido && !busca && (
                  <button type="button" onClick={() => escolher('')} className={cn(LINHA, 'hover:bg-accent')}>
                    <span className="w-[15px] shrink-0">{!valor && <Check className="size-[15px] text-primary" strokeWidth={3} />}</span>
                    <span className="flex-1 truncate text-muted-foreground">{vazioPermitido}</span>
                  </button>
                )}
                {filtradas.map(o => {
                  const ativa = o.nome === valor;
                  return (
                    <div key={o.nome} className="group flex items-center">
                      <button
                        type="button"
                        onClick={() => escolher(o.nome)}
                        className={cn(LINHA, 'flex-1', ativa ? 'bg-primary/[0.07] font-bold' : 'hover:bg-accent')}
                      >
                        {/*
                          O SLOT DO CHECK É FIXO (15 px) mesmo quando vazio: sem
                          ele, escolher uma linha empurra o texto de todas as
                          outras para o lado, e a lista pisca a cada clique.
                        */}
                        <span className="w-[15px] shrink-0">
                          {ativa && <Check className="size-[15px] text-primary" strokeWidth={3} />}
                        </span>
                        <span className="flex-1 truncate">{o.nome}</span>
                        <span className="shrink-0 text-[12px] text-muted-foreground">{o.itens}</span>
                      </button>
                      {onApagar && (
                        <button
                          type="button"
                          title={`Apagar ${o.nome}`}
                          aria-label={`Apagar ${o.nome}`}
                          onClick={() => { setApagando(o.nome); setErro(''); }}
                          /*
                            VISÍVEL NO CELULAR, DISCRETA NO DESKTOP. Esconder
                            atrás de `hover` deixa a lixeira inalcançável em
                            tela de toque — não existe hover no dedo, e a ação
                            simplesmente não existiria para quem usa o painel
                            no telefone. A partir de `sm:` ela some até o mouse
                            chegar, que é onde o hover funciona de verdade.
                          */
                          className="ml-1 shrink-0 rounded-lg p-2 text-muted-foreground/60 transition-opacity hover:text-destructive focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {!filtradas.length && (
                  <p className="px-2.5 py-3 text-[13px] text-muted-foreground">
                    Nenhuma {label.toLowerCase()} com esse nome.
                  </p>
                )}
              </div>

              {onCriar && (
                <div className="border-t border-border p-1.5">
                  <button
                    type="button"
                    disabled={ocupado || (!!busca.trim() && filtradas.some(o => o.nome.toLowerCase() === busca.trim().toLowerCase()))}
                    onClick={() => (busca.trim() ? criar() : setBusca(''))}
                    className={cn(LINHA, 'font-semibold text-primary hover:bg-accent disabled:opacity-50')}
                  >
                    <Plus className="size-4 shrink-0" />
                    {/* O rótulo VIRA a ação com o texto digitado: quem procurou
                        "sorv" e não achou quer criar "sorv", não abrir outro campo. */}
                    <span className="truncate">{busca.trim() ? `Criar “${busca.trim()}”` : rotuloNovo}</span>
                  </button>
                  {erro && <p className="px-2.5 pb-1 text-[12.5px] font-semibold text-destructive">{erro}</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {apoio && <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{apoio}</p>}
    </div>
  );
}
