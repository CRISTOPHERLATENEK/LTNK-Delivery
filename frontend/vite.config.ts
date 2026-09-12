import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

/**
 * Em desenvolvimento: Vite serve em 5173 e faz proxy de /api para o backend
 * (Express em 3000). Em produção: rodamos `npm run build` e a saída vai para
 * ../public/app/, servida estaticamente pelo Express.
 */
/**
 * O LABORATORIO DE TELA ESTREITA ENTRA SO NO SERVIDOR DE DESENVOLVIMENTO.
 *
 * `frontend/public/laboratorio-mobile.js` poe sessao e rede de mentira no
 * navegador para DESENHAR as telas do painel (que ficam atras de login) em 375
 * px e medir o que estoura. Ele e inerte sem `?laboratorio=1` na URL, mas nem
 * assim deve ir junto no build: script que fabrica sessao nao tem o que fazer
 * num arquivo publicado, e quem ler o HTML de producao amanha vai perder tempo
 * decidindo se aquilo e um buraco.
 *
 * `apply: 'serve'` e o que garante isso — o plugin nao roda no `vite build`.
 *
 *   npm run dev  →  http://localhost:5173/lojista/produtos?laboratorio=1
 */
function laboratorioMobile(): PluginOption {
  return {
    name: 'laboratorio-mobile',
    apply: 'serve',
    /*
     * O ARQUIVO MORA EM `frontend/dev/`, e NAO em `public/`: tudo que esta em
     * `public/` e copiado verbatim para o build, entao de la ele seria
     * publicado junto com o site. Aqui ele so existe enquanto o servidor de
     * desenvolvimento estiver no ar, servido por esta funcao.
     */
    configureServer(servidor) {
      servidor.middlewares.use('/laboratorio-mobile.js', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.end(fs.readFileSync(path.resolve(__dirname, 'dev/laboratorio-mobile.js'), 'utf8'));
      });
    },
    transformIndexHtml(html: string) {
      return html.replace('<meta charset="UTF-8" />',
        '<meta charset="UTF-8" />' + '\n    ' + '<script src="/laboratorio-mobile.js"><' + '/script>');
    },
  };
}

export default defineConfig({
  plugins: [react(), laboratorioMobile()],
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
    /*
     * A SAIDA E CONFIGURAVEL POR VARIAVEL, e isso conserta um bug medido.
     *
     * O deploy constroi numa COPIA (`public.novo`) para nao mexer no que esta
     * no ar, e passava `--outDir ../public.novo` na linha de comando. So que o
     * Vite continuava usando ESTE caminho aqui para a limpeza: ele escrevia em
     * `public.novo` e APAGAVA `public/app-assets`.
     *
     * Medido em 10/09/2026 pelo vigia do deploy.sh, contando os arquivos em
     * cada passo:
     *
     *   40 rm public.novo/app-assets .... 56 assets
     *   50 vite build ................... 0 assets   <- aqui
     *   60 pos-restauracao .............. 56 assets
     *
     * O custo disso nao era teorico: entre o build e a restauracao a pasta fica
     * VAZIA, e quem esta com o app aberto pede um chunk e leva 404. Foi o que
     * aconteceu com o dono da plataforma — 37 pedidos de asset com 404 em 20
     * segundos, incluindo o index .js e o index .css, ou seja tela branca.
     *
     * Com a saida vindo daqui, o deploy define SAIDA_BUILD e o Vite resolve
     * tudo (escrita E limpeza) para a copia. O `../public` continua sendo o
     * padrao, que e o que o build local usa.
     *
     * SEM o prefixo VITE_ de proposito: variavel com esse prefixo entra no
     * bundle do cliente, e isto e caminho de disco do servidor de build.
     */
    outDir: process.env.SAIDA_BUILD || '../public',
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
