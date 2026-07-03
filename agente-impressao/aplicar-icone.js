/**
 * Aplica o ícone no .exe empacotado pelo pkg, sem corromper o payload.
 *
 * PEGADINHA: rodar rcedit/resedit diretamente no .exe FINAL do pkg reescreve
 * a seção de recursos do PE inteira e corrompe/descarta dados que o pkg
 * embute ali (não é só o payload no fim do arquivo — o pkg também guarda
 * metadados do bootstrap na própria seção .rsrc). Sintoma: o app abre e
 * fecha na hora ("SyntaxError" ou "path argument must be of type string").
 *
 * Solução que funciona: aplicar o ícone no BINÁRIO BASE do Node (antes do
 * pkg anexar qualquer coisa) e fazer o pkg usar esse binário como fonte.
 * O pkg tem dois locais de cache: "fetched-*" (verificado por hash — se não
 * bater, ele RE-BAIXA e desfaz a modificação) e "built-*" (usado sem checar
 * hash, pensado para builds customizados do Node). Colocamos o binário com
 * ícone em "built-*" e removemos o "fetched-*" pra forçar o pkg a cair nele.
 *
 * Rodar ANTES de `npx pkg .` (o script `npm run dist` já faz isso).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const NODE_VERSION = 'v18.5.0';
const PLATAFORMA = 'win-x64';
const TAG = 'v3.4'; // major.minor do pkg-fetch — ver ~/.pkg-cache/<TAG>/
const ICO = path.resolve(__dirname, 'icone.ico');

const cacheDir = path.join(os.homedir(), '.pkg-cache', TAG);
const fetched = path.join(cacheDir, `fetched-${NODE_VERSION}-${PLATAFORMA}`);
const built = path.join(cacheDir, `built-${NODE_VERSION}-${PLATAFORMA}`);
const original = path.join(cacheDir, `fetched-${NODE_VERSION}-${PLATAFORMA}.original-backup`);

if (!fs.existsSync(ICO)) {
  console.log('icone.ico não encontrado — pulando (build sai com ícone padrão).');
  process.exit(0);
}

// Garante que temos uma cópia intocada do binário base pra trabalhar.
if (!fs.existsSync(original)) {
  const fonte = fs.existsSync(fetched) ? fetched : (fs.existsSync(built) ? built : null);
  if (!fonte) {
    console.log('Binário base do pkg ainda não foi baixado — rode `npx pkg .` uma vez primeiro, depois este script.');
    process.exit(0);
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.copyFileSync(fonte, original);
}

fs.copyFileSync(original, built);
require('rcedit').rcedit(built, { icon: ICO }).then(() => {
  if (fs.existsSync(fetched)) fs.unlinkSync(fetched); // força o pkg a usar o "built"
  console.log(`Ícone aplicado no binário base (${built}). Rode "npx pkg ." em seguida.`);
}, e => { console.error(e); process.exit(1); });
