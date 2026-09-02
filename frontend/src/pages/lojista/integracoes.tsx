/**
 * INTEGRAÇÕES — onde o sistema conversa com sistemas de fora.
 *
 * A maquininha (Smart TEF) nasceu como uma aba dentro de Pagamentos, ao lado de
 * Pix e cartão online. Fazia sentido enquanto ela era "mais uma forma de
 * receber". Não faz mais: Pix e cartão online são dinheiro que cai pela
 * internet, configurados uma vez com um token; maquininha e iFood são
 * APARELHOS E EMPRESAS DE FORA que precisam ser conectados, autorizados, e que
 * quebram por motivos próprios — credencial revogada, aparelho desligado,
 * aprovação pendente.
 *
 * Quando o lojista pensa "o iFood parou", ele não pensa "vou em Pagamentos".
 * Esta tela é o lugar que ele procura.
 *
 * GRADE DE CARDS, DETALHE EM MODAL. A versão anterior era um card gigante com
 * quatro cards aninhados dentro e três blocos de texto explicativo sempre
 * abertos. Duas consequências: para saber se o iFood estava funcionando era
 * preciso ler a tela inteira, e o texto que explicava as regras da
 * sincronização ficava aberto para sempre, empurrando o interruptor para baixo
 * — quem já entendeu não lê de novo, e quem não entendeu não lê da primeira
 * vez. Agora cada integração é um card com UMA linha de status concreta, e o
 * resto mora atrás de um clique.
 */
import { useEffect, useState } from 'react';
import { Plug, Smartphone, Download, Loader2, Upload, Printer, Receipt } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { agenteAtivo, impressoraAgente } from '@/lib/agente';
import { PainelMaxxGestao } from './painel-maxxgestao';
import { CardIntegracao, ModalIntegracao, LogoIntegracao, Linha, Sanfona } from './integracoes-ui';
import { WhatsAppLoja } from './whatsapp';
import { PainelTef } from './loja-config';

interface PreviaCardapio {
  disponivel: boolean;
  novos: Array<{ nome: string; complementos: number; precoIfoodCentavos: number }>;
  jaExistem: number;
  semCodigo: number;
}

interface PreviaPublicacao {
  publicou: boolean;
  criados: number;
  atualizados: number;
  falhas: string[];
  semCodigo: string[];
  semPreco: string[];
  soExistemNoIfood: string[];
  previa: Array<{ nome: string; codigo: string; acao: 'criar' | 'atualizar'; complementos: number }>;
}

/** O que a rota /tef devolve. Segredos vêm mascarados. */
interface EstadoTefCompleto {
  ativo: boolean;
  base_url: string;
  serial_pos: string;
  usuario: string;
  senha: string | null;
  gateway_token: string | null;
  configurado: boolean;
  nfce_emissor: 'sistema' | 'maquininha' | 'erp';
  pendencias: string[];
}

interface EstadoIfood {
  merchant_id: string;
  ativo: boolean;
  /** 'nenhuma' | 'do_ifood'. A direção da sincronização de cardápio. */
  sincronizacao: string;
  /** A PLATAFORMA tem credenciais de app iFood? Não depende do lojista. */
  plataforma_integrada: boolean;
  configurado: boolean;
}

/** Interruptor desenhado à mão, como no resto do painel. */
function Chave({ ativo, onAlternar, disabled }: {
  ativo: boolean; onAlternar: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button" disabled={disabled} onClick={onAlternar} aria-pressed={ativo}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60',
        ativo ? 'bg-primary' : 'bg-muted-foreground/30')}
    >
      <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
        ativo ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

/** Atalho para uma seção das configurações, no formato que a tela entende. */
function linkSecao(secao: string) {
  return `/lojista/config?secao=${secao}`;
}

