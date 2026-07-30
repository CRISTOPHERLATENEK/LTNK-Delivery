import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query';
import './index.css';
import App from './App';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm';
import { TemaProvider } from '@/components/tema-provider';
import { ErrorBoundary } from '@/components/error-boundary';
import { iniciarMonitoramento } from '@/lib/monitoramento';
import { ApiError } from '@/lib/api';
import { aparenciaDoErro } from '@/lib/erro';
import { emitirToast } from '@/lib/toast-bus';

iniciarMonitoramento();

/**
 * REDE DE SEGURANÇA: nenhuma consulta falha em silêncio.
 *
 * O projeto tem 61 `useQuery`. Tratar erro em cada uma é o ideal, mas depende de
 * nunca esquecer nenhuma — e o que se via era tela em skeleton pra sempre, sem
 * explicação. Este gancho fica no cache, então vale pra todas de uma vez, hoje e
 * nas que vierem depois. Onde a falha merece a tela inteira, a tela usa <Falha>
 * (components/ui/estado) e este toast não substitui isso.
 *
 * Duas regras que impedem isto de virar spam:
 *
 * 1. Só avisa quando NÃO há dado em cache. Se a tela está mostrando algo, uma
 *    revalidação que falhou não deve interromper ninguém — o que cobre esse caso
 *    é a faixa de offline. Sem esta regra, um polling de 4s caído dispararia
 *    toast a cada 4 segundos.
 * 2. Mesma mensagem em menos de 6s é engolida. Várias consultas da mesma tela
 *    falham juntas quando a rede cai, e três avisos idênticos empilhados não
 *    informam mais que um.
 *
 * 401/403 fica de fora: `api()` já encerra a sessão e a navegação vai pro login;
 * toast durante esse redirecionamento é ruído em cima de uma ação já resolvida.
 */
let ultimoAviso = { msg: '', em: 0 };

const cacheDeConsultas = new QueryCache({
  onError: (erro, consulta) => {
    if (consulta.state.data !== undefined) return;
    const status = erro instanceof ApiError ? erro.status : -1;
    if (status === 401 || status === 403) return;

    const { titulo, texto } = aparenciaDoErro(erro);
    const agora = Date.now();
    if (titulo === ultimoAviso.msg && agora - ultimoAviso.em < 6000) return;
    ultimoAviso = { msg: titulo, em: agora };

    emitirToast({ tipo: 'erro', titulo, descricao: texto });
  },
});

const queryClient = new QueryClient({
  queryCache: cacheDeConsultas,
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <TemaProvider>
            <ToastProvider>
              <ConfirmProvider>
                <App />
              </ConfirmProvider>
            </ToastProvider>
          </TemaProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
