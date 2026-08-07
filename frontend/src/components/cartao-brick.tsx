/**
 * FORMULÁRIO DE CARTÃO DENTRO DA LOJA (Checkout Bricks do Mercado Pago).
 *
 * POR QUE ISTO EXISTE, tendo o Checkout Pro funcionando: no Pro o cliente SAI da
 * loja pra pagar. Em delivery isso custa venda — a pessoa monta o carrinho, é
 * jogada num domínio que não é o da loja, e cada passo fora é um lugar pra
 * desistir.
 *
 * POR QUE NÃO É PIOR EM SEGURANÇA: os campos de cartão não são nossos. O SDK
 * monta iframes servidos pelo próprio Mercado Pago, e o que sai daqui é um
 * TOKEN de uso único. O número do cartão não passa pelo nosso JavaScript nem
 * pelo nosso servidor — é o que mantém o escopo de PCI no mesmo nível do
 * redirecionamento (SAQ A).
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { brl } from '@/lib/format';

const URL_SDK = 'https://sdk.mercadopago.com/js/v2';

/**
 * Carrega o SDK uma vez só por página.
 *
 * A promessa fica em módulo, não em estado: se o cliente fechar e reabrir o
 * formulário, ou se dois componentes montarem juntos, um segundo <script> do
 * mesmo SDK redefiniria o `window.MercadoPago` no meio do uso.
 */
let promessaSdk: Promise<void> | null = null;
function carregarSdk(): Promise<void> {
  if (promessaSdk) return promessaSdk;
  promessaSdk = new Promise((resolve, reject) => {
    if ((window as any).MercadoPago) return resolve();
    const s = document.createElement('script');
    s.src = URL_SDK;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      // Deixa tentar de novo numa próxima abertura: falha de rede aqui não pode
      // condenar a sessão inteira a nunca mais carregar o formulário.
      promessaSdk = null;
      reject(new Error('Não consegui carregar o formulário de cartão.'));
    };
    document.head.appendChild(s);
  });
  return promessaSdk;
}

interface Props {
  pedidoId: number;
  publicKey: string;
  totalCentavos: number;
  /** Pagamento aprovado — o pai leva pro acompanhamento do pedido. */
  onAprovado: () => void;
  onCancelar: () => void;
}

