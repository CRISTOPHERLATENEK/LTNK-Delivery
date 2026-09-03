/**
 * INTEGRAÇÃO COM O MAXX GESTÃO (Meu ERP Online).
 *
 * Card próprio, separado do TEF de propósito: são dois caminhos DIFERENTES para
 * a mesma nota, e juntá-los na mesma tela faria a pessoa configurar um pensando
 * que está mexendo no outro.
 *
 * TRÊS LINHAS E UMA SANFONA. A versão anterior tinha título repetido (o header
 * já diz o nome), numeração 1-2-3 e cinco parágrafos sempre abertos — 640px de
 * altura para três controles. A explicação continua existindo, fechada no pé:
 * quem já entendeu não relê, quem precisa abre.
 */
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { Linha, Sanfona } from './integracoes-ui';

export interface EstadoErp {
  /** Mascarado (`****abcd`). O valor em claro nunca sai do servidor. */
  token: string | null;
  configurado: boolean;
  emitindo: boolean;
  /** A nota sai sozinha ao fechar o pedido. Nasce desligada. */
  auto_emitir: boolean;
  /**
   * O modelo do documento: `PA` (Pedido de Venda) ou `PV` (Pré-Venda).
   *
   * É o ajuste que decide se o pedido cai na fila que o PDV MeuChef puxa — e
   * qual modelo entra nela varia por instalação, então quem descobre é o
   * lojista, testando.
   */
  modelo: 'PA' | 'PV';
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

interface CatalogoErp {
  codigo: number;
  descricao: string;
  ativo: boolean;
  itens: number;
}

interface RespostaImportacao {
  criados: number;
  atualizados: number;
  pausados: number;
  restantes: string[];
  terminou: boolean;
  exemplos: Exemplo[];
  resumo: string;
  /** Quanto esperar antes do próximo lote, quando o ERP bateu o limite. */
  esperar_ms?: number;
}

const emReais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** O status do header, em uma frase. É o mesmo texto do card. */
export function statusErp(e: EstadoErp | null): string {
  if (!e) return 'Carregando…';
  if (!e.configurado) return 'Falta o token da API';
  return e.emitindo ? 'Emitindo a NFC-e' : 'Conectado · não está emitindo';
}

export function PainelMaxxGestao({ estado, aoMudar }: {
  estado: EstadoErp | null;
  aoMudar: (novo: EstadoErp) => void;
}) {
  const { mostrar } = useToast();
  const [token, setToken] = useState('');
  const [editado, setEditado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [ligando, setLigando] = useState(false);
  const [ligandoAuto, setLigandoAuto] = useState(false);
  const [empresa, setEmpresa] = useState<EmpresaErp | null>(null);

  const [catalogos, setCatalogos] = useState<CatalogoErp[] | null>(null);
  const [catalogo, setCatalogo] = useState(0);
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
    if (estado && !editado) setToken(estado.token || '');
  }, [estado, editado]);

  /*
   * OS CATÁLOGOS SÓ SÃO BUSCADOS QUANDO O MODAL ABRE COM TOKEN.
   *
   * A lista custa uma requisição por catálogo (para vir a contagem), e a
   * contagem é o que permite escolher: entre "Catalogo" e "RESTAURANTE" sem
   * número, é adivinhação. Buscar isso no carregamento da tela de Integrações
   * gastaria a janela do ERP de quem só passou por ali.
   */
  useEffect(() => {
    if (!estado?.configurado || catalogos) return;
    let vivo = true;
    api<{ catalogos: CatalogoErp[] }>('GET', '/api/lojista/erp/catalogos')
      .then(r => { if (vivo) setCatalogos(r.catalogos); })
      .catch(() => { if (vivo) setCatalogos([]); });
    return () => { vivo = false; };
  }, [estado?.configurado, catalogos]);

