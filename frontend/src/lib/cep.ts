/**
 * Consulta de CEP via ViaCEP (https://viacep.com.br) — API pública, grátis,
 * sem chave. Usada pra autopreencher rua/bairro/cidade/UF no cadastro de
 * endereço, reduzindo erro de digitação e melhorando o roteamento da entrega.
 */

export interface EnderecoCep {
  rua: string;
  bairro: string;
  cidade: string;
  uf: string;
}

/** Só os dígitos do CEP (remove máscara). */
export function cepDigitos(cep: string): string {
  return (cep || '').replace(/\D/g, '').slice(0, 8);
}

/** Formata como 00000-000 enquanto digita. */
export function formatarCep(cep: string): string {
  const d = cepDigitos(cep);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/**
 * Busca o endereço pelo CEP. Retorna null se o CEP for inválido, não existir,
 * ou a consulta falhar (offline etc.) — o cliente sempre pode digitar à mão.
 */
export async function buscarCep(cep: string): Promise<EnderecoCep | null> {
  const d = cepDigitos(cep);
  if (d.length !== 8) return null;
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 6000);
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { signal: c.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    if (j.erro) return null;
    return {
      rua: j.logradouro || '',
      bairro: j.bairro || '',
      cidade: j.localidade || '',
      uf: j.uf || '',
    };
  } catch {
    return null;
  }
}
