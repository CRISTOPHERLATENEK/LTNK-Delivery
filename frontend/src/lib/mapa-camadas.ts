/**
 * DE ONDE VEM O FUNDO DO MAPA — um lugar só, para os três mapas do sistema.
 *
 * POR QUE ISTO EXISTE AGORA. Em 13/09/2026 o lojista abriu as áreas de entrega
 * e o mapa estava assim:
 *
 *   Padrão (OpenStreetMap) → ladrilho preto e amarelo, "Access blocked: app is
 *                            not following the tile usage policy of
 *                            OpenStreetMap's volunteer-run servers"
 *   Claro  (CARTO)         → "API KEY REQUIRED · carto.com/basemaps/apikey"
 *
 * As duas fontes gratuitas de antes deixaram de servir para um produto: a do
 * OpenStreetMap é mantida por voluntários e a política dela barra aplicação que
 * consome em volume; a da CARTO passou a exigir chave. Não foi "a API caiu" —
 * foi a regra de uso mudando debaixo do app, que é o jeito normal de um serviço
 * de graça acabar.
 *
 * O MESMO ENDEREÇO BLOQUEADO ESTAVA EM TRÊS TELAS: áreas de entrega,
 * rastreamento do pedido (que o CLIENTE abre) e a rota do entregador. O lojista
 * só viu numa; as outras duas estavam quebradas do mesmo jeito. Daí este
 * arquivo: da próxima vez que um provedor mudar de ideia, muda-se aqui.
 *
 * A ESCOLHA: os mapas da Esri (ArcGIS Online), que é de onde o Satélite já vinha
 * — o único dos três que continuou funcionando na tela dele. Sem chave, sem
 * cadastro, com atribuição obrigatória (que é licença, não enfeite). Medido em
 * 13/09/2026, com o cabeçalho que o navegador manda: 28 KB no zoom 17, 19 KB no
 * 18 e 13 KB no 19 — ou seja, tem dado no zoom em que se desenha rua.
 *
 * O "CLARO" NÃO É OUTRO PROVEDOR, É O MESMO MAPA DESSATURADO. O candidato
 * natural (o Light Gray Canvas da Esri) devolve 2.521 bytes em qualquer zoom
 * acima de 16 — é o cinza de "não tenho dado aqui", inútil para desenhar área.
 * Tirar a cor por CSS dá o mesmo efeito que o Claro tinha: o polígono laranja
 * salta, e sem depender de mais ninguém.
 */

export interface CamadaMapa {
  rotulo: string;
  url: string;
  atribuicao: string;
  maxZoom: number;
  /** Classe CSS aplicada aos ladrilhos (ver `.mapa-dessaturado` no index.css). */
  className?: string;
}

/**
 * A atribuição que a licença da Esri exige. Ela aparece no canto do mapa; tirar
 * economiza dez pixels e quebra o acordo de uso.
 */
const ESRI = 'Tiles &copy; Esri';

export const CAMADAS: Record<'padrao' | 'claro' | 'satelite', CamadaMapa> = {
  padrao: {
    rotulo: 'Padrão',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    atribuicao: `${ESRI}, HERE, Garmin, &copy; OpenStreetMap`,
    maxZoom: 19,
  },
  claro: {
    rotulo: 'Claro',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    atribuicao: `${ESRI}, HERE, Garmin, &copy; OpenStreetMap`,
    maxZoom: 19,
    className: 'mapa-dessaturado',
  },
  satelite: {
    rotulo: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    atribuicao: `Imagens ${ESRI}`,
    maxZoom: 19,
  },
};

/** O fundo dos mapas que não têm seletor (rastreamento e rota do entregador). */
export const CAMADA_PADRAO = CAMADAS.padrao;
