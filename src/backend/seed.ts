/**
 * Seed — dados de demonstração. Rode com: npm run seed (não duplica nada).
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db from './db';
import { agoraUTC } from './util';
import { Perfil, TipoGrupoOpcao } from '../tipos/modelos';

const agora = agoraUTC();

function criarUsuario(nome: string, email: string, senha: string, perfil: Perfil, telefone: string): number {
  const existente = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email) as { id: number } | undefined;
  if (existente) return existente.id;
  const info = db.prepare(
    `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, criado_em)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(nome, email, bcrypt.hashSync(senha, 10), perfil, telefone, agora);
  return Number(info.lastInsertRowid);
}

function criarContaCozinha(lojaId: number, nome: string, email: string, senha: string): void {
  const existente = db.prepare('SELECT id FROM cozinha_contas WHERE email = ?').get(email);
  if (existente) return;
  db.prepare(
    'INSERT INTO cozinha_contas (loja_id, nome, email, senha_hash, criado_em) VALUES (?, ?, ?, ?, ?)'
  ).run(lojaId, nome, email, bcrypt.hashSync(senha, 10), agora);
}

interface DadosLoja {
  nome: string; descricao: string; categoria: string; endereco: string;
  taxa: number; tempo: number; horario: string;
}

function criarLoja(usuarioId: number, dados: DadosLoja): number {
  const existente = db.prepare('SELECT id FROM lojas WHERE usuario_id = ?').get(usuarioId) as { id: number } | undefined;
  if (existente) return existente.id;
  const info = db.prepare(
    `INSERT INTO lojas (usuario_id, nome, descricao, categoria, endereco,
                        taxa_entrega_centavos, tempo_estimado_min, horario_funcionamento,
                        status_aprovacao, aberta, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aprovada', 1, ?)`
  ).run(usuarioId, dados.nome, dados.descricao, dados.categoria, dados.endereco,
        dados.taxa, dados.tempo, dados.horario, agora);
  return Number(info.lastInsertRowid);
}

interface GrupoSeed {
  nome: string; tipo: TipoGrupoOpcao; obrigatorio?: boolean; max?: number;
  opcoes: [string, number][];
}
interface ProdutoSeed {
  nome: string; descricao?: string; categoria: string; preco: number;
  promo?: number; serve?: number; destaque?: boolean; grupos?: GrupoSeed[];
}

function criarProduto(lojaId: number, p: ProdutoSeed): void {
  let produto = db.prepare('SELECT id FROM produtos WHERE loja_id = ? AND nome = ?')
    .get(lojaId, p.nome) as { id: number } | undefined;
  if (!produto) {
    const info = db.prepare(
      `INSERT INTO produtos (loja_id, nome, descricao, categoria, preco_centavos,
                             preco_promocional_centavos, serve_pessoas, destaque,
                             foto_url, disponivel, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 1, ?)`
    ).run(lojaId, p.nome, p.descricao || '', p.categoria, p.preco,
          p.promo || null, p.serve || null, p.destaque ? 1 : 0, agora);
    produto = { id: Number(info.lastInsertRowid) };
  }

  if (!p.grupos) return;
  const jaTemGrupos = db.prepare('SELECT id FROM grupos_opcoes WHERE produto_id = ?').get(produto.id);
  if (jaTemGrupos) return;

  for (const [ordemG, g] of p.grupos.entries()) {
    const infoGrupo = db.prepare(
      `INSERT INTO grupos_opcoes (produto_id, nome, tipo, obrigatorio, max_escolhas, ordem)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(produto.id, g.nome, g.tipo, g.obrigatorio ? 1 : 0, g.max || 0, ordemG);
    for (const [ordemO, [nomeOpcao, precoAdicional]] of g.opcoes.entries()) {
      db.prepare(
        `INSERT INTO opcoes_itens (grupo_id, nome, preco_adicional_centavos, disponivel, ordem)
         VALUES (?, ?, ?, 1, ?)`
      ).run(Number(infoGrupo.lastInsertRowid), nomeOpcao, precoAdicional, ordemO);
    }
  }
}

// ----- Contas de teste -----------------------------------------------------
const adminId = criarUsuario('Administrador', 'admin@demo.com', 'admin123', 'admin', '11999990000');
// admin@demo.com é o SUPER ADMIN da plataforma de demonstração
db.prepare("UPDATE usuarios SET super_admin = 1 WHERE id = ?").run(adminId);
// Admin operacional de exemplo (NÃO super)
criarUsuario('Ana Operadora', 'admin2@demo.com', 'admin123', 'admin', '11999991111');
const clienteId = criarUsuario('Carlos Cliente', 'cliente@demo.com', 'cliente123', 'cliente', '11988887777');
const lojista1Id = criarUsuario('Paula Pizzaiola', 'lojista@demo.com', 'lojista123', 'lojista', '11977776666');
const lojista2Id = criarUsuario('Bruno Burguer', 'lojista2@demo.com', 'lojista123', 'lojista', '11966665555');
criarUsuario('Edu Entregador', 'entregador@demo.com', 'entrega123', 'entregador', '11955554444');

// ----- Pizzaria ------------------------------------------------------------
const pizzariaId = criarLoja(lojista1Id, {
  nome: 'Pizzaria da Paula',
  descricao: 'Pizzas artesanais no forno a lenha, massa de fermentação natural.',
  categoria: 'Pizzaria',
  endereco: 'Rua das Margaridas, 100 - Centro - São Paulo/SP',
  taxa: 800, tempo: 50, horario: 'Ter a Dom, 18h às 23h30',
});

// Conta de cozinha (KDS) da pizzaria — login independente da loja.
criarContaCozinha(pizzariaId, 'Cozinha', 'cozinha@demo.com', 'cozinha123');

const TAMANHOS_PIZZA: GrupoSeed = {
  nome: 'Escolha o tamanho', tipo: 'unico', obrigatorio: true,
  opcoes: [
    ['Broto 20cm — 4 fatias (1 pessoa)', 0],
    ['Média 30cm — 6 fatias (2 pessoas)', 1500],
    ['Big 35cm — 8 fatias (3-4 pessoas)', 2500],
  ],
};
const BORDA_SALGADA: GrupoSeed = {
  nome: 'Borda recheada', tipo: 'unico',
  opcoes: [
    ['Borda de catupiry', 800],
    ['Borda de cheddar', 800],
    ['Borda de requeijão com bacon', 1000],
  ],
};
const ADICIONAIS_PIZZA: GrupoSeed = {
  nome: 'Adicionais', tipo: 'multiplo', max: 5,
  opcoes: [
    ['Extra muçarela', 600], ['Bacon crocante', 700], ['Catupiry extra', 600],
    ['Cebola caramelizada', 500], ['Azeitona preta', 400], ['Manjericão fresco', 300],
  ],
};

const pizzasSalgadas: ProdutoSeed[] = [
  { nome: 'Pizza Margherita', categoria: 'Pizzas Tradicionais', preco: 3990, serve: 2, destaque: true,
    descricao: 'Molho de tomate italiano, muçarela, manjericão fresco e azeite extravirgem.' },
  { nome: 'Pizza Calabresa', categoria: 'Pizzas Tradicionais', preco: 3790, serve: 2,
    descricao: 'Calabresa artesanal fatiada, cebola roxa e orégano.' },
  { nome: 'Pizza Portuguesa', categoria: 'Pizzas Tradicionais', preco: 4290, serve: 2,
    descricao: 'Presunto, ovos, cebola, ervilha, azeitona e muçarela.' },
  { nome: 'Pizza Frango com Catupiry', categoria: 'Pizzas Tradicionais', preco: 4190, serve: 2,
    descricao: 'Frango desfiado temperado coberto com catupiry original.' },
  { nome: 'Pizza Pepperoni Prime', categoria: 'Pizzas Premium', preco: 5490, promo: 4790, serve: 2, destaque: true,
    descricao: 'Dupla camada de pepperoni importado, muçarela especial e toque de mel picante.' },
  { nome: 'Pizza Quatro Queijos Especial', categoria: 'Pizzas Premium', preco: 5290, serve: 2,
    descricao: 'Muçarela de búfala, gorgonzola, parmesão envelhecido e catupiry.' },
  { nome: 'Pizza Camarão com Cream Cheese', categoria: 'Pizzas Premium', preco: 6490, serve: 3,
    descricao: 'Camarões salteados no alho, cream cheese e ciboulette.' },
];
for (const pizza of pizzasSalgadas) {
  criarProduto(pizzariaId, { ...pizza, grupos: [TAMANHOS_PIZZA, BORDA_SALGADA, ADICIONAIS_PIZZA] });
}
criarProduto(pizzariaId, {
  nome: 'Pizza de Chocolate com Morango', categoria: 'Pizzas Doces', preco: 4490, serve: 2,
  descricao: 'Chocolate ao leite derretido, morangos frescos e raspas de chocolate branco.',
  grupos: [
    TAMANHOS_PIZZA,
    { nome: 'Borda doce', tipo: 'unico',
      opcoes: [['Borda de chocolate', 1000], ['Borda de doce de leite', 1000]] },
    { nome: 'Adicionais', tipo: 'multiplo', max: 3,
      opcoes: [['Leite condensado', 400], ['Granulado', 300], ['Morangos extras', 600]] },
  ],
});
criarProduto(pizzariaId, {
  nome: 'Pizza Romeu e Julieta', categoria: 'Pizzas Doces', preco: 4290, serve: 2,
  descricao: 'Goiabada cremosa com queijo minas derretido.',
  grupos: [TAMANHOS_PIZZA],
});
criarProduto(pizzariaId, { nome: 'Refrigerante 2L', categoria: 'Bebidas', preco: 1400,
  descricao: 'Coca-Cola, Guaraná ou Soda.' });
criarProduto(pizzariaId, { nome: 'Suco de Laranja 1L', categoria: 'Bebidas', preco: 1600,
  descricao: 'Natural, feito na hora.' });
criarProduto(pizzariaId, { nome: 'Água com gás 500ml', categoria: 'Bebidas', preco: 600 });
criarProduto(pizzariaId, { nome: 'Petit Gâteau', categoria: 'Sobremesas', preco: 1890, promo: 1590,
  descricao: 'Bolinho de chocolate com recheio cremoso e sorvete de creme.' });

// ----- Hamburgueria --------------------------------------------------------
const burgerId = criarLoja(lojista2Id, {
  nome: 'Burger do Bruno',
  descricao: 'Smash burgers com blend da casa e pão brioche.',
  categoria: 'Hamburgueria',
  endereco: 'Av. dos Ipês, 2222 - Jardim América - São Paulo/SP',
  taxa: 600, tempo: 35, horario: 'Todos os dias, 11h às 23h',
});

const EXTRAS_BURGER: GrupoSeed = {
  nome: 'Turbine seu burger', tipo: 'multiplo', max: 4,
  opcoes: [
    ['Carne extra 120g', 900], ['Cheddar extra', 400], ['Bacon extra', 500],
    ['Ovo', 300], ['Cebola caramelizada', 400],
  ],
};
const COMBO_BURGER: GrupoSeed = {
  nome: 'Acompanhamento (combo)', tipo: 'unico',
  opcoes: [
    ['Combo batata média + refri lata', 1400],
    ['Combo onion rings + refri lata', 1600],
  ],
};

const burgers: ProdutoSeed[] = [
  { nome: 'Smash Clássico', categoria: 'Hambúrgueres', preco: 2890, serve: 1, destaque: true,
    descricao: 'Blend 120g, queijo cheddar, picles e molho da casa.' },
  { nome: 'Smash Duplo Bacon', categoria: 'Hambúrgueres', preco: 3790, promo: 3390, serve: 1,
    descricao: 'Dois blends 120g, cheddar duplo e bacon crocante.' },
  { nome: 'Veggie Burger', categoria: 'Hambúrgueres', preco: 2990, serve: 1,
    descricao: 'Hambúrguer de grão-de-bico, queijo prato e maionese verde.' },
];
for (const b of burgers) {
  criarProduto(burgerId, { ...b, grupos: [EXTRAS_BURGER, COMBO_BURGER] });
}
criarProduto(burgerId, { nome: 'Batata Frita Média', categoria: 'Acompanhamentos', preco: 1490,
  descricao: 'Porção com sal e alecrim.',
  grupos: [{ nome: 'Molhos', tipo: 'multiplo', max: 3,
    opcoes: [['Maionese da casa', 200], ['Barbecue', 200], ['Cheddar cremoso', 400]] }] });
criarProduto(burgerId, { nome: 'Onion Rings', categoria: 'Acompanhamentos', preco: 1690,
  descricao: 'Anéis de cebola empanados.' });
criarProduto(burgerId, { nome: 'Milk-shake de Ovomaltine', categoria: 'Bebidas', preco: 1990,
  descricao: '400ml de pura felicidade.' });

// ----- Banners do carrossel -----------------------------------------------
const BANNERS_DEMO = [
  { titulo: 'Pepperoni Prime em oferta — sexta da pizza',
    imagem: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=1200&h=500&fit=crop&auto=format&q=70',
    loja_id: pizzariaId, ordem: 0 },
  { titulo: 'Massa artesanal, mussarela de búfala e manjericão',
    imagem: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=1200&h=500&fit=crop&auto=format&q=70',
    loja_id: pizzariaId, ordem: 1 },
  { titulo: 'Smash burgers do Bruno — entrega em 35 min',
    imagem: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=1200&h=500&fit=crop&auto=format&q=70',
    loja_id: burgerId, ordem: 2 },
];
for (const b of BANNERS_DEMO) {
  const ja = db.prepare('SELECT id FROM banners WHERE titulo = ?').get(b.titulo);
  if (ja) continue;
  db.prepare(
    `INSERT INTO banners (titulo, imagem, loja_id, ordem, ativo, criado_em)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).run(b.titulo, b.imagem, b.loja_id, b.ordem, agora);
}

// Esconde produtos do seed antigo (exclusão lógica, preserva histórico)
for (const nomeAntigo of ['Pizza Quatro Queijos', 'Pizza de Chocolate']) {
  db.prepare('UPDATE produtos SET excluido = 1, disponivel = 0 WHERE loja_id = ? AND nome = ?')
    .run(pizzariaId, nomeAntigo);
}

const temEndereco = db.prepare('SELECT id FROM enderecos WHERE usuario_id = ?').get(clienteId);
if (!temEndereco) {
  db.prepare(
    `INSERT INTO enderecos (usuario_id, rotulo, rua, numero, complemento, bairro, cidade, uf, cep, referencia, criado_em)
     VALUES (?, 'Casa', 'Rua das Acácias', '42', 'Apto 31', 'Vila Nova', 'São Paulo', 'SP', '01234-567', 'Portão azul', ?)`
  ).run(clienteId, agora);
}

console.log('✅ Seed concluído. Contas de teste:');
console.log('   admin@demo.com      / admin123      (admin)');
console.log('   cliente@demo.com    / cliente123    (cliente)');
console.log('   lojista@demo.com    / lojista123    (lojista - Pizzaria da Paula)');
console.log('   lojista2@demo.com   / lojista123    (lojista - Burger do Bruno)');
console.log('   entregador@demo.com / entrega123    (entregador)');
console.log('   cozinha@demo.com    / cozinha123    (cozinha/KDS - Pizzaria da Paula)');
