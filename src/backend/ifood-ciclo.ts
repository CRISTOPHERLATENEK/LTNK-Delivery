/**
 * UM CICLO DE POLLING DO IFOOD.
 *
 * Roda a cada 30 segundos e é o ÚNICO caminho de entrada desses pedidos —
 * diferente das reconciliações de Pix e cartão, que são redes de segurança onde
 * o próximo ciclo conserta o anterior. Aqui não existe segundo caminho: falhar
 * em silêncio é pedido não recebido, com o cliente esperando.
 *
 * As dependências entram por parâmetro (banco, rede, relógio) porque o que
 * precisa ser provado aqui é a ORDEM das operações, e ela é o que separa
 * "funciona" de "perde pedido":
 *
 *     buscar → deduplicar → GRAVAR → confirmar (ACK)
 *
 * Inverter as duas últimas é o defeito clássico: confirmar antes de gravar
 * significa que uma queda entre as duas apaga o pedido para sempre, e o iFood
 * nunca mais o entrega — a retenção deles é de 8 horas e o evento já foi dado
 * como recebido.
 */
import {
  ordenarEventos, separarNovos, lotesDeAck, lotesDeMerchants,
  type EventoIfood,
} from './ifood-protocolo';

/** Uma loja nossa que está ligada ao iFood, com o tenant a que pertence. */
export interface LojaIfood {
  /** Banco do tenant — SILO, um por cliente da plataforma. */
  tenantDb: string;
  lojaId: number;
  merchantId: string;
}

export interface DepsCiclo {
  /** Todas as lojas ligadas, de todos os tenants. */
  buscarLojas: () => Promise<LojaIfood[]>;
  /** Dos ids dados, quais já foram processados neste tenant. */
  jaVistos: (tenantDb: string, ids: string[]) => Promise<Set<string>>;
  /** Grava os eventos como vistos. Precisa ser durável ANTES do ACK. */
  marcarVistos: (tenantDb: string, eventos: EventoIfood[]) => Promise<void>;
  /** `GET /events:polling` para um lote de até 100 merchants. */
  polling: (merchantIds: string[]) => Promise<EventoIfood[]>;
  /** `POST /events/acknowledgment` para um lote de até 2000 ids. */
  confirmar: (ids: string[]) => Promise<void>;
  /**
   * O que fazer com um evento novo. A etapa 3 preenche isto (criar o pedido,
   * mudar status). Aqui ele só precisa existir e não estourar.
   */
  aoProcessar?: (loja: LojaIfood, evento: EventoIfood) => Promise<void>;
  /** Para o log. */
  registrar?: (nivel: 'info' | 'erro', mensagem: string) => void;
}

export interface ResumoCiclo {
  lojas: number;
  eventosRecebidos: number;
  eventosNovos: number;
  confirmados: number;
  /** Eventos que NÃO foram confirmados porque a gravação falhou. */
  retidos: number;
  falhas: string[];
}

