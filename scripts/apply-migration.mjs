/**
 * Aplica uma migration no banco, com verificação antes de confirmar.
 *
 *   node --env-file=.env scripts/apply-migration.mjs drizzle/0009_....sql
 *
 * O arquivo pode ser dividido em blocos pelo marcador
 * `-- @separate-transaction`. Cada bloco roda na própria transação — é o que
 * permite criar um rótulo de enum e usá-lo em seguida, coisa que o Postgres
 * recusa dentro de uma transação só.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const file = process.argv[2];
if (!file) throw new Error("informe o arquivo da migration");

const blocks = readFileSync(file, "utf8")
  .split(/^--\s*@separate-transaction\s*$/m)
  .map((block) => block.trim())
  .filter(Boolean);

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  for (const [index, block] of blocks.entries()) {
    await client.query("BEGIN");
    await client.query(block);
    await client.query("COMMIT");
    console.log(`bloco ${index + 1}/${blocks.length} aplicado`);
  }
  console.log("ok");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("ROLLBACK:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
