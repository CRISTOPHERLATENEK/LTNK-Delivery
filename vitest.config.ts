import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/backend/**/*.test.ts'],
    // Segredo fixo só pra teste — cripto.ts lê isso na carga do módulo.
    env: { APP_SECRET: 'segredo-de-teste-so-para-vitest-1234567890' },
  },
});
