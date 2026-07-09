import type { EstadoVisual } from './types';

type PresetVisual = Partial<Pick<EstadoVisual, 'cor_marca' | 'cor_secundaria'>> & {
  cores?: Partial<EstadoVisual['cores']>;
  botoes?: Partial<EstadoVisual['botoes']>;
  tipografia?: Partial<EstadoVisual['tipografia']>;
  cardapio?: Partial<EstadoVisual['cardapio']>;
};

/**
 * Presets client-side — só preenchem um ponto de partida (cores/tipografia/
 * botões). NÃO é uma tabela nova no banco: o usuário ainda precisa clicar
 * Salvar depois de escolher um.
 */
export const PRESETS_TEMA: Record<string, { label: string; preset: PresetVisual }> = {
  classico: {
    label: 'Clássico',
    preset: {
      cor_marca: '#b91c1c', cor_secundaria: '#7f1d1d',
      botoes: { raio: 10, gradiente: false, sombra: true, animacao: 'nenhuma' },
      tipografia: { fonte: 'inter', peso: 600 } as any,
      cardapio: { raio_bordas: 10 } as any,
    },
  },
  moderno: {
    label: 'Moderno',
    preset: {
      cor_marca: '#7c3aed', cor_secundaria: '#2563eb',
      botoes: { raio: 999, gradiente: true, sombra: true, animacao: 'scale' },
      tipografia: { fonte: 'poppins', peso: 700 } as any,
      cardapio: { raio_bordas: 20 } as any,
    },
  },
  minimalista: {
    label: 'Minimalista',
    preset: {
      cor_marca: '#18181b', cor_secundaria: '#52525b',
      cores: { cor_fundo: '#fafafa', cor_cards: '#ffffff' },
      botoes: { raio: 6, gradiente: false, sombra: false, animacao: 'nenhuma' },
      tipografia: { fonte: 'inter', peso: 500 } as any,
      cardapio: { raio_bordas: 6 } as any,
    },
  },
  premium: {
    label: 'Premium',
    preset: {
      cor_marca: '#b45309', cor_secundaria: '#18181b',
      cores: { cor_fundo: '#fffbeb' },
      botoes: { raio: 12, gradiente: true, sombra: true, animacao: 'glow' },
      tipografia: { fonte: 'montserrat', peso: 700 } as any,
      cardapio: { raio_bordas: 18 } as any,
    },
  },
  escuro: {
    label: 'Escuro',
    preset: {
      cor_marca: '#dc2640', cor_secundaria: '#ef4444',
      cores: { cor_fundo: '#0f0f10', cor_cards: '#1c1c1e', cor_texto: '#f4f4f5', cor_cabecalho: '#000000', cor_rodape: '#000000' },
      botoes: { raio: 12, gradiente: false, sombra: true, animacao: 'nenhuma' },
      tipografia: { fonte: 'inter', peso: 600 } as any,
      cardapio: { raio_bordas: 14 } as any,
    },
  },
  vermelho: { label: 'Vermelho', preset: { cor_marca: '#dc2626', cor_secundaria: '#991b1b' } },
  verde: { label: 'Verde', preset: { cor_marca: '#16a34a', cor_secundaria: '#166534' } },
  azul: { label: 'Azul', preset: { cor_marca: '#2563eb', cor_secundaria: '#1e40af' } },
  roxo: { label: 'Roxo', preset: { cor_marca: '#9333ea', cor_secundaria: '#6b21a8' } },
  laranja: { label: 'Laranja', preset: { cor_marca: '#ea580c', cor_secundaria: '#c2410c' } },
};
