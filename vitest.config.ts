import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/backend/**/*.test.ts'],
    // Segredos fixos só pra teste — cripto.ts e auth.ts leem na carga do
    // módulo (auth.ts chama process.exit(1) sem JWT_SECRET, o que mataria a
    // suíte inteira antes do primeiro teste rodar).
    env: {
      APP_SECRET: 'segredo-de-teste-so-para-vitest-1234567890',
      JWT_SECRET: 'jwt-de-teste-so-para-vitest-0987654321',
      MYSQL_DATABASE: 'tenant_teste_a',
    },
  },
});
