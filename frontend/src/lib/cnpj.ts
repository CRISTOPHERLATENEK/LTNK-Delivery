/**
 * Consulta de CNPJ via BrasilAPI (https://brasilapi.com.br) — pública, grátis,
 * sem chave. Autopreenche os dados do emitente na configuração fiscal (razão
 * social, nome fantasia, endereço e código IBGE do município).
 */

export interface DadosCnpj {
  razao_social: string;
  nome_fantasia: string;
  uf: string;
  municipio: string;
  cmun: string;       // código IBGE do município (7 dígitos)
  logradouro: string;
  numero: string;
  bairro: string;
  cep: string;        // só dígitos
}

/** Só os 14 dígitos do CNPJ (remove máscara). */
export function cnpjDigitos(cnpj: string): string {
  return (cnpj || '').replace(/\D/g, '').slice(0, 14);
}

/** Formata como 00.000.000/0000-00 enquanto digita. */
export function formatarCnpj(cnpj: string): string {
  return cnpjDigitos(cnpj)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/**
 * Busca os dados do emitente pelo CNPJ. Retorna null se o CNPJ for inválido,
 * não existir, ou a consulta falhar — o lojista sempre pode digitar à mão.
 */
export async function buscarCnpj(cnpj: string): Promise<DadosCnpj | null> {
  const d = cnpjDigitos(cnpj);
  if (d.length !== 14) return null;
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 8000);
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, { signal: c.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const numero = j.numero ? String(j.numero) : '';
    // O campo logradouro às vezes vem com o número no fim ("PAULISTA 37");
    // junta o tipo (AVENIDA/RUA) e remove o número duplicado no fim.
    const logradouro = [j.descricao_tipo_de_logradouro, j.logradouro]
      .filter(Boolean).join(' ').trim()
      .replace(new RegExp('\\s+' + numero + '$'), '').trim();
    return {
      razao_social: j.razao_social || '',
      nome_fantasia: j.nome_fantasia || '',
      uf: j.uf || '',
      municipio: j.municipio || '',
      cmun: j.codigo_municipio_ibge ? String(j.codigo_municipio_ibge) : '',
      logradouro,
      numero,
      bairro: j.bairro || '',
      cep: String(j.cep || '').replace(/\D/g, ''),
    };
  } catch {
    return null;
  }
}