  async function salvarETestar() {
    setEnviando(true);
    setEmpresa(null);
    try {
      const r = await api<EstadoErp>('PUT', '/api/lojista/erp', { token });
      aoMudar(r);
      setToken(r.token || '');
      setEditado(false);
      /*
       * Salva e testa na MESMA ação. Dois botões deixariam "salvei mas não sei
       * se funciona" ser um estado possível — e é exatamente o estado em que a
       * nota não sai.
       */
      setEmpresa(await api<EmpresaErp>('POST', '/api/lojista/erp/testar', {}));
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  /**
   * O INTERRUPTOR COM ESTADO OTIMISTA E VOLTA ATRÁS.
   *
   * Otimista porque a troca é instantânea no banco e esperar a resposta faz o
   * controle parecer travado; com volta atrás porque o servidor RECUSA ligar sem
   * token, e um interruptor que fica ligado depois de uma recusa mente.
   */
  async function alternar() {
    if (!estado || ligando) return;
    const antes = estado;
    const novo = !estado.emitindo;
    aoMudar({ ...estado, emitindo: novo });
    setLigando(true);
    try {
      await api<{ emitindo: boolean }>('PUT', '/api/lojista/erp/emissor', { ligado: novo });
      mostrar({
        tipo: 'sucesso',
        titulo: novo ? 'O Maxx Gestão passou a emitir a NFC-e' : 'A emissão voltou para este sistema',
      });
    } catch (err) {
      aoMudar(antes);
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setLigando(false);
    }
  }

  /**
   * A EMISSÃO AUTOMÁTICA PEDE CONFIRMAÇÃO PARA LIGAR — não para desligar.
   *
   * Ligar muda o gatilho da nota para o clique de "Já entreguei", sem ninguém
   * revisar o documento antes, e emitir não tem volta. Desligar é sempre seguro,
   * então perguntar ali seria atrito por simetria.
   */
  async function alternarAuto() {
    if (!estado || ligandoAuto) return;
    const novo = !estado.auto_emitir;
    if (novo && !window.confirm(
      /* Template literal com quebras de verdade: `confirm` mostra texto
         corrido, e três frases em um parágrafo só ninguém lê. */
      `A nota vai ser emitida automaticamente quando você fechar o pedido, sem revisão antes.

Emitir NFC-e não tem volta: nota errada se desfaz com cancelamento.

Ligar assim mesmo?`,
    )) return;

    const antes = estado;
    aoMudar({ ...estado, auto_emitir: novo });
    setLigandoAuto(true);
    try {
      await api<{ auto_emitir: boolean }>('PUT', '/api/lojista/erp/auto-emitir', { ligado: novo });
      mostrar({
        tipo: 'sucesso',
        titulo: novo ? 'A NFC-e passa a sair sozinha ao fechar o pedido' : 'A emissão automática foi desligada',
      });
    } catch (err) {
      aoMudar(antes);
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setLigandoAuto(false);
    }
  }

  /**
   * A IMPORTAÇÃO VEM EM LOTES, e a tela pede o próximo.
   *
   * O ERP aceita 20 requisições por minuto e ENFILEIRA o excesso, então o
   * servidor nunca espera dentro de uma requisição: ele devolve o que fez e diz
   * quanto aguardar (`esperar_ms`). Esperar do lado do servidor dava 504 —
   * o proxy corta em 60 segundos.
   *
   * QUEM ESPERA É ESTA TELA, e é por isso que ela tem que dizer que está
   * esperando: um minuto parado sem texto é indistinguível de travamento.
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
          'POST', '/api/lojista/erp/importar',
          { ...(letras ? { letras } : {}), ...(catalogo ? { catalogo } : {}) },
        );
        soma.criados += r.criados;
        soma.atualizados += r.atualizados;
        soma.pausados += r.pausados;
        setConta({ ...soma });
        if (r.exemplos?.length) setExemplos(r.exemplos);
        setAndamento(r.resumo);

        if (r.terminou) {
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

        /*
         * A ESPERA COM CONTAGEM NA TELA. Sem os segundos correndo, um minuto
         * parado é indistinguível de travado — e foi assim que a versão que
         * esperava no servidor virou "não acontece nada".
         */
        const espera = Math.min(Math.max(r.esperar_ms ?? 0, 0), 70_000);
        if (espera > 0) {
          for (let resta = Math.ceil(espera / 1000); resta > 0; resta--) {
            setAndamento(`Limite do Maxx Gestão: 20 chamadas por minuto. Continuando em ${resta}s…`);
            await new Promise(r2 => { setTimeout(r2, 1000); });
          }
        }
      }
      mostrar({ tipo: 'erro', titulo: 'A importação passou do limite de tentativas.' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setImportando(false);
    }
  }

  /*
   * TROCAR O MODELO grava na hora e vale só para os PRÓXIMOS pedidos.
   *
   * Documento já criado no ERP não muda de modelo por isso — mexer nos que já
   * estão lá seria alterar documento que alguém pode ter faturado.
   */
  const [trocandoModelo, setTrocandoModelo] = useState(false);
  async function trocarModelo(novo: 'PA' | 'PV') {
    if (!estado || estado.modelo === novo) return;
    setTrocandoModelo(true);
    const antes = estado.modelo;
    aoMudar({ ...estado, modelo: novo });
    try {
      await api<{ modelo: string }>('PUT', '/api/lojista/erp/modelo', { modelo: novo });
    } catch (e) {
      /* Volta ao que era: deixar a tela mostrando o novo faria o lojista
         concluir que trocou, e os pedidos seguiriam subindo como antes. */
      aoMudar({ ...estado, modelo: antes });
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally { setTrocandoModelo(false); }
  }

  const configurado = !!estado?.configurado;
  const emitindo = !!estado?.emitindo;

  return (
    <>
      {/* ─────────── token ─────────── */}
      <Linha titulo="Token da API">
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={token}
            onChange={e => { setToken(e.target.value); setEditado(true); }}
            placeholder="cole o token aqui"
            className="h-[38px] min-w-[200px] flex-1 font-mono text-sm"
            disabled={enviando}
          />
          {/*
            O BOTÃO DIZ O ESTADO, não a intenção. "Salvar e testar" aceso num
            campo intocado convida a reenviar o que já está lá; "Salvo" informa
            e só vira ação quando alguém digita.
          */}
          <Button
            type="button"
            variant={editado ? 'default' : 'outline'}
            disabled={enviando || !editado || !token.trim()}
            onClick={() => void salvarETestar()}
            className="h-[38px] whitespace-nowrap"
          >
            {enviando ? 'Testando…' : editado ? 'Salvar e testar' : 'Salvo'}
          </Button>
        </div>

        {/*
          MOSTRA A RAZÃO SOCIAL, não um visto verde. Ver o próprio CNPJ é o que
          prova que o token é da conta certa — token da conta errada só
          apareceria na primeira nota emitida no CNPJ de outra empresa.
        */}
        {empresa && (
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            <b className="text-foreground">{empresa.razao_social}</b> · CNPJ {empresa.cnpj}
            {' · '}{empresa.local} · {empresa.regime}
          </p>
        )}
      </Linha>

      {/* ─────────── cardápio ─────────── */}
      <Linha
        titulo="Trazer o cardápio"
        descricao="Cria os produtos do ERP aqui, pausados, com o vínculo fiscal e o preço."
        acao={
          <Button
            type="button"
            variant="outline"
            disabled={importando || !configurado}
            onClick={() => void importar()}
            className="h-[34px] whitespace-nowrap"
          >
            {importando ? 'Trazendo…' : 'Trazer'}
          </Button>
        }
      >
        {/*
          A ESCOLHA DO CATÁLOGO vem ANTES do botão na leitura da tela, porque é
          decisão: uma loja de delivery quer "RESTAURANTE", não as 1.108
          mercadorias da empresa. Com um catálogo escolhido nada é pausado —
          produto de outro cardápio apareceria como ausente e sairia do ar.
        */}
        {catalogos && catalogos.length > 0 && (
          <div className="mt-2">
            <select
              value={catalogo}
              onChange={e => setCatalogo(Number(e.target.value))}
              disabled={importando}
              className="h-[34px] w-full max-w-[340px] rounded-lg border border-border bg-background px-2 text-[13px]"
            >
              <option value={0}>Todos os produtos da empresa</option>
              {catalogos.filter(c => c.ativo).map(c => (
                <option key={c.codigo} value={c.codigo}>
                  {c.descricao}{c.itens ? ` — ${c.itens} itens` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {/*
          O ANDAMENTO É NECESSÁRIO, não enfeite: a importação leva minutos por
          causa do limite do ERP, e sem texto mudando a conclusão de quem espera
          é que travou. Foi o que aconteceu.
        */}
        {(importando || andamento) && (
          <div className="mt-2.5">
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">{andamento}</p>
            {conta && (conta.criados || conta.atualizados || conta.pausados) ? (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
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
              <ul className="mt-2 space-y-0.5">
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
            )}
          </div>
        )}
      </Linha>

      {/* ─────────── emissão ─────────── */}
      <Linha
        titulo="O Maxx Gestão emite a NFC-e"
        descricao={
          !configurado ? 'Salve o token para poder ligar.'
            : emitindo ? 'A nota sai do ERP, com a bandeira e o NSU reais do cartão.'
              : 'Desligado — quem emite a nota é este sistema.'
        }
        acao={
          <button
            type="button"
            /* Inerte sem token: o servidor recusa, e um interruptor que aceita o
               clique para depois voltar atrás ensina menos que um que não move. */
            disabled={!configurado || ligando}
            aria-pressed={emitindo}
            onClick={() => void alternar()}
            className={cn(
              'relative h-6 w-11 shrink-0 rounded-full transition-colors',
              !configurado ? 'cursor-not-allowed bg-muted' : emitindo ? 'bg-primary' : 'bg-muted-foreground/30',
            )}
          >
            <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
              emitindo ? 'left-[22px]' : 'left-0.5')} />
          </button>
        }
      />

      {/* ─────────── emissão automática ─────────── */}
      <Linha
        titulo="Emitir a nota automaticamente"
        descricao={
          !emitindo ? 'Disponível quando o Maxx Gestão for o emissor.'
            : estado?.auto_emitir
              ? 'A NFC-e sai quando você fecha o pedido — sem revisão antes.'
              : 'Desligado — o pedido chega no ERP e você fatura lá.'
        }
        acao={
          <button
            type="button"
            /* Inerte sem o ERP como emissor: o servidor recusa, e um interruptor
               que aceita o clique para voltar atrás ensina menos que um que não
               move. */
            disabled={!emitindo || ligandoAuto}
            aria-pressed={!!estado?.auto_emitir}
            onClick={() => void alternarAuto()}
            className={cn(
              'relative h-6 w-11 shrink-0 rounded-full transition-colors',
              !emitindo ? 'cursor-not-allowed bg-muted'
                : estado?.auto_emitir ? 'bg-primary' : 'bg-muted-foreground/30',
            )}
          >
            <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
              estado?.auto_emitir ? 'left-[22px]' : 'left-0.5')} />
          </button>
        }
      >
        {/* O AVISO SÓ APARECE LIGADO, e diz a consequência real em vez de
            "atenção": quem já ligou sabe o que quis; quem lê isso pela primeira
            vez precisa saber que o clique de entregar virou clique de emitir. */}
        {emitindo && estado?.auto_emitir && (
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            NFC-e de <b>entrega</b> exige CPF do cliente — sem ele a SEFAZ recusa
            e o documento fica no ERP para você faturar na mão. O motivo aparece
            no pedido.
          </p>
        )}
      </Linha>

      {/* ─────────── o modelo do documento ─────────── */}
      <Linha
        titulo="Como o pedido entra no Maxx Gestão"
        descricao={
          estado?.modelo === 'PV'
            ? 'Como Pré-Venda — é o que o PDV (MeuChef) costuma puxar para finalizar no caixa.'
            : 'Como Pedido de Venda. Se o pedido não aparecer no seu PDV, experimente Pré-Venda.'
        }
        acao={
          <div className="flex shrink-0 gap-1 rounded-xl border border-border bg-muted/40 p-1">
            {([
              { v: 'PA' as const, t: 'Pedido' },
              { v: 'PV' as const, t: 'Pré-Venda' },
            ]).map(o => (
              <button
                key={o.v}
                type="button"
                disabled={!configurado || trocandoModelo}
                aria-pressed={estado?.modelo === o.v}
                onClick={() => void trocarModelo(o.v)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-[12.5px] font-bold transition-colors disabled:opacity-50',
                  estado?.modelo === o.v
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {o.t}
              </button>
            ))}
          </div>
        }
      >
        {/*
          A FRASE QUE EVITA O TESTE ERRADO.
          Sem ela, a pessoa troca o modelo, abre o PDV, não vê o pedido antigo
          e conclui que a troca não funcionou.
        */}
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
          Vale para os <b>próximos</b> pedidos. Os documentos que já estão no
          Maxx Gestão continuam como foram criados.
        </p>
      </Linha>

      {/* ─────────── a explicação, fechada ─────────── */}
      <Sanfona titulo="Como funciona a emissão pelo ERP">
        <ul className="max-w-[54ch] space-y-2 text-[12.5px] leading-relaxed text-muted-foreground">
          <li>
            Cada pedido vira um documento no Maxx Gestão e a nota sai de lá — com
            a bandeira e o NSU reais do cartão, em vez de "crédito" por padrão.
          </li>
          <li>
            <b className="text-foreground">Token.</b> Nasce no painel do Maxx
            Gestão, não expira e fica guardado criptografado. Trate como senha:
            quem tem ele emite nota no seu CNPJ.
          </li>
          <li>
            <b className="text-foreground">Cardápio.</b> Os produtos entram
            pausados, e preço que você já ajustou aqui não é sobrescrito.
          </li>
          <li>
            <b className="text-foreground">Emissão.</b> Ligando, este sistema
            para de emitir e a nota passa a sair do ERP. As formas de pagamento
            precisam estar ligadas à natureza de operação, lá.
          </li>
        </ul>
      </Sanfona>
    </>
  );
}
