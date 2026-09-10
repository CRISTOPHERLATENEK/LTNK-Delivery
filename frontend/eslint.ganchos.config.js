/**
 * SO A REGRA DOS GANCHOS — a que derrubou a vitrine em produção.
 *
 * POR QUE UMA CONFIGURAÇÃO SEPARADA. `npm run lint` usa a configuração cheia
 * (typescript-eslint com tipos, no-unused-vars, no-explicit-any) e leva 78
 * segundos, além de reportar 250 problemas antigos — então ninguém roda, e o
 * aviso que importava ficava enterrado. Medido em 10/09/2026: 101
 * `no-unused-vars`, 73 `no-explicit-any`, e no meio disso UM
 * `rules-of-hooks` que era um site fora do ar.
 *
 * O QUE ACONTECEU: um `useState` declarado depois do `return` de carregamento
 * na vitrine. Na primeira renderização o gancho não rodava, na segunda rodava;
 * o React conta ganchos e derrubou a página com "Rendered more hooks than
 * during the previous render". Quem abriu a loja da Galderio viu "Ops, algo
 * deu errado". O eslint pegava isso — bastava rodar.
 *
 * Esta configuração NÃO carrega tipos: a regra é sintática, então roda em
 * poucos segundos e cabe como porteiro do deploy (`deploy.sh`).
 *
 *   npm run lint:ganchos
 */
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    /*
     * OS OUTROS PLUGINS ENTRAM SEM NENHUMA REGRA LIGADA. Sao os comentarios
     * `eslint-disable` espalhados pelo codigo: eles citam regras destes
     * plugins, e sem os nomes registrados o eslint acusa "Definition for rule
     * not found" — 13 erros que nao existem, que e como um porteiro perde a
     * autoridade.
     */
    plugins: {
      'react-hooks': reactHooks,
      '@typescript-eslint': tseslint.plugin,
      'react-refresh': reactRefresh,
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      parser: (await import('@typescript-eslint/parser')).default,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    /*
     * UMA REGRA SÓ, de propósito. `exhaustive-deps` tem 28 violações antigas e
     * é conselho; esta é a que quebra a tela em branco. Porteiro que reclama de
     * tudo é porteiro que ninguém escuta.
     */
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
])
