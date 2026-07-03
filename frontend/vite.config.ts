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
          if (id.includes('/pages/admin/')) return 'painel-admin';
          if (id.includes('/pages/lojista/')) return 'painel-lojista';
          if (id.includes('/pages/entregador/')) return 'painel-entregador';
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
