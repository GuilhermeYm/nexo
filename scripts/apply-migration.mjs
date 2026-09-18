/**
 * Aplica migrations no banco, uma transação por bloco.
 *
 *   node --env-file=.env scripts/apply-migration.mjs drizzle/0009_....sql
 *   node --env-file=.env scripts/apply-migration.mjs          # todas, em ordem
 *
 * Sem argumento ele aplica **todas** as migrations de `drizzle/`, em ordem
 * numérica — é o que a primeira instalação precisa, e o que evita pedir um
 * laço de shell de três linhas a quem só quer subir a aplicação. Como toda
 * migration daqui é idempotente, repetir não duplica nada.
 *
 * Um arquivo pode ser dividido em blocos pelo marcador
 * `-- @separate-transaction`. Cada bloco roda na própria transação — é o que
 * permite criar um rótulo de enum e usá-lo em seguida, coisa que o Postgres
 * recusa dentro de uma transação só.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = "drizzle";

const files =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : readdirSync(MIGRATIONS_DIR)
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .map((name) => join(MIGRATIONS_DIR, name));

if (files.length === 0) throw new Error("nenhuma migration encontrada");

const blocksOf = (file) =>
  readFileSync(file, "utf8")
    .split(/^--\s*@separate-transaction\s*$/m)
    .map((block) => block.trim())
    .filter(Boolean);

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  for (const file of files) {
    const blocks = blocksOf(file);
    for (const [index, block] of blocks.entries()) {
      await client.query("BEGIN");
      await client.query(block);
      await client.query("COMMIT");
      console.log(`${file}: bloco ${index + 1}/${blocks.length} aplicado`);
    }
  }
  console.log("ok");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("ROLLBACK:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
