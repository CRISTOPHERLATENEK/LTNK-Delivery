import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Em desenvolvimento: Vite serve em 5173 e faz proxy de /api para o backend
 * (Express em 3000). Em produção: rodamos `npm run build` e a saída vai para
 * ../public/app/, servida estaticamente pelo Express.
 */
export default defineConfig({
  plugins: [react()],
  /**
   * O .env do projeto é UM só, na raiz — mas o Vite roda de dentro de frontend/ e
   * por padrão procuraria o .env aqui. Sem isto, `VITE_SENTRY_DSN` colado na raiz
   * (como o .env.example manda) simplesmente não existia no build, e o Sentry do
   * frontend ficava desligado sem nenhum aviso.
   *
   * Só variáveis com prefixo VITE_ entram no bundle; segredos do backend que
   * moram no mesmo arquivo (ONZ, banco, APP_SECRET) continuam de fora.
   */
  envDir: path.resolve(__dirname, '..'),
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    outDir: '../public',
    emptyOutDir: false,
    assetsDir: 'app-assets',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@tanstack')) return 'vendor-query';
          if (id.includes('node_modules/framer-motion')) return 'vendor-motion';
          if (id.includes('node_modules/@radix-ui')) return 'vendor-ui';
          // Os painéis internos NÃO entram em manualChunks: eles são carregados
          // via React.lazy (App.tsx) e o próprio bundler já cria um chunk por
          // import(). Forçá-los num chunk nomeado aqui os colocava no grafo
          // inicial — o index.html ganhava <link modulepreload> pra cada um e o
          // visitante do cardápio baixava ~1 MB de painel que nunca abriria.
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
