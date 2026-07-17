import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { chaveTema } from '@/lib/api';
import { reaplicarPaletaTema } from '@/lib/tema';

/** Alterna modo claro/escuro persistindo a escolha por área em localStorage. */
export function ThemeToggle() {
  // Deriva da preferência salva da ÁREA atual (não da classe global do <html>):
  // numa navegação SPA entre áreas (ex.: landing → loja, que compartilham o
  // mesmo app), a classe "dark" do documento pode estar transitoriamente
  // "suja" de outra área nesse meio-tempo — ler localStorage evita vazar
  // a preferência escura de uma área pra outra.
  const [escuro, setEscuro] = useState(() => {
    const salvo = localStorage.getItem(chaveTema());
    if (salvo) return salvo === 'escuro';
    return matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', escuro);
    // Recalcula as variáveis de cor que dependem do modo (ex.: --accent),
    // senão valores do tema anterior ficam "presos" como estilo inline.
    reaplicarPaletaTema();
    // Preferência isolada por área (cliente/lojista/entregador/cozinha/admin).
    localStorage.setItem(chaveTema(), escuro ? 'escuro' : 'claro');
  }, [escuro]);

  return (
    <button
      onClick={() => setEscuro(v => !v)}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-accent transition-colors"
      aria-label={escuro ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={escuro ? 'lua' : 'sol'}
          initial={{ y: -10, opacity: 0, rotate: -90 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: 10, opacity: 0, rotate: 90 }}
          transition={{ duration: 0.2 }}
        >
          {escuro ? <Moon className="size-5" /> : <Sun className="size-5" />}
        </motion.div>
      </AnimatePresence>
    </button>
  );
}
