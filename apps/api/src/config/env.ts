import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().default('*'),
  API_DOCS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Aplica as migrations ao ligar (versão instalada: atualiza o banco sozinha). */
  MIGRATE_ON_START: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Pasta do build do app; vazio = apps/web/dist do monorepo, se existir. */
  WEB_DIR: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Lê e valida variáveis de ambiente uma vez; falha cedo com mensagem clara. */
export function loadEnv(): Env {
  if (cached) return cached;
  try {
    process.loadEnvFile();
  } catch {
    // .env é opcional; em produção as variáveis vêm do serviço do Windows.
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Configuração inválida:\n${z.prettifyError(parsed.error)}\nVeja apps/api/.env.example.`,
    );
  }
  cached = parsed.data;
  return cached;
}
