import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/test-database.js';

try {
  process.loadEnvFile();
} catch {
  // Sem .env: as variáveis podem vir do ambiente (CI).
}

const testUrl = testDatabaseUrl();
if (testUrl) {
  if (testUrl === process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL_TEST não pode ser igual a DATABASE_URL.');
  }
  // A aplicação lê DATABASE_URL; nos testes ela aponta para o banco _test.
  // process.loadEnvFile() não sobrescreve variáveis já definidas.
  process.env.DATABASE_URL = testUrl;
} else {
  // Sem banco de testes os e2e são pulados, em vez de gravar no banco do dia a dia.
  delete process.env.DATABASE_URL;
  console.warn(
    '\n[e2e] DATABASE_URL_TEST não definido: testes e2e pulados. Veja o README.\n',
  );
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Um arquivo por vez: o caixa é único (um aberto por vez) e o teste de
    // caixa abre e fecha o turno que os outros usam para receber.
    fileParallelism: false,
  },
});