export async function cicloIfood(deps: DepsCiclo): Promise<ResumoCiclo> {
  const log = deps.registrar ?? (() => {});
  const resumo: ResumoCiclo = {
    lojas: 0, eventosRecebidos: 0, eventosNovos: 0, confirmados: 0, retidos: 0, falhas: [],
  };

  const lojas = await deps.buscarLojas();
  resumo.lojas = lojas.length;
  if (lojas.length === 0) return resumo;

  /*
   * Um merchant → uma loja nossa. Se dois tenants cadastrarem o MESMO
   * merchantId, o pedido iria parar em duas lojas — cada uma achando que é
   * dela, e a cozinha errada produzindo. Vence o primeiro e o segundo vira
   * falha registrada: silenciar seria escolher uma loja no sorteio.
   */
  const porMerchant = new Map<string, LojaIfood>();
  for (const l of lojas) {
    const m = l.merchantId.trim();
    if (!m) continue;
    const existente = porMerchant.get(m);
    if (existente) {
      resumo.falhas.push(
        `merchant ${m} está em duas lojas (${existente.tenantDb}#${existente.lojaId} e ${l.tenantDb}#${l.lojaId}) — ignorando a segunda`,
      );
      continue;
    }
    porMerchant.set(m, l);
  }

  /* ── 1. buscar, em lotes e EM SÉRIE ──
     A doc manda agrupar sequencialmente dentro do ciclo de 30s; disparar todos
     os lotes juntos é como se encosta no limite de 6000 RPM e leva bloqueio. */
  const recebidos: EventoIfood[] = [];
  for (const lote of lotesDeMerchants([...porMerchant.keys()])) {
    try {
      recebidos.push(...await deps.polling(lote));
    } catch (e) {
      /* Um lote que falha NÃO derruba os outros: cada lote é um conjunto de
         lojas diferente, e deixar todas offline por causa de uma é o oposto do
         que queremos. */
      resumo.falhas.push(`polling falhou em ${lote.length} loja(s): ${(e as Error).message}`);
    }
  }
  resumo.eventosRecebidos = recebidos.length;
  if (recebidos.length === 0) return resumo;

  /* ── 2. ordenar antes de qualquer decisão ──
     A doc avisa que vêm fora de ordem. CANCELLED antes de PLACED faria o pedido
     nascer cancelado. */
  const ordenados = ordenarEventos(recebidos);

  /* Agrupa por tenant: a deduplicação consulta a tabela de UM banco, e é o
     tenant que diz qual. */
  const porTenant = new Map<string, Array<{ evento: EventoIfood; loja: LojaIfood }>>();
  const semDono: EventoIfood[] = [];
  for (const evento of ordenados) {
    const loja = porMerchant.get(String(evento.merchantId ?? '').trim());
    if (!loja) { semDono.push(evento); continue; }
    const lista = porTenant.get(loja.tenantDb) ?? [];
    lista.push({ evento, loja });
    porTenant.set(loja.tenantDb, lista);
  }

  /*
   * EVENTO DE LOJA QUE NÃO É NOSSA: confirmamos assim mesmo, e gritamos no log.
   *
   * Não deveria acontecer — pedimos merchants específicos. Mas se acontecer e a
   * gente não confirmar, ele volta a cada ciclo para sempre, acumulando strike
   * até bloquear o polling de TODAS as lojas. Confirmar sem processar perde só
   * esse evento; não confirmar derruba o resto.
   */
  if (semDono.length) {
    log('erro', `[ifood] ${semDono.length} evento(s) de merchant desconhecido — confirmando sem processar`);
  }
  const idsParaAck: string[] = semDono.map(e => String(e.id ?? '')).filter(Boolean);

  /* ── 3. por tenant: deduplicar, GRAVAR, e só então liberar para ACK ── */
  for (const [tenantDb, itens] of porTenant) {
    const eventos = itens.map(i => i.evento);
    try {
      const vistos = await deps.jaVistos(tenantDb, eventos.map(e => String(e.id ?? '')).filter(Boolean));
      const { novos, idsParaAck: idsDoTenant } = separarNovos(eventos, vistos);

      if (novos.length) {
        /* GRAVA PRIMEIRO. Só depois disto os ids entram na lista de ACK. */
        await deps.marcarVistos(tenantDb, novos);
        resumo.eventosNovos += novos.length;

        if (deps.aoProcessar) {
          for (const evento of novos) {
            const loja = itens.find(i => i.evento.id === evento.id)!.loja;
            try {
              await deps.aoProcessar(loja, evento);
            } catch (e) {
              /*
               * Falhar ao PROCESSAR não desfaz o "visto" e não impede o ACK.
               * O evento já está gravado — reprocessar seria criar o pedido
               * duas vezes. O que fica é o registro do erro, para alguém olhar.
               */
              resumo.falhas.push(`processar evento ${evento.id}: ${(e as Error).message}`);
            }
          }
        }
      }

      idsParaAck.push(...idsDoTenant);
    } catch (e) {
      /*
       * A GRAVAÇÃO FALHOU — então NÃO confirmamos estes eventos.
       *
       * Isso contraria a recomendação do iFood de confirmar tudo, e é
       * deliberado: não confirmar custa strike (e no limite, 5 minutos de
       * bloqueio); confirmar sem ter gravado custa o PEDIDO, que o iFood nunca
       * mais entrega. Entre perder tempo e perder venda, perde-se tempo.
       */
      resumo.retidos += eventos.length;
      resumo.falhas.push(`gravação falhou em ${tenantDb} — ${eventos.length} evento(s) retidos: ${(e as Error).message}`);
    }
  }

  /* ── 4. confirmar, em lotes de 2000 ── */
  for (const lote of lotesDeAck(idsParaAck)) {
    try {
      await deps.confirmar(lote);
      resumo.confirmados += lote.length;
    } catch (e) {
      /* ACK que falha não perde nada: o evento volta no próximo ciclo e a
         deduplicação impede o reprocessamento. Só gera strike. */
      resumo.falhas.push(`ACK de ${lote.length} evento(s) falhou: ${(e as Error).message}`);
    }
  }

  return resumo;
}
