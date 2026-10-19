/**
 * Os testes e2e gravam e apagam dados, então só rodam num banco próprio
 * (DATABASE_URL_TEST, nome terminado em _test) e nunca no banco do dia a dia.
 */
export function testDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) return undefined;
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error(
      `DATABASE_URL_TEST aponta para "${name}"; o nome do banco de testes precisa terminar em _test.`,
    );
  }
  return url;
}
