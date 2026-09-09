/**
 * TERMOS DE USO E POLÍTICA DE PRIVACIDADE — servidos pelo próprio app.
 *
 * Antes destas páginas, `termos_url` e `politica_url` eram campos vazios no
 * admin, e vazio significava LINK NENHUM: a tela do cliente escondia a frase de
 * aceite de propósito, porque prometer "você aceita os termos" sem ter termos
 * para ler é pior que silêncio. O resultado era a plataforma operando sem
 * cumprir o dever de informar do art. 9º da LGPD.
 *
 * O CONTEÚDO DESCREVE O SISTEMA REAL, não um modelo genérico. Cada dado listado
 * na seção 2 existe como coluna no banco, e cada terceiro da seção 5 recebe
 * exatamente o que está escrito — foram levantados lendo o código, não
 * presumidos. Uma política que promete menos do que o sistema faz é uma
 * declaração falsa; uma que promete mais é a mesma coisa ao contrário.
 *
 * AO EDITAR O TEXTO, mude `VERSAO_DOCUMENTOS` em `src/backend/documentos-legais.ts`
 * no mesmo commit: é a versão gravada junto do aceite de cada pessoa, e texto
 * novo com versão antiga faz todo mundo parecer ter aceito o que não leu.
 *
 * A FAIXA DE MINUTA sai daqui quando o advogado aprovar — é o componente
 * `AvisoMinuta`, um `<Alert>` só, e a remoção é uma linha.
 */
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, FileText, AlertTriangle, Mail, Phone, Download, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTema } from '@/lib/tema';

/* ─────────────────────────── moldura comum ─────────────────────────── */

