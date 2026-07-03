import { Badge } from './badge';
import type { StatusPedido } from '@/types';

const ROTULOS: Record<StatusPedido, string> = {
  pendente: 'Pendente', aceito: 'Aceito', preparando: 'Preparando',
  pronto: 'Pronto', em_entrega: 'Em entrega', entregue: 'Entregue',
  cancelado: 'Cancelado', recusado: 'Recusado',
};

const VARIANTES: Record<StatusPedido, 'warning' | 'info' | 'success' | 'danger'> = {
  pendente: 'warning',
  aceito: 'info',
  preparando: 'info',
  pronto: 'info',
  em_entrega: 'info',
  entregue: 'success',
  cancelado: 'danger',
  recusado: 'danger',
};

export function StatusBadge({ status }: { status: StatusPedido }) {
  return <Badge variant={VARIANTES[status]}>{ROTULOS[status]}</Badge>;
}

export { ROTULOS as ROTULOS_STATUS };
