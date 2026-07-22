/**
 * Rota raiz do cliente ("/"): mostra o cardápio direto (sem redirect pra
 * "/:id" — cada domínio já É uma loja só, o id não deveria aparecer na
 * URL) quando o tenant tem uma "loja padrão" configurada em Marca →
 * Configurações; senão mostra a landing do produto. O antigo marketplace
 * genérico (lista de várias lojas na home) foi removido — o modelo é
 * white-label: cada loja vive no próprio domínio/slug.
 */
import { useTema } from '@/lib/tema';
import { PaginaLanding } from './landing';
import { PaginaLoja } from './loja';
import { ClienteLayout } from '@/App';

export function PaginaVitrine() {
  const { marca } = useTema();
  if (marca.loja_id > 0) {
    return <ClienteLayout><PaginaLoja idFixo={marca.loja_id} /></ClienteLayout>;
  }
  return <PaginaLanding />;
}
