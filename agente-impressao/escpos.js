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
};
function texto(s) {
  const out = [];
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0);
    if (c < 128) out.push(c);
    else if (CP850[ch] != null) out.push(CP850[ch]);
    else out.push(0x3f); // '?'
  }
  return Buffer.from(out);
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
        partes.push(texto((b.txt ?? '') + '\n'));
    }
  }
  partes.push(Buffer.from('\n\n\n'), cmd(GS, 0x56, 0x01)); // garante corte final
  return Buffer.concat(partes);
}

module.exports = { montarEscpos };
