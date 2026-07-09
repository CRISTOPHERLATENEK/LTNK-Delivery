/** Re-exporta o tipo canônico (definido em @/types, compartilhado com o storefront). */
export type { VisualJson } from '@/types';
import type { VisualJson } from '@/types';

/** Estado do formulário: campos dedicados da loja + toda a árvore VisualJson, achatados. */
export type EstadoVisual = {
  nome: string;
  cor_marca: string;
  cor_secundaria: string;
  logo_url: string;
  capa_url: string;
  favicon_url: string;
} & VisualJson;
