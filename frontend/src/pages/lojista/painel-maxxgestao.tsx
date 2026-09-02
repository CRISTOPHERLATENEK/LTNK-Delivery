/**
 * INTEGRAÇÃO COM O MAXX GESTÃO (Meu ERP Online).
 *
 * Card próprio, separado do TEF de propósito: são dois caminhos DIFERENTES para
 * a mesma nota, e juntá-los na mesma tela faria a pessoa configurar um pensando
 * que está mexendo no outro.
 *
 * O que este caminho tem que os outros não têm: o documento do ERP aceita a
 * forma de pagamento real (NSU, bandeira, tipo de cartão), então a NFC-e para
 * de declarar "todo cartão é crédito" por palpite.
 */
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface EstadoErp {
  /** Mascarado (`****abcd`). O valor em claro nunca sai do servidor. */
  token: string | null;
  configurado: boolean;
}

interface EmpresaErp {
  razao_social: string;
  cnpj: string;
  local: string;
  regime: string;
}

/** Um produto que mudou, para a tela poder PROVAR o que fez. */
interface Exemplo {
  nome: string;
  /** Preço anterior em centavos; nulo quando o produto é novo. */
  de: number | null;
  para: number;
}

interface RespostaImportacao {
  lidos: number;
  criados: number;
  atualizados: number;
  pausados: number;
  restantes: string[];
  terminou: boolean;
  faltando: number;
  exemplos: Exemplo[];
  resumo: string;
}

