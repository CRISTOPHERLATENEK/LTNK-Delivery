/**
 * Gerador de ESC/POS a partir de "blocos" simples (formato do painel web).
 * Suporta: título/centralizado/negrito, linha esquerda-direita, separador,
 * QR Code (GS ( k) e corte de papel. Saída = Buffer pronto pra impressora RAW.
 */
'use strict';

const ESC = 0x1b, GS = 0x1d;
const cmd = (...b) => Buffer.from(b);

// Acentos → CP850 (padrão das térmicas Elgin/Bematech). Mapa dos comuns em PT-BR.
const CP850 = {
  'á':0xa0,'à':0x85,'â':0x83,'ã':0xc6,'ä':0x84,'é':0x82,'ê':0x88,'è':0x8a,'í':0xa1,'ì':0x8d,
  'ó':0xa2,'ô':0x93,'õ':0xe4,'ö':0x94,'ú':0xa3,'û':0x96,'ù':0x97,'ç':0x87,'ñ':0xa4,
  'Á':0xb5,'À':0xb7,'Â':0xb6,'Ã':0xc7,'É':0x90,'Ê':0xd2,'Í':0xd6,'Ó':0xe0,'Ô':0xe2,'Õ':0xe5,
  'Ú':0xe9,'Ç':0x80,'º':0xa7,'ª':0xa6,'°':0xf8,'§':0x15,
  /*
   * O PONTO SEPARADOR FALTAVA, e ele está em todo cupom.
   *
   * `·` é o separador que o sistema usa entre complementos e nos pedaços do
   * endereço. Sem estar no mapa, caía no `?` do final — e o cupom impresso
   * saía "Sabores: Mussarela ? Sabores: Frango" e "Rua Rio do Braço, 207 ?
   * casa ? Jardim Sofia". Em CP850 ele existe, no 0xFA.
   */
  '·':0xfa,
};

/*
 * Caracteres que NÃO existem em CP850 mas têm equivalente ASCII óbvio.
 *
 * Aspa curva e travessão entram por copiar-e-colar de Word/WhatsApp o tempo
 * todo, em nome de produto e em observação de cliente. Virar `?` é perder
 * informação por causa de tipografia; virar `"` ou `-` não perde nada.
 */
const TRANSLITERA = {
  '–':'-','—':'-','‒':'-','−':'-',
  '“':'"','”':'"','„':'"','‘':"'",'’':"'",'‚':"'",
  '…':'...','\u00a0':' ','\u200b':'',
};

function texto(s) {
  const out = [];
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0);
    if (c < 128) { out.push(c); continue; }
    if (CP850[ch] != null) { out.push(CP850[ch]); continue; }
    const alt = TRANSLITERA[ch];
    if (alt != null) { for (const a of alt) out.push(a.charCodeAt(0)); continue; }
    out.push(0x3f); // '?'
  }
  return Buffer.from(out);
}

/**
 * Quebra o texto na largura da bobina SEM PARTIR PALAVRA.
 *
 * A impressora quebra sozinha ao encher a linha, e quebra no caractere: o cupom
 * saiu com "Frango com Catup" numa linha e "iry" na outra. Numa comanda de
 * cozinha lida de relance, palavra partida é item lido errado.
 *
 * A continuação entra INDENTADA (dois espaços a mais que a original), pra
 * ficar visível que a segunda linha é continuação e não um item novo — que é
 * exatamente a confusão que se quer evitar numa lista de sabores.
 *
 * Palavra maior que a linha inteira (um nome colado sem espaço) ainda é
 * cortada: não há onde quebrar, e cortar é melhor que estourar a bobina.
 */
