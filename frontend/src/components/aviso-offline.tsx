/**
 * Faixa global de "sem internet".
 *
 * POR QUE EXISTE: o cliente montava o carrinho, tocava em finalizar e só então
 * descobria que estava sem rede — no elevador, no subsolo, no ônibus. O erro
 * chegava como toast genérico, depois do trabalho perdido. Saber ANTES muda a
 * decisão: ele espera o sinal voltar em vez de repetir o toque achando que o app
 * travou.
 *
 * Decisões de comportamento:
 *  - `fixed` no rodapé (acima da nav) em vez de empurrar o conteúdo: aparecer e
 *    desaparecer no meio de uma rolagem, deslocando tudo, é pior que o problema.
 *  - Anuncia a VOLTA por ~2s. Sem isso a faixa simplesmente sumia e a pessoa não
 *    sabia se já podia tentar de novo.
 *  - `navigator.onLine` é otimista: ele diz "há uma interface de rede", não "a
 *    internet funciona". Por isso a faixa é um AVISO, e quem dá a palavra final
 *    é a falha real da requisição (ApiError.semRede, em components/ui/estado).
 */
import { useEffect, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AvisoOffline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [anunciarVolta, setAnunciarVolta] = useState(false);

  useEffect(() => {
    const caiu = () => { setOnline(false); setAnunciarVolta(false); };
    const voltou = () => { setOnline(true); setAnunciarVolta(true); };
    window.addEventListener('offline', caiu);
    window.addEventListener('online', voltou);
    return () => {
      window.removeEventListener('offline', caiu);
      window.removeEventListener('online', voltou);
    };
  }, []);

  useEffect(() => {
    if (!anunciarVolta) return;
    const t = setTimeout(() => setAnunciarVolta(false), 2200);
    return () => clearTimeout(t);
  }, [anunciarVolta]);

  if (online && !anunciarVolta) return null;

  return (
    <div
      // role=status + aria-live: leitor de tela anuncia a mudança sem roubar o
      // foco de onde a pessoa está.
      role="status"
      aria-live="polite"
      className={cn(
        /*
         * TOPO, não rodapé: o rodapé de celular já tem a nav (z-30) e o banner
         * de "pedido em andamento" (App.tsx), que ocupa exatamente
         * `bottom-[72px] inset-x-3 z-40` — cliente offline com pedido a caminho
         * veria os dois empilhados no mesmo ponto. No topo não disputa com nada.
         *
         * z-40 passa por cima do cabeçalho (z-20) de propósito, e fica abaixo do
         * toast (z-100) e do confirm (z-110): aviso de rede não pode tapar uma
         * confirmação que espera resposta.
         */
        'fixed inset-x-3 top-3 z-40 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5',
        'text-sm font-semibold shadow-lg lg:inset-x-auto lg:left-1/2 lg:-translate-x-1/2',
        online
          ? 'bg-emerald-600 text-white'
          : 'bg-amber-500 text-amber-950',
      )}
    >
      {online ? <Wifi className="size-4 shrink-0" /> : <WifiOff className="size-4 shrink-0" />}
      {online ? 'Conexão restabelecida' : 'Sem internet — o app está mostrando dados salvos'}
    </div>
  );
}
