/**
 * Aplica a config do editor (/editor) nos blocos do CUPOM FISCAL (DANFE) antes
 * de montar o ESC/POS. Só entra em jogo quando POST /imprimir vem com
 * ehFiscal:true — cupom de balcão/comanda não é afetado.
 */
'use strict';
const { lerConfig } = require('./config');

function aplicarConfigFiscal(blocos) {
  const c = lerConfig();
  let out = blocos.slice();

  if (c.mostrarQr === false) out = out.filter(b => b.t !== 'qr');
  if (c.mostrarEndereco === false) out = out.filter(b => b.t !== 'endereco');
  if (c.fonteGrande) {
    out = out.map(b => (b.t === 'center' || b.t === 'endereco') ? { ...b, t: 'titulo' } : b);
  }
  // Cabeçalho extra: entra logo antes do primeiro separador (fim dos dados do emitente).
  if (c.cabecalho && c.cabecalho.trim()) {
    const i = out.findIndex(b => b.t === 'linha');
    const bloco = { t: 'center', txt: c.cabecalho.trim() };
    out = i === -1 ? [bloco, ...out] : [...out.slice(0, i), bloco, ...out.slice(i)];
  }
  // Rodapé extra: entra logo antes do corte (fim do cupom).
  if (c.rodape && c.rodape.trim()) {
    const i = out.findIndex(b => b.t === 'corte');
    const extra = [{ t: 'pular', n: 1 }, { t: 'center', txt: c.rodape.trim() }];
    out = i === -1 ? [...out, ...extra] : [...out.slice(0, i), ...extra, ...out.slice(i)];
  }
  return out;
}

module.exports = { aplicarConfigFiscal };
