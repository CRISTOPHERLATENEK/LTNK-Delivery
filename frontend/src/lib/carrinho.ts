/**
 * Estado do carrinho persistido em localStorage, compartilhado via
 * `useCarrinho()` em qualquer componente. Implementação enxuta sem libs.
 */
import { useSyncExternalStore } from 'react';
import type { CarrinhoLocal, ItemCarrinho, Loja } from '@/types';

const CHAVE = 'carrinho';
const listeners = new Set<() => void>();

// Snapshot cacheado: o getSnapshot do useSyncExternalStore PRECISA devolver a
// mesma referência enquanto nada muda — senão o React 19 entra em loop infinito
// (erro #185). Só reparseia quando a string do localStorage realmente muda.
let cacheStr: string | null = null;
let cacheVal: CarrinhoLocal | null = null;

function ler(): CarrinhoLocal | null {
  const str = localStorage.getItem(CHAVE);
  if (str === cacheStr) return cacheVal;
  cacheStr = str;
  try { cacheVal = str ? JSON.parse(str) : null; }
  catch { cacheVal = null; }
  return cacheVal;
}

function gravar(carrinho: CarrinhoLocal | null) {
  if (carrinho && carrinho.itens.length === 0) carrinho = null;
  if (carrinho) localStorage.setItem(CHAVE, JSON.stringify(carrinho));
  else localStorage.removeItem(CHAVE);
  // invalida o cache para o próximo ler() devolver uma nova referência
  cacheStr = null;
  listeners.forEach(l => l());
}

function inscrever(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/** Hook reativo: re-renderiza quando o carrinho muda. */
export function useCarrinho(): CarrinhoLocal | null {
  return useSyncExternalStore(inscrever, ler, ler);
}

function chaveItem(produtoId: number, opcoes: number[]): string {
  return produtoId + ':' + [...opcoes].sort((a, b) => a - b).join(',');
}

/**
 * Adiciona um item; se o carrinho já for de outra loja, pergunta antes
 * de esvaziar. Retorna true se conseguiu adicionar.
 */
export function adicionarAoCarrinho(loja: Loja, item: Omit<ItemCarrinho, 'chave'>): boolean {
  let carrinho = ler();
  if (carrinho && carrinho.loja_id !== loja.id) {
    const trocar = window.confirm(
      `Seu carrinho tem itens de "${carrinho.loja_nome}". Esvaziar e começar um pedido em "${loja.nome}"?`,
    );
    if (!trocar) return false;
    carrinho = null;
  }
  if (!carrinho) {
    carrinho = {
      loja_id: loja.id,
      loja_nome: loja.nome,
      taxa_entrega_centavos: loja.taxa_entrega_centavos,
      itens: [],
    };
  }
  const chave = chaveItem(item.produto_id, item.opcoes);
  const existente = carrinho.itens.find(i => i.chave === chave);
  if (existente) existente.quantidade += item.quantidade;
  else carrinho.itens.push({ ...item, chave });
  gravar(carrinho);
  return true;
}

export function mudarQuantidade(chave: string, delta: number) {
  const carrinho = ler();
  if (!carrinho) return;
  const item = carrinho.itens.find(i => i.chave === chave);
  if (!item) return;
  item.quantidade += delta;
  if (item.quantidade <= 0) carrinho.itens = carrinho.itens.filter(i => i.chave !== chave);
  gravar(carrinho);
}

export function limparCarrinho() {
  gravar(null);
}

/** Conta total de itens (somando quantidades) — usado no badge. */
export function totalItensCarrinho(c: CarrinhoLocal | null): number {
  if (!c) return 0;
  return c.itens.reduce((s, i) => s + i.quantidade, 0);
}