function Moldura({ icone, titulo, children }: {
  icone: React.ReactNode; titulo: string; children: React.ReactNode;
}) {
  const { marca } = useTema();
  return (
    <div className="min-h-dvh bg-muted/30">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
          <Link to="/"><ArrowLeft className="size-4" /> Voltar</Link>
        </Button>

        <div className="rounded-2xl border border-border bg-background p-5 sm:p-8 shadow-sm">
          <div className="flex items-center gap-3 border-b border-border pb-5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {icone}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold leading-tight sm:text-2xl">{titulo}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {marca.nome || 'Plataforma'}
                {marca.termos_versao && <> · versão {marca.termos_versao}</>}
              </p>
            </div>
          </div>

          {/*
            `[&>h2]` e companhia em vez de classe em cada título: o documento é
            texto corrido e longo, e repetir a formatação em trinta lugares é
            como dois títulos acabam com tamanhos diferentes.
          */}
          <div className="mt-6 space-y-4 text-sm leading-relaxed text-foreground/90
            [&>h2]:mt-8 [&>h2]:text-base [&>h2]:font-extrabold [&>h2]:text-foreground
            [&>h3]:mt-5 [&>h3]:text-sm [&>h3]:font-bold [&>h3]:text-foreground
            [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5
            [&_a]:text-primary [&_a]:underline
            [&_b]:font-semibold [&_b]:text-foreground">
            {children}
          </div>

          <div className="mt-10 border-t border-border pt-5 text-xs text-muted-foreground">
            {marca.rodape_credito_copyright || null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A faixa de minuta.
 *
 * Fica no TOPO e não no rodapé: quem abre um documento legal decide nas
 * primeiras linhas o quanto vai confiar nele, e a ressalva escondida embaixo de
 * dez seções não é ressalva.
 */
function AvisoMinuta() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
        <b>Minuta em revisão jurídica.</b> Este documento descreve fielmente como
        a plataforma funciona hoje, mas ainda não passou por análise de advogado.
        Vale como informação ao titular, e será substituído pela versão revisada.
      </p>
    </div>
  );
}

/** O bloco do encarregado — só aparece se houver alguém nomeado de fato. */
function Encarregado() {
  const { marca } = useTema();
  const nome = marca.encarregado_nome?.trim();
  const email = marca.encarregado_email?.trim();
  const telefone = marca.encarregado_telefone?.trim();
  /*
   * SEM NOME E SEM CANAL, NÃO INVENTA. Mostrar "entre em contato" sem endereço
   * seria repetir o erro que esta página veio consertar: prometer um caminho
   * que não existe. Se estiver vazio, o art. 41 simplesmente não está cumprido,
   * e é melhor que isso apareça como ausência do que como texto vago.
   */
  if (!nome && !email) return null;
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Encarregado pelo tratamento de dados
      </p>
      {nome && <p className="mt-1.5 font-semibold text-foreground">{nome}</p>}
      <div className="mt-1 space-y-0.5">
        {email && (
          <p className="flex items-center gap-1.5">
            <Mail className="size-3.5 shrink-0 text-muted-foreground" />
            <a href={`mailto:${email}`}>{email}</a>
          </p>
        )}
        {telefone && (
          <p className="flex items-center gap-1.5">
            <Phone className="size-3.5 shrink-0 text-muted-foreground" /> {telefone}
          </p>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Canal para dúvidas e para exercer seus direitos (LGPD, art. 41).
      </p>
    </div>
  );
}

/* ───────────────────────────── privacidade ───────────────────────────── */

export function Privacidade() {
  const { marca } = useTema();
  const suporte = marca.suporte_email?.trim();

  return (
    <Moldura icone={<ShieldCheck className="size-5" />} titulo="Política de privacidade">
      <AvisoMinuta />

      <p>
        Esta política explica quais dados pessoais a plataforma coleta, para quê,
        com quem compartilha, por quanto tempo guarda e como você exerce seus
        direitos. Ela vale para o site e o aplicativo de pedidos.
      </p>

      <h2>1. Quem trata seus dados</h2>
      <p>
        Cada <b>estabelecimento</b> em que você faz um pedido é o <b>controlador</b> dos
        seus dados: é ele quem decide vender, entregar e emitir a nota. A
        plataforma {marca.nome ? <b>{marca.nome}</b> : 'que hospeda a loja'} atua
        como <b>operadora</b>, tratando os dados por conta e ordem do
        estabelecimento, nos limites desta política.
      </p>
      <p>
        Isso importa na prática: seus dados de um estabelecimento <b>não são
        visíveis</b> para outro. Cada cliente da plataforma tem banco de dados
        separado, e o cadastro que você fez numa loja não aparece nas outras.
      </p>
      <Encarregado />

      <h2>2. Que dados coletamos</h2>
      <p>Só o que a operação exige. Nada de perfil publicitário ou rastreamento entre sites.</p>

      <h3>Você informa</h3>
      <ul>
        <li><b>Cadastro:</b> nome, e-mail e telefone. A senha é guardada apenas
          como <i>hash</i> (bcrypt) — nem nós conseguimos lê-la.</li>
        <li><b>CPF:</b> opcional, e usado só quando você pede a nota fiscal com CPF
          ou paga por um meio que exige identificação.</li>
        <li><b>Endereços de entrega:</b> rua, número, complemento, bairro, cidade,
          estado, CEP e ponto de referência.</li>
        <li><b>Pedido:</b> itens, valores, forma de pagamento, endereço usado na
          entrega e as observações que você escreve.</li>
        <li><b>Avaliação:</b> a nota e o comentário que você deixa sobre o pedido
          ou o entregador.</li>
        <li><b>Mensagens</b> trocadas com a loja ou o entregador no chat do pedido.</li>
      </ul>

      <h3>O sistema registra</h3>
      <ul>
        <li><b>Data do seu último acesso</b>, para segurança da conta.</li>
        <li><b>Inscrição de notificação</b>, se você autorizar avisos no navegador.</li>
        <li><b>Autenticação em duas etapas</b>, se você ativar.</li>
        <li><b>Data e versão</b> dos documentos que você aceitou.</li>
      </ul>

      <h3>O que NÃO coletamos</h3>
      <ul>
        <li>Não guardamos seu <b>endereço IP</b> nem histórico de navegação nas
          telas de cliente. Registro de IP existe apenas para ações de
          administradores da plataforma, como trilha de auditoria.</li>
        <li>Não usamos cookies de publicidade, nem compartilhamos dados para
          marketing de terceiros.</li>
        <li>Não pedimos dados sensíveis (saúde, biometria, convicções) e não há
          onde informá-los.</li>
      </ul>

      <h3>Pedido sem cadastro</h3>
      <p>
        É possível pedir informando apenas <b>nome e WhatsApp</b>. Nesse caso não
        existe senha nem histórico: a sessão serve para acompanhar aquele pedido.
      </p>

      <h2>3. Para que usamos</h2>
      <ul>
        <li>Processar, entregar e acompanhar seu pedido — <i>execução de contrato</i>
          (LGPD, art. 7º, V).</li>
        <li>Emitir documento fiscal e manter a escrituração — <i>obrigação legal</i>
          (art. 7º, II).</li>
        <li>Avisar sobre o andamento do pedido, por notificação ou WhatsApp.</li>
        <li>Prevenir fraude e proteger a conta — <i>legítimo interesse</i> (art. 7º, IX).</li>
      </ul>
      <p>
        Não tratamos seus dados para finalidade diferente destas sem avisar você antes.
      </p>

      <h2>4. Por quanto tempo guardamos</h2>
      <ul>
        <li><b>Cadastro, endereços e preferências:</b> enquanto sua conta existir.
          Você pode excluir a qualquer momento (seção 6).</li>
        <li><b>Pedidos e notas fiscais:</b> pelo prazo que a lei fiscal exige, ainda
          que você exclua a conta — nesse caso o pedido continua <b>sem identificar
          você</b>. É a exceção do art. 16, I, da LGPD.</li>
        <li><b>Trilha de auditoria administrativa:</b> seis meses, apagada automaticamente.</li>
        <li><b>Cópias de segurança:</b> mantidas por período limitado e usadas só para
          restaurar o serviço em caso de falha.</li>
      </ul>

      <h2>5. Com quem compartilhamos</h2>
      <p>
        Apenas com quem é necessário para o pedido acontecer, e apenas o dado
        necessário. Esta é a lista completa:
      </p>
      <ul>
        <li><b>O estabelecimento</b> do pedido — recebe tudo que a entrega exige, e é
          o controlador dos seus dados.</li>
        <li><b>O entregador</b> designado — recebe o endereço, seu nome e a forma de
          pagamento do pedido que ele vai levar.</li>
        <li><b>Mercado Pago</b> (pagamento online) — recebe seu <b>e-mail</b> e, quando
          informado, o <b>CPF</b>. Os dados do cartão são digitados no ambiente dele:
          a plataforma nunca vê o número do seu cartão.</li>
        <li><b>Maxx Gestão</b> (sistema de gestão e nota fiscal), nas lojas que o
          usam — recebe <b>nome, e-mail, telefone e CPF</b> para emitir a nota.</li>
        <li><b>Google</b>, se você escolher entrar com a conta Google.</li>
        <li><b>WhatsApp</b> (Meta), nas lojas que ativam o aviso por WhatsApp — recebe
          seu telefone e os dados da mensagem enviada.</li>
        <li><b>Serviço de notificação do seu navegador</b> (Google, Mozilla ou Apple,
          conforme o navegador), se você autorizar avisos.</li>
        <li><b>Cloudflare</b> (rede de entrega e proteção) e <b>Hostinger</b> (hospedagem
          dos servidores), como infraestrutura.</li>
      </ul>
      <p>
        Não vendemos seus dados, e não os cedemos para publicidade de terceiros.
      </p>

      <h2>6. Seus direitos, e onde clicar</h2>
      <p>
        A LGPD (art. 18) te dá direitos que a plataforma implementa <b>na tela</b>,
        sem depender de pedir por e-mail:
      </p>
      <ul>
        <li><b><Download className="mb-0.5 inline size-3.5" /> Baixar meus dados</b> — em
          {' '}<Link to="/conta">Conta</Link>, no fim da página. Gera um arquivo com seu
          cadastro, endereços, pedidos e avaliações naquele estabelecimento.</li>
        <li><b><UserX className="mb-0.5 inline size-3.5" /> Excluir minha conta</b> — no
          mesmo lugar. Removemos seu nome, e-mail, telefone, CPF e endereços,
          apagamos as inscrições de notificação e os favoritos, e substituímos o
          endereço gravado nos pedidos, os comentários das avaliações e o que você
          escreveu no chat. O acesso é encerrado.</li>
      </ul>
      <p>
        <b>O que a exclusão não faz, e por quê:</b> os pedidos já feitos continuam
        existindo no histórico do estabelecimento, <b>sem identificar você</b>. Nota
        fiscal emitida não pode ser desfeita, e o valor precisa continuar na
        contabilidade da loja. Sobra a venda sem dono.
      </p>
      <p>
        Você também pode pedir correção de dado incorreto, informação sobre com
        quem compartilhamos, ou revogar o consentimento de notificações — pelo
        canal do encarregado acima
        {suporte && <>, ou por <a href={`mailto:${suporte}`}>{suporte}</a></>}.
      </p>

      <h2>7. Segurança</h2>
      <ul>
        <li>Todo o tráfego é cifrado (HTTPS).</li>
        <li>Senhas guardadas só como <i>hash</i> bcrypt, nunca em texto.</li>
        <li>Cada cliente da plataforma tem banco de dados separado — o dado de uma
          loja não alcança outra.</li>
        <li>Autenticação em duas etapas disponível para contas administrativas.</li>
        <li>Limite de tentativas em login, cadastro e recuperação de senha.</li>
        <li>Cópias de segurança automáticas diárias.</li>
      </ul>

      <h2>8. Menores de idade</h2>
      <p>
        A plataforma não é destinada a menores de 18 anos, e lojas que vendem
        bebida alcoólica ou tabaco só podem entregar a maiores de 18, com
        conferência de documento na entrega.
      </p>

      <h2>9. Mudanças nesta política</h2>
      <p>
        Quando o texto mudar, a versão indicada no topo muda também, e o novo
        aceite é registrado. Alteração relevante é comunicada no aplicativo.
      </p>

      <h2>10. Reclamação à autoridade</h2>
      <p>
        Se você não ficar satisfeito com nossa resposta, pode reclamar à
        <b> Autoridade Nacional de Proteção de Dados (ANPD)</b>, em{' '}
        <a href="https://www.gov.br/anpd" target="_blank" rel="noreferrer">gov.br/anpd</a>.
      </p>

      <p className="!mt-8 text-xs text-muted-foreground">
        Documento relacionado: <Link to="/termos">Termos de uso</Link>.
      </p>
    </Moldura>
  );
}

/* ─────────────────────────────── termos ─────────────────────────────── */

export function Termos() {
  const { marca } = useTema();
  const suporte = marca.suporte_email?.trim();
  const telefone = marca.suporte_telefone?.trim();

  return (
    <Moldura icone={<FileText className="size-5" />} titulo="Termos de uso">
      <AvisoMinuta />

      <p>
        Estes termos regem o uso do site e do aplicativo de pedidos. Ao criar
        conta ou finalizar um pedido, você concorda com eles.
      </p>

      <h2>1. O que a plataforma é, e o que não é</h2>
      <p>
        {marca.nome ? <b>{marca.nome}</b> : 'A plataforma'} é a ferramenta pela qual
        o estabelecimento vende. <b>Quem vende, prepara e entrega é o
        estabelecimento</b>, e é com ele que você contrata a compra: preço,
        disponibilidade, qualidade do produto, prazo e condições de entrega são
        responsabilidade dele.
      </p>
      <p>
        A plataforma responde pelo funcionamento do software — o pedido chegar à
        loja, o pagamento ser processado, o acompanhamento funcionar.
      </p>

      <h2>2. Sua conta</h2>
      <ul>
        <li>Os dados que você informa devem ser verdadeiros, especialmente o
          endereço e o telefone: é por eles que a entrega chega.</li>
        <li>A senha é pessoal. Pedidos feitos na sua sessão são considerados seus.</li>
        <li>Você pode pedir <b>sem criar conta</b>, informando nome e WhatsApp. Nesse
          caso não há senha nem histórico salvo.</li>
        <li>É preciso ter <b>18 anos ou mais</b> para usar a plataforma.</li>
      </ul>

      <h2>3. Pedidos, preços e pagamento</h2>
      <ul>
        <li>O preço e a taxa de entrega mostrados no fechamento do pedido são os
          que valem para aquele pedido.</li>
        <li>O estabelecimento pode <b>recusar</b> um pedido — por item em falta,
          endereço fora da área de entrega ou fechamento da loja. Pagamento
          online de pedido recusado é devolvido.</li>
        <li>Formas pagas <b>no ato da entrega ou da retirada</b> (dinheiro, cartão na
          maquininha, Pix na hora) são acertadas diretamente com a loja ou o
          entregador. A plataforma não intermedeia esse valor.</li>
        <li>Pagamento online é processado pelo <b>Mercado Pago</b>. A plataforma não
          armazena dados do seu cartão.</li>
        <li><b>Bebida alcoólica e tabaco</b> só são entregues a maiores de 18 anos,
          com apresentação de documento. Sem isso, a entrega pode ser recusada.</li>
      </ul>

      <h2>4. Cancelamento e devolução</h2>
      <p>
        Pedido de alimento preparado sob encomenda não admite desistência depois
        de iniciado o preparo (art. 49 do Código de Defesa do Consumidor,
        parágrafo único). Antes disso, o cancelamento é possível — fale com a
        loja pelo chat do pedido. Problema com o produto entregue se resolve com
        o estabelecimento, que responde por ele.
      </p>

      <h2>5. Uso indevido</h2>
      <p>A conta pode ser bloqueada em caso de:</p>
      <ul>
        <li>pedido feito com dado falso ou endereço inexistente, de forma reiterada;</li>
        <li>tentativa de burlar pagamento, cupom ou limite de promoção;</li>
        <li>ofensa a funcionário da loja ou a entregador no chat;</li>
        <li>tentativa de acesso não autorizado ao sistema.</li>
      </ul>

      <h2>6. Conteúdo que você escreve</h2>
      <p>
        Avaliações e comentários são seus, e você responde por eles. Podemos
        remover conteúdo ilegal, ofensivo ou que exponha dado de terceiro. A
        avaliação fica visível para a loja e pode aparecer publicamente na
        vitrine dela.
      </p>

      <h2>7. Indisponibilidade</h2>
      <p>
        Nos esforçamos para manter o serviço no ar, mas ele pode ficar
        indisponível por manutenção, falha de infraestrutura ou de terceiros
        (pagamento, internet, energia). Não há garantia de disponibilidade
        ininterrupta.
      </p>

      <h2>8. Seus dados</h2>
      <p>
        O tratamento dos seus dados pessoais está descrito na{' '}
        <Link to="/privacidade">Política de privacidade</Link>, que faz parte destes
        termos.
      </p>

      <h2>9. Mudanças</h2>
      <p>
        Estes termos podem mudar. A versão indicada no topo identifica o texto em
        vigor, e a data do seu aceite fica registrada na sua conta. Mudança
        relevante é comunicada no aplicativo.
      </p>

      <h2>10. Lei e foro</h2>
      <p>
        Aplica-se a lei brasileira. Fica eleito o foro do domicílio do
        consumidor para as questões relativas a estes termos.
      </p>

      <h2>11. Contato</h2>
      <p>
        {suporte
          ? <>Fale com a gente em <a href={`mailto:${suporte}`}>{suporte}</a>{telefone && <> ou {telefone}</>}.</>
          : 'Use o canal de atendimento indicado no aplicativo.'}
      </p>
      <p className="text-xs text-muted-foreground">
        Assuntos sobre dados pessoais vão para o encarregado indicado na{' '}
        <Link to="/privacidade">Política de privacidade</Link>.
      </p>
    </Moldura>
  );
}