export function CartaoBrick({ pedidoId, publicKey, totalCentavos, onAprovado, onCancelar }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const brickRef = useRef<{ unmount: () => void } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);

  /*
   * Refs pros callbacks: o brick é criado UMA vez e guarda as funções que
   * recebeu. Sem isso, `onAprovado` congelaria na versão do primeiro render e
   * o pai nunca seria avisado.
   */
  const onAprovadoRef = useRef(onAprovado);
  onAprovadoRef.current = onAprovado;

  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        await carregarSdk();
        if (!vivo || !containerRef.current) return;

        const mp = new (window as any).MercadoPago(publicKey, { locale: 'pt-BR' });
        const bricks = mp.bricks();

        brickRef.current = await bricks.create('cardPayment', 'cartao-brick-container', {
          initialization: { amount: totalCentavos / 100 },
          customization: {
            visual: { hidePaymentButton: false },
            // Só crédito e débito: boleto e Pix têm caminho próprio no app, e
            // repetir aqui daria dois lugares pra mesma coisa.
            paymentMethods: { types: { included: ['credit_card', 'debit_card'] } },
          },
          callbacks: {
            onReady: () => { if (vivo) setCarregando(false); },
            /*
             * O SDK espera uma PROMESSA: enquanto ela não resolve, ele mantém o
             * botão travado e o spinner rodando. Resolver cedo demais deixaria o
             * cliente clicar duas vezes — e o segundo clique é uma segunda
             * cobrança (a idempotência no servidor cobre, mas não é motivo pra
             * deixar acontecer).
             */
            onSubmit: (dados: Record<string, unknown>) => new Promise<void>((resolve, reject) => {
              setProcessando(true);
              setErro('');
              api<{ status: string; status_detail: string; pagamento_status: string }>(
                'POST', `/api/cliente/pedidos/${pedidoId}/pagar-cartao`, dados,
              )
                .then(r => {
                  if (r.pagamento_status === 'aprovado' || r.status === 'approved') {
                    resolve();
                    onAprovadoRef.current();
                    return;
                  }
                  /*
                   * `in_process` é análise antifraude, não recusa: o pedido fica
                   * aguardando e a confirmação chega pelo webhook ou pela
                   * conferência automática. Dizer "recusado" aqui assustaria o
                   * cliente de um pagamento que provavelmente vai passar.
                   */
                  if (r.status === 'in_process' || r.status === 'pending') {
                    resolve();
                    onAprovadoRef.current();
                    return;
                  }
                  setErro(mensagemRecusa(r.status_detail));
                  reject();
                })
                .catch(e => {
                  setErro(e instanceof ApiError ? e.message : 'Não consegui processar o pagamento.');
                  reject();
                })
                .finally(() => setProcessando(false));
            }),
            onError: (e: { message?: string }) => {
              if (vivo) { setCarregando(false); setErro(e?.message || 'Erro no formulário de cartão.'); }
            },
          },
        });
      } catch (e) {
        if (vivo) { setCarregando(false); setErro((e as Error).message); }
      }
    })();

    return () => {
      vivo = false;
      // Sem o unmount, reabrir o formulário empilha um segundo brick no mesmo
      // container e o cliente vê dois formulários.
      try { brickRef.current?.unmount(); } catch { /* já foi */ }
      brickRef.current = null;
    };
  }, [pedidoId, publicKey, totalCentavos]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-bold">Pagamento com cartão</p>
        <p className="text-sm font-bold text-primary">{brl(totalCentavos)}</p>
      </div>

      {carregando && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando formulário seguro…
        </div>
      )}

      {/* O id fixo é exigência do SDK, que procura o elemento pelo id. */}
      <div id="cartao-brick-container" ref={containerRef} />

      {erro && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          {erro}
        </p>
      )}

      <button
        type="button"
        onClick={onCancelar}
        disabled={processando}
        className="w-full py-2 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        Escolher outra forma de pagamento
      </button>

      <p className="text-center text-[11px] text-muted-foreground">
        Seus dados de cartão são digitados em campos do Mercado Pago e não passam pela loja.
      </p>
    </div>
  );
}

/**
 * Traduz o motivo da recusa pra algo que o cliente possa AGIR.
 *
 * O `status_detail` do Mercado Pago é para desenvolvedor
 * (`cc_rejected_insufficient_amount`). Mostrar isso na tela faz o cliente
 * desistir sem saber que bastava usar outro cartão.
 */
function mensagemRecusa(detalhe: string): string {
  const mapa: Record<string, string> = {
    cc_rejected_insufficient_amount: 'Saldo ou limite insuficiente. Tente outro cartão.',
    cc_rejected_bad_filled_security_code: 'Código de segurança (CVV) incorreto.',
    cc_rejected_bad_filled_date: 'Data de validade incorreta.',
    cc_rejected_bad_filled_card_number: 'Número do cartão incorreto.',
    cc_rejected_bad_filled_other: 'Algum dado do cartão está incorreto. Confira e tente de novo.',
    cc_rejected_call_for_authorize: 'Seu banco precisa autorizar esta compra. Ligue para ele ou use outro cartão.',
    cc_rejected_card_disabled: 'Cartão desativado. Fale com seu banco ou use outro.',
    cc_rejected_duplicated_payment: 'Esse pagamento já foi feito. Confira seus pedidos antes de tentar de novo.',
    cc_rejected_high_risk: 'Pagamento não autorizado. Tente outro cartão ou outra forma de pagamento.',
    cc_rejected_max_attempts: 'Muitas tentativas com este cartão. Use outro.',
  };
  return mapa[detalhe] || 'Pagamento não autorizado. Tente outro cartão ou outra forma de pagamento.';
}
