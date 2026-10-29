// Junta o servidor (apps/api/dist, já compilado pelo nest build) e as
// dependências num arquivo só, para a versão instalada não levar node_modules
// (de ~87 MB para poucos MB). Uso: node scripts/bundle-api.mjs <saída.mjs>

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// esbuild é dependência de desenvolvimento da API.
const { build } = createRequire(join(root, 'apps/api/package.json'))('esbuild');

const outfile = process.argv[2];
if (!outfile) throw new Error('Informe o arquivo de saída.');
const { version } = createRequire(import.meta.url)(
  join(root, 'apps/api/package.json'),
);

const result = await build({
  entryPoints: [join(root, 'apps/api/dist/main.js')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  minify: true,
  // Nomes de classe preservados: o Nest os usa em logs e na injeção.
  keepNames: true,
  legalComments: 'external',
  metafile: true,
  // Pacotes CommonJS chamam require(); no ESM ele precisa ser criado.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  // Opcionais que o Nest/pg tentam carregar dentro de try/catch e não usamos.
  external: [
    '@nestjs/microservices',
    '@nestjs/microservices/*',
    '@nestjs/websockets',
    '@nestjs/websockets/*',
    '@nestjs/platform-express',
    'class-transformer',
    'class-transformer/*',
    'class-validator',
    '@fastify/view',
    '@fastify/multipart',
    'pg-native',
  ],
  // Versão gravada no arquivo: não há package.json ao lado na instalação.
  define: { 'process.env.MUQUIFO_VERSION': JSON.stringify(version) },
  logLevel: 'warning',
});

const bytes = Object.values(result.metafile.outputs).reduce(
  (sum, o) => sum + o.bytes,
  0,
);
console.log(
  `Servidor em um arquivo: ${outfile} (${(bytes / 1e6).toFixed(1)} MB)`,
);
