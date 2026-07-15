/**
 * Rota raiz do cliente ("/"): decide entre redirecionar pra "loja padrão"
 * (quando configurada em Marca → Configurações) ou mostrar a landing do
 * produto. O antigo marketplace genérico (lista de várias lojas na home)
 * foi removido — o modelo é white-label: cada loja vive no próprio
 * domínio/slug (ver dominio_personalizado / /loja/:id), a home não precisa
 * listar lojas de terceiros.
 */
import { Navigate } from 'react-router-dom';
import { useTema } from '@/lib/tema';
import { PaginaLanding } from './landing';

export function PaginaVitrine() {
  const { marca } = useTema();
  if (marca.loja_id > 0) {
    return <Navigate to={`/loja/${marca.loja_id}`} replace />;
  }
  return <PaginaLanding />;
}