export function IntegracoesLoja() {
  const { mostrar } = useToast();
  const [aberta, setAberta] = useState<'ifood' | 'whatsapp' | 'tef' | 'impressao' | 'erp' | null>(null);

  const [ifood, setIfood] = useState<EstadoIfood | null>(null);
  const [merchantId, setMerchantId] = useState('');
  const [carregado, setCarregado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [previa, setPrevia] = useState<PreviaCardapio | null>(null);
  const [lendo, setLendo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [publicacao, setPublicacao] = useState<PreviaPublicacao | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const [publicando, setPublicando] = useState(false);

  /*
   * O estado do TEF é o objeto INTEIRO da rota, não um resumo: `PainelTef`
   * agora mora dentro do modal daqui e precisa dele para preencher os campos.
   * Um resumo obrigaria a tela a buscar de novo o que já veio.
   */
  const [tef, setTef] = useState<EstadoTefCompleto | null>(null);
  const [zapMetodo, setZapMetodo] = useState('nenhum');
  const [agente, setAgente] = useState<{ ligado: boolean; impressora: string } | null>(null);

  useEffect(() => {
    api<EstadoIfood>('GET', '/api/lojista/ifood')
      .then(r => { setIfood(r); if (!carregado) { setMerchantId(r.merchant_id); setCarregado(true); } })
      .catch(() => {});

    /*
     * O status de cada card vem da fonte de verdade de cada integração, não de
     * um palpite. Falha de leitura deixa o card em "desligado" em vez de
     * quebrar a tela: uma integração que não respondeu não é motivo para o
     * lojista não conseguir mexer nas outras.
     */
    api<EstadoTefCompleto>('GET', '/api/lojista/tef').then(setTef).catch(() => {});
    api<{ metodo_ativo: string }>('GET', '/api/lojista/whatsapp')
      .then(r => setZapMetodo(r.metodo_ativo || 'nenhum')).catch(() => {});
    agenteAtivo()
      .then(ligado => setAgente({ ligado, impressora: impressoraAgente() }))
      .catch(() => setAgente({ ligado: false, impressora: '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function salvarIfood(campos: Record<string, unknown>) {
    setEnviando(true);
    try {
      const r = await api<EstadoIfood>('PUT', '/api/lojista/ifood', campos);
      setIfood(r);
      setMerchantId(r.merchant_id);
      return r;
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
      return null;
    } finally {
      setEnviando(false);
    }
  }

  async function verCardapio() {
    setLendo(true);
    try {
      setPrevia(await api<PreviaCardapio>('GET', '/api/lojista/ifood/cardapio'));
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setLendo(false); }
  }

  async function importar() {
    setImportando(true);
    try {
      const r = await api<{ criados: number; pulados: number; falhas: string[]; semPreco: string[] }>(
        'POST', '/api/lojista/ifood/cardapio/importar', {});
      mostrar(r.falhas.length
        ? { tipo: 'erro', titulo: r.criados + ' produto(s) importado(s), ' + r.falhas.length + ' com problema',
            descricao: r.falhas[0] }
        : { tipo: 'sucesso', titulo: r.criados + ' produto(s) importado(s)',
            descricao: 'Todos entraram PAUSADOS e sem preco. Defina o preco em Produtos antes de colocar a venda.' });
      setPrevia(null);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setImportando(false); }
  }

  async function conferirPublicacao() {
    setConferindo(true);
    try {
      setPublicacao(await api<PreviaPublicacao>('GET', '/api/lojista/ifood/publicar'));
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setConferindo(false); }
  }

  async function publicar() {
    setPublicando(true);
    try {
      const r = await api<PreviaPublicacao>('POST', '/api/lojista/ifood/publicar', {});
      mostrar(r.falhas.length
        ? { tipo: 'erro', titulo: r.falhas.length + ' produto(s) com problema', descricao: r.falhas[0] }
        : { tipo: 'sucesso', titulo: (r.criados + r.atualizados) + ' produto(s) enviado(s) ao iFood' });
      setPublicacao(null);
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setPublicando(false); }
  }

  /*
   * O STATUS DIZ O QUE ESTÁ ACONTECENDO, NÃO O ESTADO DO INTERRUPTOR.
   *
   * "Ligado" é a resposta que menos ajuda: a loja pode estar ligada e sem
   * código, e aí nenhum pedido chega — e o lojista fica esperando um pedido
   * que nunca vem, olhando para um selo verde.
   */
  const statusIfood = !ifood ? 'Carregando…'
    : !ifood.plataforma_integrada ? 'Ainda não liberado pela plataforma'
    : !ifood.ativo ? 'Desligado'
    : !ifood.merchant_id ? 'Falta o código da loja'
    : 'Recebendo pedidos';

  /*
   * O STATUS CABE NUMA LINHA DE CARD DE 190px, e isso é requisito, não estética:
   * cortado com reticências ele deixa de ser concreto, que era a única razão de
   * existir. "Recebendo pedidos · cardápio sincronizado" virava
   * "Recebendo pedidos · car…". O estado da sincronização mora no modal, onde
   * há linha inteira para ele.
   */

  const logoIfood = (ativa: boolean) => (
    <LogoIntegracao src="/integracoes/ifood.png" nome="iFood" ativa={ativa} />
  );
  const logoZap = (ativa: boolean) => (
    <LogoIntegracao src="/integracoes/whatsapp.png" nome="WhatsApp" ativa={ativa} />
  );
  const logoTef = (ativa: boolean) => (
    <LogoIntegracao nome="Maquininha" ativa={ativa} icone={<Smartphone className="size-[19px]" />} />
  );
  const logoImpressao = (ativa: boolean) => (
    <LogoIntegracao nome="Impressão" ativa={ativa} icone={<Printer className="size-[19px]" />} />
  );
  const logoErp = (ativa: boolean) => (
    <LogoIntegracao nome="Maxx Gestão" ativa={ativa} icone={<Receipt className="size-[19px]" />} />
  );

  const ifoodOk = !!ifood?.configurado && !!ifood.merchant_id;

  /*
   * LIGADA NÃO É CONECTADA, e o card mostrava "Conectada" para uma maquininha
   * ligada e sem credencial — a tela de Pagamentos dizia "ainda não vai
   * funcionar" ao mesmo tempo. Era o erro que este card existe para evitar,
   * cometido nele mesmo: `ativo` é a posição do interruptor, `configurado` é o
   * funcionamento. A API já devolvia os dois.
   */
  const tefStatus = !tef ? 'Carregando…'
    : !tef.ativo ? 'Desligada'
    : tef.configurado ? 'Conectada'
    : tef.pendencias.length ? `Falta ${tef.pendencias[0]}`
    : 'Falta configurar';
  /* O emissor mora em `/tef` porque é uma configuração só, com três valores —
     duas telas gravando o mesmo campo é melhor que dois campos discordando. */
  const erpEmitindo = tef?.nfce_emissor === 'erp';

  async function mudarEmissor(novo: 'sistema' | 'erp') {
    const r = await api<EstadoTefCompleto>('PUT', '/api/lojista/tef', { nfce_emissor: novo });
    setTef(r);
  }

  const zapOk = zapMetodo !== 'nenhum';
  const agenteOk = !!agente?.ligado;

  return (
    <div className="mx-auto max-w-[840px]">
      <div className="mb-5">
        <h2 className="flex items-center gap-2 text-[22px] font-extrabold">
          <Plug className="size-5 text-primary" /> Integrações
        </h2>
        <p className="mt-1 max-w-[48ch] text-[13px] leading-relaxed text-muted-foreground">
          Conexões com sistemas de fora. Dependem de aparelhos e aprovações,
          então podem parar por conta própria.
        </p>
      </div>

      {/* Uma coluna em telefone pequeno, duas a partir de 380px, e daí em
          diante o quanto couber de 190px. */}
      <div className="grid grid-cols-1 gap-[14px] min-[380px]:grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
        <CardIntegracao
          logo={logoIfood(ifoodOk)} nome="iFood" status={statusIfood}
          ligada={ifoodOk} onAbrir={() => setAberta('ifood')}
        />
        <CardIntegracao
          logo={logoZap(zapOk)} nome="WhatsApp"
          status={zapOk ? 'Avisando o cliente' : 'Desligado'}
          ligada={zapOk} onAbrir={() => setAberta('whatsapp')}
        />
        <CardIntegracao
          logo={logoTef(!!tef?.configurado)} nome="Maquininha (TEF)"
          status={tefStatus}
          ligada={!!tef?.configurado} onAbrir={() => setAberta('tef')}
        />
        <CardIntegracao
          logo={logoErp(erpEmitindo)} nome="Maxx Gestão"
          /* O status responde a pergunta que importa: quem emite a nota. */
          status={!tef ? 'Carregando…' : erpEmitindo ? 'Emitindo a NFC-e' : 'Não está emitindo'}
          ligada={erpEmitindo} onAbrir={() => setAberta('erp')}
        />
        <CardIntegracao
          logo={logoImpressao(agenteOk)} nome="Impressão automática"
          status={agente === null ? 'Verificando…'
            : agenteOk ? (agente.impressora || 'Agente conectado')
            : 'Agente não detectado'}
          ligada={agenteOk} onAbrir={() => setAberta('impressao')}
        />
      </div>

      {/* ─────────────────────────── iFood ─────────────────────────── */}
      <ModalIntegracao
        aberta={aberta === 'ifood'} aoFechar={() => setAberta(null)}
        logo={logoIfood(ifoodOk)} nome="iFood" status={statusIfood}
      >
        {ifood && !ifood.plataforma_integrada ? (
          /*
           * A DISTINÇÃO QUE EVITA CHAMADO ABERTO À TOA. "A plataforma ainda não
           * está integrada" é problema NOSSO, não do lojista — e sem dizer
           * isso ele olharia o próprio cadastro procurando o que fez de errado
           * num campo que já estava certo.
           */
          <div className="px-5 py-6">
            <p className="max-w-[46ch] text-[13px] leading-relaxed text-muted-foreground">
              A integração com o iFood está sendo habilitada pela plataforma.
              Não há nada para você fazer aqui ainda — avisaremos quando abrir.
            </p>
          </div>
        ) : ifood && (
          <>
            <Linha
              titulo="Receber pedidos aqui"
              descricao={ifood.ativo
                ? 'Os pedidos entram no seu painel, junto com os do seu cardápio.'
                : 'Desligado, os pedidos continuam só no aplicativo do iFood.'}
              acao={<Chave ativo={!!ifood.ativo} disabled={enviando}
                onAlternar={() => void salvarIfood({ ativo: !ifood.ativo })} />}
            />

            {/*
              DESLIGADO, AS LINHAS DE BAIXO SOMEM. Campo de código e botão de
              importar com a integração desligada são controles órfãos: mexem
              em algo que não está rodando, e o lojista mexe achando que
              resolveu.
            */}
            {ifood.ativo && (
              <>
                <Linha titulo="Código da loja">
                  <form
                    className="mt-3 flex items-center gap-2"
                    onSubmit={async e => {
                      e.preventDefault();
                      const r = await salvarIfood({ merchant_id: merchantId });
                      if (r) mostrar({ tipo: 'sucesso', titulo: 'Código da loja salvo' });
                    }}
                  >
                    <Input
                      aria-label="Código da sua loja no iFood"
                      value={merchantId} disabled={enviando}
                      onChange={e => setMerchantId(e.target.value)}
                      placeholder="0a0000aa-0aa0-00aa-aa00-0000aa000001"
                      className="h-[38px] font-mono text-sm"
                    />
                    {/*
                      "Salvo" neutro enquanto nada mudou, "Salvar" em destaque
                      quando há o que salvar. Um botão primário sempre aceso
                      pede um clique que não faz nada — e ensina o lojista a
                      ignorar o botão que um dia vai importar.
                    */}
                    <Button
                      type="submit" disabled={enviando || merchantId === ifood.merchant_id}
                      variant={merchantId === ifood.merchant_id ? 'outline' : 'default'}
                      className="h-[38px] shrink-0 whitespace-nowrap"
                    >
                      {merchantId === ifood.merchant_id ? 'Salvo' : 'Salvar'}
                    </Button>
                  </form>
                  {!ifood.merchant_id && (
                    <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                      Enquanto ele não for preenchido, nenhum pedido do iFood chega aqui.
                      É o identificador da sua loja no Portal do Parceiro.
                    </p>
                  )}
                </Linha>

                {ifood.merchant_id && (
                  <Linha
                    titulo="Trazer o cardápio do iFood"
                    descricao="Cria aqui os produtos que existem lá, com os complementos."
                    acao={
                      <Button type="button" variant="outline" size="sm"
                        className="h-[34px] whitespace-nowrap"
                        disabled={lendo || importando} onClick={() => void verCardapio()}>
                        {lendo ? <Loader2 className="size-4 animate-spin" /> : 'Ver o que tem lá'}
                      </Button>
                    }
                  >
                    {/*
                      A PRÉVIA MOSTRA OS NOMES, não só a contagem. "12 produtos"
                      não deixa o lojista perceber que 3 são de um cardápio
                      antigo que ele nem usa mais. Ver a lista é o que
                      transforma o clique em decisão.
                    */}
                    {previa && (
                      <div className="mt-4 space-y-3">
                        {previa.novos.length === 0 ? (
                          <p className="text-[12.5px] text-muted-foreground">
                            {previa.jaExistem > 0
                              ? `Nada novo para trazer — os ${previa.jaExistem} produtos de lá já existem aqui.`
                              : 'Não encontrei produtos no cardápio do iFood.'}
                          </p>
                        ) : (
                          <>
                            <p className="text-[13px] font-bold">
                              {previa.novos.length} produto(s) para trazer
                            </p>
                            <ul className="max-h-52 space-y-1 overflow-y-auto text-[12.5px] text-muted-foreground">
                              {previa.novos.map(p => (
                                <li key={p.nome} className="flex items-baseline justify-between gap-3">
                                  <span className="truncate">{p.nome}</span>
                                  <span className="shrink-0 text-[11.5px] opacity-70">
                                    {p.complementos > 0 && `${p.complementos} grupo(s) · `}
                                    lá custa R$ {(p.precoIfoodCentavos / 100).toFixed(2).replace('.', ',')}
                                  </span>
                                </li>
                              ))}
                            </ul>

                            {/*
                              ESTE AVISO CONTINUA SEMPRE VISÍVEL, e é a exceção
                              deliberada à regra de esconder texto: ele só
                              aparece DEPOIS do clique, no instante da decisão,
                              e o que ele evita é o lojista vender pelo preço
                              com comissão embutida no próprio link.
                            */}
                            <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 text-[12px] leading-relaxed text-muted-foreground">
                              <b className="text-amber-700 dark:text-amber-500">O preço não vem junto.</b>{' '}
                              No iFood ele costuma embutir a comissão. Os produtos entram
                              <b> pausados e sem preço</b> — você define e coloca à venda.
                            </div>

                            {(previa.jaExistem > 0 || previa.semCodigo > 0) && (
                              <p className="text-[12px] text-muted-foreground">
                                {previa.jaExistem > 0 && `${previa.jaExistem} já existem aqui e serão pulados. `}
                                {previa.semCodigo > 0 && `${previa.semCodigo} sem código no iFood ficam de fora.`}
                              </p>
                            )}

                            <Button type="button" className="h-[38px] whitespace-nowrap"
                              disabled={importando} onClick={() => void importar()}>
                              {importando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                              Trazer {previa.novos.length} produto(s)
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </Linha>
                )}

                {ifood.merchant_id && (
                  <Linha
                    titulo="Manter igual ao iFood"
                    descricao={ifood.sincronizacao === 'do_ifood'
                      ? 'De hora em hora, o cardápio daqui segue o de lá.'
                      : 'Desligado, o cardápio daqui é independente do de lá.'}
                    acao={
                      <Chave
                        ativo={ifood.sincronizacao === 'do_ifood'}
                        onAlternar={() => void salvarIfood({
                          sincronizacao: ifood.sincronizacao === 'do_ifood' ? 'nenhuma' : 'do_ifood',
                        })}
                      />
                    }
                  />
                )}

                {ifood.merchant_id && ifood.sincronizacao !== 'do_ifood' && (
                  <Linha
                    titulo="Enviar meu cardápio para o iFood"
                    descricao="Você aperta quando quiser — não fica enviando sozinho."
                    acao={
                      <Button type="button" variant="outline" size="sm"
                        className="h-[34px] whitespace-nowrap"
                        disabled={conferindo || publicando} onClick={() => void conferirPublicacao()}>
                        {conferindo ? <Loader2 className="size-4 animate-spin" /> : 'Ver o que vai'}
                      </Button>
                    }
                  >
                    {/*
                      A PRÉVIA NÃO É ENFEITE. No iFood, enviar um item substitui
                      o item inteiro do lado de lá. Ver a lista antes é o que
                      separa "atualizei meu cardápio" de "apaguei os
                      complementos de um produto que estava vendendo".
                    */}
                    {publicacao && (
                      <div className="mt-4 space-y-3">
                        {publicacao.previa.length === 0 ? (
                          <p className="text-[12.5px] text-muted-foreground">Nenhum produto para enviar.</p>
                        ) : (
                          <>
                            <p className="text-[13px] font-bold">
                              {publicacao.previa.length} produto(s) para enviar
                            </p>
                            <ul className="max-h-52 space-y-1 overflow-y-auto text-[12.5px] text-muted-foreground">
                              {publicacao.previa.map(p => (
                                <li key={p.codigo} className="flex items-baseline justify-between gap-3">
                                  <span className="truncate">{p.nome}</span>
                                  <span className="shrink-0 text-[11.5px] opacity-70">
                                    {p.acao === 'criar' ? 'novo lá' : 'atualiza o que já existe'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            <Button type="button" className="h-[38px] whitespace-nowrap"
                              disabled={publicando} onClick={() => void publicar()}>
                              {publicando ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                              Enviar {publicacao.previa.length} produto(s)
                            </Button>
                          </>
                        )}

                        {/*
                          Os que FICARAM DE FORA importam tanto quanto os que
                          vão: um produto sem preço aqui iria a R$ 0,01 no lugar
                          onde o cliente compra.
                        */}
                        {publicacao.semPreco.length > 0 && (
                          <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 text-[12px] leading-relaxed text-muted-foreground">
                            <b className="text-amber-700 dark:text-amber-500">Ficaram de fora por não ter preço:</b>{' '}
                            {publicacao.semPreco.join(', ')}. Enviar assim colocaria
                            esses produtos a R$ 0,01 no iFood.
                          </div>
                        )}
                        {publicacao.semCodigo.length > 0 && (
                          <p className="text-[12px] text-muted-foreground">
                            {publicacao.semCodigo.length} produto(s) sem código de barras ficaram de fora.
                          </p>
                        )}
                      </div>
                    )}
                  </Linha>
                )}

                <Sanfona titulo="Como funciona a sincronização">
                  <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                    <li>· <b className="text-foreground">Quem manda passa a ser o iFood.</b> Nome, descrição e complementos que você mudar aqui voltam ao que está lá no próximo ciclo.</li>
                    <li>· <b className="text-foreground">O preço continua seu.</b> Nunca é sincronizado — o do iFood embute a comissão que no seu link não existe.</li>
                    <li>· <b className="text-foreground">Nada é apagado.</b> Produto removido de lá continua aqui, do jeito que está.</li>
                    <li>· <b className="text-foreground">O iFood precisa autorizar.</b> Além de ligar aqui, eles aprovam o acesso do nosso aplicativo à sua loja, uma loja por vez.</li>
                  </ul>
                </Sanfona>
              </>
            )}
          </>
        )}
      </ModalIntegracao>

      {/* ─────────────────────── WhatsApp ─────────────────────── */}
      <ModalIntegracao
        aberta={aberta === 'whatsapp'} aoFechar={() => setAberta(null)}
        logo={logoZap(zapOk)} nome="WhatsApp"
        status={zapOk ? 'Avisando o cliente' : 'Desligado'}
      >
        {/*
          A TELA DE VERDADE, aqui dentro. Ela saiu do menu de configurações a
          pedido: WhatsApp é conexão com sistema de fora, e o lugar onde o
          lojista procura isso é Integrações — não "Aparência e acesso".
        */}
        <div className="px-5 py-5">
          <WhatsAppLoja semCabecalho />
        </div>
      </ModalIntegracao>

      {/* ─────────────────────── Maquininha ─────────────────────── */}
      <ModalIntegracao
        aberta={aberta === 'tef'} aoFechar={() => setAberta(null)}
        logo={logoTef(!!tef?.configurado)} nome="Maquininha (TEF)"
        status={tefStatus}
      >
        {/*
          A CONFIGURAÇÃO MUDOU DE CASA. Era uma aba dentro de Pagamentos, ao
          lado de Pix e cartão online — e não é a mesma natureza: aqueles são
          dinheiro que cai pela internet e se configura uma vez; esta é aparelho
          de terceiro, que quebra por conta própria. Quando o lojista pensa "a
          maquininha parou", ele não pensa em ir a Pagamentos.
        */}
        <div className="px-5 py-5">
          <PainelTef estado={tef} aoMudar={setTef} />
        </div>
      </ModalIntegracao>

      {/* ───────────────────────── Maxx Gestão ───────────────────────── */}
      <ModalIntegracao
        aberta={aberta === 'erp'} aoFechar={() => setAberta(null)}
        logo={logoErp(erpEmitindo)} nome="Maxx Gestão"
        status={erpEmitindo ? 'Emitindo a NFC-e' : 'Não está emitindo'}
      >
        <PainelMaxxGestao
          emissor={tef?.nfce_emissor ?? 'sistema'}
          aoMudarEmissor={mudarEmissor}
        />
      </ModalIntegracao>

      {/* ─────────────────────── Impressão ─────────────────────── */}
      <ModalIntegracao
        aberta={aberta === 'impressao'} aoFechar={() => setAberta(null)}
        logo={logoImpressao(agenteOk)} nome="Impressão automática"
        status={agenteOk ? (agente?.impressora || 'Agente conectado') : 'Agente não detectado'}
      >
        <div className="space-y-4 px-5 py-6">
          <p className="max-w-[46ch] text-[13px] leading-relaxed text-muted-foreground">
            {agenteOk
              ? 'O agente está rodando neste computador e imprime o cupom direto na impressora térmica.'
              : 'O agente roda no computador do caixa e imprime o cupom direto na impressora térmica. Ele não foi detectado aqui — pode estar fechado, ou este não é o computador do caixa.'}
          </p>
          <Button asChild className="h-[38px] whitespace-nowrap">
            <a href={linkSecao('impressao')}>Configurar impressão</a>
          </Button>
        </div>
      </ModalIntegracao>
    </div>
  );
}
