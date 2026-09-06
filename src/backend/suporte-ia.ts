/**
 * O AGENTE DE SUPORTE — responde a dúvida com o ESTADO REAL da loja em mãos.
 *
 * A diferença entre isto e um chatbot de documentação está no dossiê: sem ele a
 * resposta é "verifique se a emissão está ativa na aba Fiscal"; com ele é "a sua
 * loja está com o Maxx Gestão como emissor e a auto-emissão desligada — o
 * pedido sobe como documento e alguém precisa faturar lá".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ELE LÊ E EXPLICA. NUNCA AGE.
 *
 * Sem tools, sem escrita, sem nada que mexa em pedido, nota ou configuração.
 * Não é limitação técnica: é o desenho. Um agente que pode agir transforma
 * "cancela tudo" digitado por alguém irritado num incidente — e a culpa seria
 * de quem desenhou, não de quem digitou.
 * ─────────────────────────────────────────────────────────────────────────
 */
import Anthropic from '@anthropic-ai/sdk';
import { montarDossie, dossieEmTexto } from './suporte-dossie';

/**
 * O modelo. `claude-opus-5` é o padrão; trocar é decisão de custo, e por isso
 * fica no `.env` em vez de escondido no código.
 */
const MODELO = process.env.SUPORTE_MODELO || 'claude-opus-5';

/**
 * Teto por resposta. Uma explicação de suporte cabe folgada em 4000 — o
 * suficiente para não cortar no meio de um passo a passo, e longe do valor que
 * transformaria uma pergunta numa dissertação.
 */
const MAX_TOKENS = 4000;

/*
 * O QUE ELE É, e o que ele não pode fazer.
 *
 * Fica FORA do texto variável de propósito: o prompt é idêntico em toda
 * chamada, então entra no cache da API. O dossiê e a pergunta, que mudam a cada
 * vez, vêm depois — é o que faz o cache valer alguma coisa.
 */
const INSTRUCOES = `Você atende o suporte de uma plataforma de delivery multi-loja (SaaS).
Quem fala com você é a equipe de suporte da plataforma, não o lojista.

Você recebe:
1. O ESTADO REAL da loja, lido do banco de dados agora.
2. A dúvida ou o problema relatado.

Como responder:
- Comece pela resposta. Nada de "boa pergunta" ou repetir o que foi perguntado.
- Use o estado da loja. Se ele explica o problema, diga isso e cite o dado.
- Quando o estado NÃO explica, diga o que falta olhar em vez de inventar causa.
- Seja concreto: nomes de tela, nomes de campo, o que clicar.
- Português do Brasil, direto, sem jargão desnecessário.
- Se o problema for de dinheiro, nota fiscal ou perda de dado, diga a consequência antes do passo a passo.

O que você NUNCA faz:
- Não afirme que executou nada. Você só lê e explica; quem age é a pessoa.
- Não invente campo, tela ou comportamento que não esteja no estado ou na sua instrução.
- Não peça nem repita senha, token ou chave de API. Se a resposta depende de credencial, diga onde ela é configurada, nunca o valor.

Conhecimento da plataforma que costuma resolver chamado:
- Quem emite a NFC-e é escolhido por loja: este sistema, a maquininha, ou o ERP (Maxx Gestão). A emissão própria do sistema está INCOMPLETA e não deve ser usada — o esperado é o ERP.
- Com o ERP como emissor e a emissão automática desligada, o pedido sobe como documento e alguém fatura no ERP. Nenhuma nota sai sozinha.
- NFC-e de entrega exige CPF do destinatário; sem ele a SEFAZ recusa.
- Venda por site/plataforma de terceiros exige os dados do intermediador (grupo infIntermed) — é a recusa mais comum aqui.
- Os módulos (fiscal e vendas) são liberados pela plataforma, por loja. Bloqueado, o lojista não vê a aba e as rotas recusam.
- O canal de liberação (Recomendado, Beta, Teste) decide só quais NOVIDADES a loja vê. Correção de segurança nunca passa por canal.
- "Loja aberta" segue o horário cadastrado pelo lojista quando o horário automático está ligado; o admin não força isso.`;

export interface RespostaSuporte {
  resposta: string;
  dossie: string;
  modelo: string;
  /** Para a tela poder mostrar o custo real da conversa. */
  tokens: { entrada: number; saida: number; cache_lido: number };
}

export class SemChaveSuporte extends Error {}

let cliente: Anthropic | null = null;
function obterCliente(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    /*
     * Erro claro em vez de falha genérica: sem isto, a primeira pessoa a clicar
     * receberia um 500 sem pista e abriria um chamado sobre o chamado.
     */
    throw new SemChaveSuporte(
      'A IA de suporte não está configurada: falta ANTHROPIC_API_KEY no .env do servidor.');
  }
  if (!cliente) cliente = new Anthropic();
  return cliente;
}

export async function responderSuporte(lojaId: number, pergunta: string): Promise<RespostaSuporte> {
  const d = await montarDossie(lojaId);
  if (!d) throw new Error('Loja não encontrada.');
  const dossie = dossieEmTexto(d);

  const cliente = obterCliente();
  const r = await cliente.messages.create({
    model: MODELO,
    max_tokens: MAX_TOKENS,
    /* Pensa o quanto precisar: diagnóstico com dez fatos cruzados não é
       classificação. `medium` porque a maioria das perguntas é rotina, e o
       estado já vem mastigado no dossiê. */
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: [
      {
        type: 'text',
        text: INSTRUCOES,
        /* As instruções são idênticas em toda chamada — cacheadas, custam ~10%
           a partir da segunda pergunta. É o único trecho estável aqui. */
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      { role: 'user', content: `${dossie}\n\n---\n\nDÚVIDA OU PROBLEMA RELATADO:\n${pergunta}` },
    ],
  });

  /*
   * `content` é uma união: bloco de pensamento e bloco de texto. Pegar
   * `content[0].text` cegamente devolveria vazio quando o primeiro bloco for o
   * raciocínio.
   */
  const resposta = r.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  return {
    resposta: resposta || 'O modelo não devolveu texto. Tente reformular a pergunta.',
    dossie,
    modelo: r.model,
    tokens: {
      entrada: r.usage.input_tokens,
      saida: r.usage.output_tokens,
      cache_lido: r.usage.cache_read_input_tokens ?? 0,
    },
  };
}
