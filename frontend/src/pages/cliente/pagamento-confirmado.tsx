/**
 * Tela de "pagamento confirmado" — o momento de alívio do cliente.
 *
 * Aparece entre o Pix cair e o acompanhamento do pedido. Existe porque, antes,
 * o app pulava direto pra tela de acompanhamento com um toast: funcionava, mas
 * o instante mais importante da compra (o dinheiro saiu, deu certo?) passava
 * sem confirmação visual clara.
 *
 * CORES: só tokens do tema (`primary`, `success`, `card`…), então acompanha a
 * marca configurada no admin. Nada de hex fixo.
 *
 * MOVIMENTO: respeita `prefers-reduced-motion` via `useReducedMotion()` — nesse
 * caso tudo aparece estático, sem percurso nem flutuação.
 */
import { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Bike, Store, Home, Check } from 'lucide-react';
import { brl } from '@/lib/format';

export function PagamentoConfirmado({
  pedidoId, totalCentavos, onContinuar, segundos = 3.2,
}: {
  pedidoId: number;
  totalCentavos?: number;
  /** Chamado ao fim da animação (ou no clique) — segue pro acompanhamento. */
  onContinuar: () => void;
  segundos?: number;
}) {
  const semMovimento = useReducedMotion();

  // Avança sozinho: a tela é comemoração, não uma etapa a mais pra clicar.
  useEffect(() => {
    const t = setTimeout(onContinuar, semMovimento ? 1200 : segundos * 1000);
    return () => clearTimeout(t);
    // onContinuar entra como ref estável do chamador; não recriar o timer a cada
    // render (foi exatamente esse tipo de dependência que gerou loop antes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mola = { type: 'spring' as const, stiffness: 260, damping: 18 };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center"
    >
      {/* Selo de confirmação */}
      <motion.div
        initial={semMovimento ? { opacity: 0 } : { scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={semMovimento ? { duration: 0.2 } : { ...mola, delay: 0.1 }}
        className="relative flex size-24 items-center justify-center rounded-full bg-success/15"
      >
        {/* Anel que expande e desaparece, tipo "confirmado agora" */}
        {!semMovimento && (
          <motion.span
            initial={{ scale: 0.9, opacity: 0.6 }}
            animate={{ scale: 1.6, opacity: 0 }}
            transition={{ duration: 1.1, delay: 0.35, repeat: 1 }}
            className="absolute inset-0 rounded-full border-2 border-success"
          />
        )}
        <svg viewBox="0 0 24 24" className="size-11 text-success" fill="none"
          stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <motion.path
            d="M4 12.5 L9.5 18 L20 6"
            initial={semMovimento ? { pathLength: 1 } : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.45, delay: 0.3, ease: 'easeOut' }}
          />
        </svg>
      </motion.div>

      <motion.h1
        initial={semMovimento ? { opacity: 0 } : { y: 14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.45, duration: 0.4 }}
        className="mt-6 text-2xl font-black tracking-tight"
      >
        Pagamento confirmado!
      </motion.h1>

      <motion.p
        initial={semMovimento ? { opacity: 0 } : { y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.55, duration: 0.4 }}
        className="mt-2 max-w-xs text-sm text-muted-foreground"
      >
        {totalCentavos ? <>Recebemos <b className="text-foreground">{brl(totalCentavos)}</b>. </> : null}
        Seu pedido já foi enviado pra loja.
      </motion.p>

      {/* Percurso: da loja até a casa, com o entregador saindo agora */}
      <motion.div
        initial={semMovimento ? { opacity: 0 } : { y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.7, duration: 0.4 }}
        className="mt-10 w-full max-w-xs"
      >
        <div className="relative flex items-center justify-between">
          {/* estrada */}
          <div className="absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 border-t-2 border-dashed border-border" />

          <span className="relative z-10 flex size-11 items-center justify-center rounded-2xl border border-border bg-card text-primary">
            <Store className="size-5" />
          </span>

          {/* entregador percorrendo o trecho */}
          {semMovimento ? (
            <span className="relative z-10 flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
              <Bike className="size-5" />
            </span>
          ) : (
            <motion.span
              initial={{ x: -68, opacity: 0 }}
              animate={{ x: [-68, 0, 0], opacity: [0, 1, 1], y: [0, -3, 0] }}
              transition={{ delay: 0.9, duration: 1.6, ease: 'easeInOut', times: [0, 0.75, 1] }}
              className="relative z-10 flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30"
            >
              <Bike className="size-5" />
            </motion.span>
          )}

          <span className="relative z-10 flex size-11 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
            <Home className="size-5" />
          </span>
        </div>

        <div className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Check className="size-3.5 text-success" /> Pedido #{pedidoId} confirmado
        </div>
      </motion.div>

      <motion.button
        type="button"
        onClick={onContinuar}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4 }}
        className="mt-10 text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Acompanhar meu pedido
      </motion.button>
    </motion.div>
  );
}
