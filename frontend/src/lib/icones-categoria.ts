/**
 * Ícones (Lucide) disponíveis para categorias do cardápio.
 * `icone` da categoria guarda a `chave` aqui (ex.: "pizza"), não mais um emoji —
 * categorias antigas que ainda tiverem um emoji salvo continuam funcionando
 * (ver fallback em CardCategoria, loja.tsx).
 */
import {
  Pizza, Hamburger, Sandwich, CupSoda, IceCream, Cake, Dessert, Coffee,
  Beer, Wine, Salad, Soup, Fish, Beef, Drumstick, Croissant, Egg, Popcorn,
  Utensils, type LucideIcon,
} from 'lucide-react';

export interface IconeCategoriaDef {
  chave: string;
  label: string;
  Icone: LucideIcon;
}

export const ICONES_CATEGORIA: IconeCategoriaDef[] = [
  { chave: 'pizza', label: 'Pizza', Icone: Pizza },
  { chave: 'hamburguer', label: 'Hambúrguer', Icone: Hamburger },
  { chave: 'sanduiche', label: 'Sanduíche', Icone: Sandwich },
  { chave: 'bebida', label: 'Bebida', Icone: CupSoda },
  { chave: 'sorvete', label: 'Sorvete', Icone: IceCream },
  { chave: 'bolo', label: 'Bolo', Icone: Cake },
  { chave: 'sobremesa', label: 'Sobremesa', Icone: Dessert },
  { chave: 'cafe', label: 'Café', Icone: Coffee },
  { chave: 'cerveja', label: 'Cerveja', Icone: Beer },
  { chave: 'vinho', label: 'Vinho', Icone: Wine },
  { chave: 'salada', label: 'Salada', Icone: Salad },
  { chave: 'sopa', label: 'Sopa', Icone: Soup },
  { chave: 'peixe', label: 'Peixe', Icone: Fish },
  { chave: 'carne', label: 'Carne', Icone: Beef },
  { chave: 'frango', label: 'Frango', Icone: Drumstick },
  { chave: 'padaria', label: 'Padaria', Icone: Croissant },
  { chave: 'ovo', label: 'Ovo', Icone: Egg },
  { chave: 'pipoca', label: 'Pipoca', Icone: Popcorn },
  { chave: 'geral', label: 'Geral', Icone: Utensils },
];

const MAPA_ICONES = new Map(ICONES_CATEGORIA.map(i => [i.chave, i.Icone]));

/** Devolve o componente do ícone pra uma chave salva, ou null se não for uma chave conhecida (ex.: emoji antigo). */
export function iconeCategoria(chave?: string | null): LucideIcon | null {
  if (!chave) return null;
  return MAPA_ICONES.get(chave) ?? null;
}