const emReais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function PainelMaxxGestao({ emissor, aoMudarEmissor }: {
  /** Quem emite a NFC-e hoje. Vem de `/api/lojista/tef`, fonte única. */
  emissor: 'sistema' | 'maquininha' | 'erp';
  aoMudarEmissor: (novo: 'sistema' | 'erp') => Promise<void> | void;
}) {
  const { mostrar } = useToast();
  const [token, setToken] = useState('');
  const [configurado, setConfigurado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [empresa, setEmpresa] = useState<EmpresaErp | null>(null);

  const [importando, setImportando] = useState(false);
  const [andamento, setAndamento] = useState('');
  const [conta, setConta] = useState<{ criados: number; atualizados: number; pausados: number } | null>(null);
  const [exemplos, setExemplos] = useState<Exemplo[]>([]);

  /*
   * O campo nasce com a MÁSCARA que veio do servidor, não vazio. Vazio
   * pareceria "nunca configurado" numa loja que está, e o primeiro reflexo
   * seria colar o token de novo. O backend ignora valor que comece com `****`.
   */
  useEffect(() => {
    let vivo = true;
    api<EstadoErp>('GET', '/api/lojista/erp')
      .then(r => { if (!vivo) return; setToken(r.token || ''); setConfigurado(r.configurado); })
      .catch(() => { /* a tela não cai por causa disso */ });
    return () => { vivo = false; };
  }, []);

  async function salvarETestar() {
    setEnviando(true);
    setEmpresa(null);
    try {
      const r = await api<EstadoErp>('PUT', '/api/lojista/erp', { token });
      setToken(r.token || '');
      setConfigurado(r.configurado);
      /*
       * Salva e testa na MESMA ação. Dois botões deixariam "salvei mas não sei
       * se funciona" ser um estado possível — e é exatamente o estado em que a
       * nota não sai.
       */
      setEmpresa(await api<EmpresaErp>('POST', '/api/lojista/erp/testar', {}));
      mostrar({ tipo: 'sucesso', titulo: 'Conectado ao Maxx Gestão' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  /**
   * A IMPORTAÇÃO VEM EM LOTES, e a tela pede o próximo.
   *
   * O ERP aceita 20 requisições por minuto; ler o cadastro custa 24 e cada
   * letra da busca custa 11. O servidor gasta um orçamento de tempo por lote e
   * diz o que falta — uma requisição só ficaria minutos aberta.
   *
   * O laço tem TETO: um `restantes` que nunca encurta, por bug nosso ou deles,
   * viraria requisição infinita contra a API de um cliente.
   */
  async function importar() {
    setImportando(true);
    setAndamento('Lendo o cadastro do Maxx Gestão…');
    setConta(null);
    setExemplos([]);
    let letras: string[] | undefined;
    const soma = { criados: 0, atualizados: 0, pausados: 0 };
    try {
      for (let volta = 0; volta < 20; volta++) {
        const r = await api<RespostaImportacao>(
          'POST', '/api/lojista/erp/importar', letras ? { letras } : {},
        );
        soma.criados += r.criados;
        soma.atualizados += r.atualizados;
        soma.pausados += r.pausados;
        setConta({ ...soma });
        if (r.exemplos?.length) setExemplos(r.exemplos);
        setAndamento(r.resumo);

        if (r.terminou) {
          /*
           * O toast diz o RESUMO, não "importado com sucesso": produto novo
           * entra PAUSADO, e quem clicou é quem precisa saber disso agora — não
           * depois, quando faltar produto na loja.
           */
          mostrar({ tipo: soma.criados || soma.atualizados ? 'sucesso' : 'info', titulo: r.resumo });
          return;
        }

        /* Sem avanço não insiste: repetir a mesma lista de letras seria laço
           infinito com cara de progresso. */
        if (!r.restantes?.length) {
          mostrar({ tipo: 'erro', titulo: 'A importação parou de avançar. Tente de novo.' });
          return;
        }
        letras = r.restantes;
      }
      mostrar({ tipo: 'erro', titulo: 'A importação passou do limite de tentativas.' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setImportando(false);
    }
  }

  const ligado = emissor === 'erp';

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[15px] font-bold">Emitir a NFC-e pelo Maxx Gestão</h3>
        <p className="mt-1 max-w-[620px] text-[13px] leading-relaxed text-muted-foreground">
          Cada pedido vira documento no ERP e a nota sai de lá, com a bandeira e
          o NSU reais do cartão — não como "crédito" por padrão.
        </p>
      </div>

      {/* ─────────────── 1. conexão ─────────────── */}
      <section>
        <p className="text-[13px] font-bold">
          <span className="mr-1.5 text-muted-foreground">1.</span>Token da API
        </p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
          Nasce no painel do Maxx Gestão e não expira. Guardado criptografado —
          trate como senha: quem tem ele emite nota no seu CNPJ.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Input
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="cole o token aqui"
            className="min-w-[220px] flex-1 font-mono text-sm"
            disabled={enviando}
          />
          <Button type="button" variant="outline" disabled={enviando || !token.trim()} onClick={() => void salvarETestar()}>
            {enviando ? 'Testando…' : 'Salvar e testar'}
          </Button>
        </div>

        {/*
          MOSTRA A RAZÃO SOCIAL, não um visto verde. Ver o próprio CNPJ é o que
          prova que o token é da conta certa — token da conta errada só
          apareceria na primeira nota emitida no CNPJ de outra empresa.
        */}
        {empresa && (
          <div className="mt-2 rounded-xl border border-border bg-muted/40 p-3.5 text-[12.5px] leading-relaxed">
            <p className="font-bold text-foreground">{empresa.razao_social}</p>
            <p className="text-muted-foreground">CNPJ {empresa.cnpj} · {empresa.local} · {empresa.regime}</p>
            <p className="mt-1 text-muted-foreground">
              Confira se é a sua empresa antes de deixar o Maxx Gestão emitir.
            </p>
          </div>
        )}
      </section>

      {/* ─────────────── 2. cardápio ─────────────── */}
      <section>
        <p className="text-[13px] font-bold">
          <span className="mr-1.5 text-muted-foreground">2.</span>Trazer o cardápio
        </p>
        <p className="mt-0.5 max-w-[620px] text-[12.5px] leading-relaxed text-muted-foreground">
          Traz nome, descrição, categoria, código de barras, <b>preço</b> e o
          vínculo fiscal de cada produto. Os produtos entram <b>pausados</b> —
          publicar 1.100 itens na sua loja porque uma importação rodou não é
          decisão nossa.
        </p>
        <p className="mt-1.5 max-w-[620px] text-[12px] leading-relaxed text-muted-foreground">
          Se você já ajustou o preço de algum produto aqui, ele <b>não</b> é
          sobrescrito. O preço do ERP entra só onde ninguém definiu ainda.
        </p>

        <Button
          type="button"
          variant="outline"
          className="mt-2"
          disabled={importando || !configurado}
          onClick={() => void importar()}
        >
          {importando ? 'Trazendo…' : 'Trazer o cardápio'}
        </Button>
        {!configurado && (
          <p className="mt-1.5 text-[12px] text-muted-foreground">Salve e teste o token primeiro.</p>
        )}

        {/*
          O ANDAMENTO É NECESSÁRIO, não enfeite: a importação leva minutos por
          causa do limite do ERP, e sem texto mudando a conclusão de quem espera
          é que travou. Foi o que aconteceu.
        */}
        {(importando || andamento) && (
          <div className="mt-2.5 rounded-xl border border-border p-3.5">
            <p className="text-[12.5px] leading-relaxed">{andamento}</p>
            {conta && (conta.criados || conta.atualizados || conta.pausados) ? (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
                <span><b className="text-foreground">{conta.criados}</b> novos</span>
                <span><b className="text-foreground">{conta.atualizados}</b> atualizados</span>
                <span><b className="text-foreground">{conta.pausados}</b> pausados</span>
              </div>
            ) : null}

            {/*
              OS EXEMPLOS SÃO A PROVA. "1.111 atualizados" é um número que
              ninguém confere; três produtos com preço antes e depois dá para
              abrir o ERP e comparar.
            */}
            {exemplos.length > 0 && (
              <div className="mt-2.5 border-t border-border pt-2.5">
                <p className="text-[12px] font-bold text-muted-foreground">O que mudou, por exemplo:</p>
                <ul className="mt-1 space-y-0.5">
                  {exemplos.map((e, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                      <span className="font-medium">{e.nome}</span>
                      <span className="text-muted-foreground">
                        {e.de === null
                          ? <>novo · {emReais(e.para)}</>
                          : <>{emReais(e.de)} → <b className="text-foreground">{emReais(e.para)}</b></>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ─────────────── 3. emissão ─────────────── */}
      <section>
        <p className="text-[13px] font-bold">
          <span className="mr-1.5 text-muted-foreground">3.</span>Quem emite a nota
        </p>
        {/*
          O INTERRUPTOR VEM DEPOIS, na ordem em que a coisa acontece: sem token
          o servidor recusa ligar, e recusar depois do clique ensina menos que a
          ordem da tela ensinar sozinha.
        */}
        <button
          type="button"
          disabled={enviando || (!configurado && !ligado)}
          aria-pressed={ligado}
          onClick={() => void aoMudarEmissor(ligado ? 'sistema' : 'erp')}
          className={cn(
            'mt-2 flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left disabled:opacity-60',
            ligado ? 'border-primary bg-primary/[0.06]' : 'border-border',
          )}
        >
          <span className="min-w-0">
            <span className="block text-sm font-bold">O Maxx Gestão emite a NFC-e</span>
            <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">
              {ligado
                ? 'Este sistema não emite mais. O botão de emitir de um pedido continua, para o dia em que o ERP estiver fora do ar.'
                : configurado
                  ? 'Ligando, este sistema para de emitir e a nota passa a sair do ERP.'
                  : 'Salve e teste o token primeiro.'}
            </span>
          </span>
          <span className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors',
            ligado ? 'bg-primary' : 'bg-muted-foreground/30')}>
            <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
              ligado ? 'left-[22px]' : 'left-0.5')} />
          </span>
        </button>

        {/*
          O QUE AINDA FALTA NO ERP, dito aqui e não descoberto na primeira venda:
          sem forma de pagamento ligada à natureza de operação, a emissão para.
        */}
        {ligado && (
          <p className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-3.5 text-[12.5px] leading-relaxed text-muted-foreground">
            <b className="text-foreground">Confira no Maxx Gestão:</b> as formas de
            pagamento precisam estar ligadas à <b>natureza de operação</b> usada na
            venda. Sem isso a nota não sai, e o motivo aparece no pedido.
          </p>
        )}

        {/*
          DOIS EMISSORES NÃO CONVIVEM. Se a maquininha estiver marcada como
          emissora e o ERP for ligado, quem vale é o último clique — dizer isso
          aqui evita a descoberta pelo caminho caro, que é a nota duplicada.
        */}
        {emissor === 'maquininha' && (
          <p className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-3.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Hoje quem emite é <b className="text-foreground">a maquininha</b>. Ligar
            aqui passa a emissão para o Maxx Gestão — a maquininha volta a só cobrar.
          </p>
        )}
      </section>
    </div>
  );
}
