import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Inclui os helpers puros do frontend também. Eles nao tocam DOM nem React
    // (sao funcoes de calculo, como a escala da logo), e ficar sem teste so
    // porque moram em frontend/ seria acidente de pasta.
    include: ['src/backend/**/*.test.ts', 'frontend/src/**/*.test.ts'],
    // Segredos fixos só pra teste — cripto.ts e auth.ts leem na carga do
    // módulo (auth.ts chama process.exit(1) sem JWT_SECRET, o que mataria a
    // suíte inteira antes do primeiro teste rodar).
    /*
     * TETO DE 20s, CONTRA O VERDE QUE DEPENDE DA MÁQUINA.
     *
     * O padrão do vitest são 5s, e a suíte falhava sozinha mais ou menos uma
     * corrida em quatro — sempre nos mesmos poucos testes, sempre com "Test
     * timed out in 5000ms" e nunca com uma asserção errada:
     *
     *   ajustar-fotos / imagem-web   geram imagem de VERDADE com sharp
     *   segredos-em-repouso          deriva chave com scrypt, que é lento de propósito
     *
     * Rodando sozinhos, os três passam em cinco de cinco. O que estoura o
     * relógio é a disputa de CPU com os outros 150 arquivos em paralelo — ou
     * seja, o resultado dependia de quanta máquina sobrou naquele instante.
     *
     * Isso é pior que um teste vermelho: é um teste que às vezes mente, e
     * ensina a ignorar a suíte justamente no dia em que ela estiver certa.
     *
     * 20s é folgado para trabalho que leva centenas de milissegundos e continua
     * curto para pegar travamento de verdade — a suíte inteira roda em ~80s.
     */
    testTimeout: 20_000,
    env: {
      APP_SECRET: 'segredo-de-teste-so-para-vitest-1234567890',
      JWT_SECRET: 'jwt-de-teste-so-para-vitest-0987654321',
      MYSQL_DATABASE: 'tenant_teste_a',
    },
  },
});