function quebrar(txt, cols) {
  const linhas = [];
  for (const original of String(txt).split('\n')) {
    if (original.length <= cols) { linhas.push(original); continue; }
    const recuo = ' '.repeat(Math.min((original.match(/^ */) || [''])[0].length + 2, 8));
    let atual = '';
    for (const palavra of original.split(' ')) {
      const candidata = atual ? `${atual} ${palavra}` : palavra;
      if (candidata.length <= cols) { atual = candidata; continue; }
      if (atual) linhas.push(atual);
      if (palavra.length > cols) {
        // Sem espaço onde quebrar: fatia na largura da bobina.
        let resto = palavra;
        while (resto.length > cols) { linhas.push(resto.slice(0, cols)); resto = resto.slice(cols); }
        atual = recuo + resto;
      } else {
        atual = recuo + palavra;
      }
    }
    if (atual) linhas.push(atual);
  }
  return linhas;
}

/** Larguras em colunas por bobina (fonte A). 80mm≈48, 58mm≈32. */
function colunas(larguraMm) { return larguraMm === 58 ? 32 : 48; }

function linhaLR(esq, dir, cols) {
  esq = String(esq); dir = String(dir);
  const espaco = cols - esq.length - dir.length;
  if (espaco < 1) return texto((esq + ' ' + dir).slice(0, cols) + '\n');
  return Buffer.concat([texto(esq), texto(' '.repeat(espaco)), texto(dir), Buffer.from([0x0a])]);
}

function qrCode(dados) {
  const d = Buffer.from(dados, 'utf8');
  const len = d.length + 3;
  return Buffer.concat([
    cmd(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00), // modelo 2
    cmd(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06),        // tamanho do módulo = 6
    cmd(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30),        // correção de erro = L
    cmd(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30), d, // armazena
    cmd(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30),        // imprime
  ]);
}

/**
 * Monta o Buffer ESC/POS a partir de { largura, blocos: [...] }.
 * Blocos: {t:'texto'|'center'|'titulo'|'lr'|'linha'|'qr'|'pular'|'corte', ...}
 */
function montarEscpos({ largura = 80, blocos = [] }) {
  const cols = colunas(largura);
  const partes = [cmd(ESC, 0x40), cmd(ESC, 0x74, 0x02)]; // init + code page CP850

  const alinhar = n => cmd(ESC, 0x61, n);       // 0=esq 1=centro 2=dir
  const negrito = on => cmd(ESC, 0x45, on ? 1 : 0);
  const tamanho = n => cmd(GS, 0x21, n);        // 0x00 normal, 0x11 dobro

  for (const b of blocos) {
    switch (b.t) {
      case 'titulo':
        partes.push(alinhar(1), negrito(1), tamanho(0x11), texto(b.txt + '\n'), tamanho(0x00), negrito(0), alinhar(0));
        break;
      case 'center':
      case 'endereco': // mesmo visual de 'center'; tipo próprio p/ o editor poder ocultar
        partes.push(alinhar(1), negrito(b.b ? 1 : 0), texto(b.txt + '\n'), negrito(0), alinhar(0));
        break;
      case 'lr':
        if (b.b) partes.push(negrito(1));
        partes.push(linhaLR(b.l, b.r, cols));
        if (b.b) partes.push(negrito(0));
        break;
      case 'linha':
        partes.push(texto('-'.repeat(cols) + '\n'));
        break;
      case 'qr':
        partes.push(alinhar(1), qrCode(b.data), Buffer.from([0x0a]), alinhar(0));
        break;
      case 'pular':
        partes.push(Buffer.from('\n'.repeat(b.n || 1)));
        break;
      case 'corte':
        partes.push(Buffer.from('\n\n\n'), cmd(GS, 0x56, 0x01)); // corte parcial
        break;
      case 'texto':
      default:
        for (const linha of quebrar(b.txt ?? '', cols)) partes.push(texto(linha + '\n'));
    }
  }
  partes.push(Buffer.from('\n\n\n'), cmd(GS, 0x56, 0x01)); // garante corte final
  return Buffer.concat(partes);
}

module.exports = { montarEscpos, quebrar, texto };
