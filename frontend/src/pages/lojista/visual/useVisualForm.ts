import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { DEFAULT_VISUAL, parseVisualJson } from '@/lib/visual';
import { useToast } from '@/components/ui/toast';
import type { EstadoVisual } from './types';

function montarEstado(loja: any): EstadoVisual {
  const visual = parseVisualJson(loja.visual_json);
  return {
    nome: loja.nome || '',
    cor_marca: loja.cor_marca || '#dc2640',
    cor_secundaria: loja.cor_secundaria || '',
    logo_url: loja.logo_url || '',
    capa_url: loja.capa_url || '',
    favicon_url: loja.favicon_url || '',
    ...visual,
  };
}

/** Acesso/atualização por caminho tipo "cores.cor_botoes" ou "nome" (raso, só 2 níveis). */
function lerCaminho(obj: any, caminho: string): any {
  return caminho.split('.').reduce((v, k) => (v == null ? v : v[k]), obj);
}
function comCaminho(obj: any, caminho: string, valor: any): any {
  const partes = caminho.split('.');
  if (partes.length === 1) return { ...obj, [partes[0]]: valor };
  const [raiz, campo] = partes;
  return { ...obj, [raiz]: { ...obj[raiz], [campo]: valor } };
}

export function useVisualForm() {
  const { mostrar } = useToast();
  const [lojaId, setLojaId] = useState<number | null>(null);
  const [estado, setEstado] = useState<EstadoVisual>({ ...DEFAULT_VISUAL, nome: '', cor_marca: '#dc2640', cor_secundaria: '', logo_url: '', capa_url: '', favicon_url: '' });
  const [carregado, setCarregado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const estadoInicialRef = useRef<string>('');

  const carregar = useCallback(() => {
    api<{ loja: any }>('GET', '/api/lojista/loja').then(r => {
      const novo = montarEstado(r.loja);
      setLojaId(r.loja.id);
      setEstado(novo);
      estadoInicialRef.current = JSON.stringify(novo);
      setCarregado(true);
    }).catch(() => setCarregado(true));
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const atualizar = useCallback((caminho: string, valor: any) => {
    setEstado(e => comCaminho(e, caminho, valor));
  }, []);

  /**
   * Aplica um preset de tema — merge raso no topo, mas PROFUNDO nos
   * sub-objetos de 2º nível (cores/logo/capa/cardapio/botoes/tipografia/
   * banners/avancado), pra um preset que só define 2 campos de `cores` não
   * apagar os outros 5.
   */
  const aplicarParcial = useCallback((parcial: Partial<EstadoVisual>) => {
    setEstado(e => {
      const novo: any = { ...e };
      for (const chave of Object.keys(parcial)) {
        const valor = (parcial as any)[chave];
        novo[chave] = (valor && typeof valor === 'object' && !Array.isArray(valor))
          ? { ...(e as any)[chave], ...valor }
          : valor;
      }
      return novo;
    });
  }, []);

  const dirty = carregado && JSON.stringify(estado) !== estadoInicialRef.current;

  async function salvar() {
    setSalvando(true);
    try {
      const { nome, cor_marca, cor_secundaria, logo_url, capa_url, favicon_url, ...visual } = estado;
      const r = await api<{ loja: any }>('PUT', '/api/lojista/loja', {
        nome, cor_marca, cor_secundaria, logo_url, capa_url, favicon_url,
        visual_json: JSON.stringify(visual),
      });
      const novo = montarEstado(r.loja);
      setEstado(novo);
      estadoInicialRef.current = JSON.stringify(novo);
      mostrar({ tipo: 'sucesso', titulo: 'Visual salvo!' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setSalvando(false);
    }
  }

  function restaurarPadraoAba(aba: keyof typeof DEFAULT_VISUAL) {
    setEstado(e => ({ ...e, [aba]: DEFAULT_VISUAL[aba] }));
  }

  return { lojaId, estado, atualizar, aplicarParcial, carregado, dirty, salvando, salvar, restaurarPadraoAba, lerCaminho };
}
