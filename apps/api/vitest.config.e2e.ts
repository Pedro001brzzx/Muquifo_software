import { defineConfig } from 'vitest/config';

try {
  process.loadEnvFile();
} catch {
  // Sem .env: os testes e2e são pulados se DATABASE_URL não estiver no ambiente.
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
