/**
 * O CLIENTE DO PEDIDO COMO PESSOA NO MAXX GESTÃO.
 *
 * Sem isto, todo pedido subia com `idPessoa: 5` — o "consumidor final" padrão
 * da empresa. O documento chegava lá sem dizer QUEM comprou, e a NFC-e de
 * entrega era rejeitada pela SEFAZ: *"NFC-e de entrega a domicilio sem a
 * identificacao do destinatario"*.
 *
 * ACHA ANTES DE CRIAR, pelo CPF (`GET /api/pessoa/cnpjcpf/v1`). Criar sem
 * procurar encheria o cadastro do lojista de duplicatas do mesmo cliente — uma
 * por pedido — e ele descobriria isso pelo cadastro inchado, não por um erro.
 *
 * FALHA AQUI NÃO IMPEDE O PEDIDO DE SUBIR. Quem chama cai no consumidor final
 * padrão: documento sem o cliente ainda é o pedido registrado, e a alternativa
 * (não enviar) perde a venda no ERP por causa de um cadastro.
 */
import { chamarMaxxGestao, type OpcoesMaxxGestao } from './maxxgestao-cliente';

export interface EnderecoCliente {
  rua: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}

export interface ClienteParaErp {
  nome: string;
  /** Só dígitos, ou vazio. */
  cpf: string;
  telefone: string;
  email: string;
  endereco?: EnderecoCliente;
}

/** Sem acento, sem caixa, sem espaço em volta — para comparar nome de cidade. */
export function chaveDeTexto(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
}

/** Só os dígitos. CPF chega da tela com pontos e traço. */
export function soDigitos(t: string): string {
  return (t || '').replace(/\D/g, '');
}

/**
 * O código IBGE do município do cliente.
 *
 * ATALHO PELA CIDADE DA EMPRESA, e ele resolve quase todo caso real: delivery
 * entrega na própria cidade. `GET /api/municipio/v1` IGNORA filtro — devolve os
 * 5.567 municípios em ordem alfabética, 100 por página, o que custaria 56
 * requisições contra um limite de 20 por minuto só para descobrir um número.
 *
 * Cidade diferente devolve zero, e quem chama manda a pessoa SEM endereço em
 * vez de mandar endereço com município errado: endereço fiscal errado é pior
 * que endereço ausente, porque parece certo.
 */
export function municipioDoCliente(
  cidadeDoCliente: string,
  ufDoCliente: string,
  empresa: { municipio: string; uf: string; idIbgeMunicipio: number },
): number {
  if (!cidadeDoCliente || !ufDoCliente) return 0;
  const mesmaCidade = chaveDeTexto(cidadeDoCliente) === chaveDeTexto(empresa.municipio);
  const mesmoEstado = chaveDeTexto(ufDoCliente) === chaveDeTexto(empresa.uf);
  return mesmaCidade && mesmoEstado ? Number(empresa.idIbgeMunicipio) || 0 : 0;
}

/** Acha a pessoa pelo CPF. Zero quando não existe (ou não há CPF). */
export async function acharPessoaPorCpf(
  token: string,
  cpf: string,
  opcoes: OpcoesMaxxGestao = {},
): Promise<number> {
  const digitos = soDigitos(cpf);
  if (digitos.length !== 11) return 0;
  try {
    const d = await chamarMaxxGestao(
      token, `/api/pessoa/cnpjcpf/v1?cnpjCpf=${encodeURIComponent(digitos)}`, opcoes,
    ) as Record<string, unknown> | null;
    return idDaPessoa(d);
  } catch {
    /*
     * "Pessoa não encontrada" chega como erro nesta API, e não é falha: é a
     * resposta. Deixar a exceção subir faria o pedido não ser enviado por causa
     * de um cliente novo — que é o caso normal na primeira compra.
     */
    return 0;
  }
}

/** O id da pessoa numa resposta deles, seja qual for o nome do campo. */
export function idDaPessoa(resposta: unknown): number {
  const d = (resposta && typeof resposta === 'object' ? resposta : {}) as Record<string, unknown>;
  for (const chave of ['codigo', 'idPessoa', 'id']) {
    const n = Number(d[chave] ?? 0);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const dentro = (d.pessoa && typeof d.pessoa === 'object' ? d.pessoa : {}) as Record<string, unknown>;
  for (const chave of ['codigo', 'idPessoa', 'id']) {
    const n = Number(dentro[chave] ?? 0);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/**
 * O corpo do cadastro de pessoa física.
 *
 * `tipo: 'F'` — pessoa física. O endereço vai em `enderecoPrincipal` e SÓ
 * quando o município foi resolvido: ver `municipioDoCliente`.
 */
export function corpoDaPessoa(cliente: ClienteParaErp, idIbgeMunicipio: number): Record<string, unknown> {
  const cpf = soDigitos(cliente.cpf);
  const corpo: Record<string, unknown> = {
    razaoSocial: cliente.nome.trim() || 'CONSUMIDOR',
    fantasia: cliente.nome.trim() || 'CONSUMIDOR',
    tipo: 'F',
    ativo: 'S',
    /* CPF vazio é melhor que CPF inventado: sem ele a pessoa existe e serve de
       histórico; com um errado, a nota sai no nome de outra pessoa. */
    ...(cpf.length === 11 ? { cnpjCpf: cpf } : {}),
    /* Marca de origem, para quem olhar o cadastro no ERP saber de onde veio. */
    observacao: 'Cliente do delivery',
    contato: {
      ...(cliente.telefone ? { fone: soDigitos(cliente.telefone) } : {}),
      ...(cliente.email ? { email: cliente.email } : {}),
    },
  };

  const e = cliente.endereco;
  if (e && idIbgeMunicipio > 0) {
    corpo.enderecoPrincipal = {
      descricao: 'Entrega',
      logradouro: e.rua,
      numero: e.numero || 'S/N',
      complemento: e.complemento || '',
      bairro: e.bairro || '',
      idIbgeMunicipio,
      uf: chaveDeTexto(e.uf),
      /* CEP é inteiro no contrato deles, não texto com traço. */
      cep: Number(soDigitos(e.cep)) || 0,
      principal: 'S',
      ativo: 'S',
    };
  }
  return corpo;
}

export async function criarPessoa(
  token: string,
  corpo: Record<string, unknown>,
  opcoes: OpcoesMaxxGestao = {},
): Promise<number> {
  const resp = await chamarMaxxGestao(token, '/api/pessoa/v1', opcoes, {
    method: 'POST',
    body: JSON.stringify(corpo),
  });
  return idDaPessoa(resp);
}
