# Muquifo — sistema de gestão para restaurantes

Monorepo pnpm. Etapa atual: **prova técnica** (API + PostgreSQL + cliente React de testes na rede local).

```
apps/api            NestJS 12 + Fastify, Drizzle ORM, PostgreSQL   → /api/v1
apps/web            React + Vite + TanStack Query (console de testes)
packages/contracts  Schemas Zod e tipos compartilhados (validação em execução)
```

## Pré-requisitos

- Node 24+, pnpm 12+
- PostgreSQL 15+ local

## Primeira execução

```powershell
pnpm install

# 1. Banco: crie usuário e base (ajuste a senha)
psql -U postgres -c "CREATE ROLE muquifo LOGIN PASSWORD 'muquifo';"
psql -U postgres -c "CREATE DATABASE muquifo OWNER muquifo;"

# 2. Configuração da API
Copy-Item apps/api/.env.example apps/api/.env   # edite DATABASE_URL se necessário

# 3. Estrutura e dados de demonstração
pnpm db:migrate
pnpm db:seed

# 4. Em dois terminais
pnpm dev:api    # http://localhost:3000/api/v1/health
pnpm dev:web    # http://localhost:5173
```

Os dois servidores escutam na rede local; o log da API mostra os IPs. Abrindo
`http://<ip-do-pc>:5173` no celular, o app aponta automaticamente para `http://<ip-do-pc>:3000`.
Libere as portas 3000 e 5173 no firewall do Windows **apenas para redes privadas**.

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm db:generate --name <nome>` | Gera migration SQL a partir de `apps/api/src/db/schema.ts` |
| `pnpm db:migrate` | Aplica migrations pendentes |
| `pnpm db:seed` | Insere dados de demonstração (idempotente) |
| `pnpm test` | Testes unitários |
| `pnpm test:e2e` | Testes da API contra o PostgreSQL do `.env` |
| `pnpm lint` | oxlint + checagem de tipos |
| `pnpm format` | Formata e organiza imports com Biome |
| `pnpm format:check` | Verifica formatação sem alterar arquivos |
| `pnpm build` | Build de todos os pacotes |

## Convenções da API

- Prefixo `/api/v1`; IDs UUID; dinheiro em **centavos inteiros**.
- Erros sempre em `{ code, message, details?, requestId }`; o `requestId` também vai no header `x-request-id`.
- Concorrência otimista: alterações enviam `version`; versão desatualizada retorna `409 VERSION_CONFLICT`.
- Validação com os schemas de `@muquifo/contracts` (`422 VALIDATION_FAILED`).
