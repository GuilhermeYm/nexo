/**
 * Escrever na Entrada como Nexo, do terminal.
 *
 *   bun run notify -- --email alguem@exemplo.com --title "Título" --body "..."
 *   bun run notify -- --user <uuid> --title "..."
 *   bun run notify -- --todos --title "..." --body "..."          # ensaio
 *   bun run notify -- --todos --title "..." --body "..." --enviar # de verdade
 *
 * É a porta do **anúncio** — a mensagem que uma pessoa escreve para as
 * pessoas. O que o código dispara sozinho (cota, tarefa retomada, mudança de
 * plano) passa por `lib/inbox/notify.ts`, não por aqui.
 *
 * **Sem `--enviar`, nada é escrito.** O comando lista quem receberia e para.
 * Um anúncio para a base inteira é irreversível pelo produto — o usuário não
 * pode apagar notificação (a 0011 revoga `DELETE` dele), então uma frase com
 * erro de digitação fica na Entrada de todo mundo até alguém entrar no banco
 * para tirar. Um passo a mais é barato perto disso.
 *
 * Precisa de DATABASE_URL: roda com `node --env-file=.env`.
 */
import pg from "pg";

const args = process.argv.slice(2);

function flag(name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? null : (args[index + 1] ?? "");
}
const has = (name) => args.includes(`--${name}`);

const title = flag("title");
const body = flag("body");
const email = flag("email");
const user = flag("user");
const todos = has("todos");
const enviar = has("enviar");

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message) {
  console.error(`\n${message}\n`);
  console.error(
    [
      "uso:",
      '  bun run notify -- --email alguem@exemplo.com --title "Título" --body "Texto"',
      '  bun run notify -- --user <uuid> --title "Título"',
      '  bun run notify -- --todos --title "Título" --body "Texto" [--enviar]',
      "",
      "sem --enviar, o comando só mostra quem receberia.",
    ].join("\n")
  );
  process.exit(1);
}

if (!title || title.trim().length === 0) fail("Falta --title.");
if (title.length > 200) fail("O título passa de 200 caracteres.");
if (body && body.length > 2000) fail("O corpo passa de 2000 caracteres.");

const alvos = [email, user, todos ? "todos" : null].filter(Boolean);
if (alvos.length === 0) fail("Escolha um alvo: --email, --user ou --todos.");
if (alvos.length > 1) fail("Escolha só um alvo.");
if (user && !UUID.test(user)) fail("O --user não é um uuid.");

const sql = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await sql.connect();

try {
  // Quem recebe. O e-mail vive em `auth.users`, não em `profiles` — é lá que
  // o Supabase o guarda, e é por ele que uma pessoa é identificada.
  let recipients;
  if (todos) {
    const { rows } = await sql.query(
      "select id, email from auth.users order by created_at"
    );
    recipients = rows;
  } else if (email) {
    const { rows } = await sql.query(
      "select id, email from auth.users where lower(email) = lower($1)",
      [email]
    );
    recipients = rows;
  } else {
    const { rows } = await sql.query(
      "select id, email from auth.users where id = $1",
      [user]
    );
    recipients = rows;
  }

  if (recipients.length === 0) {
    console.error("\nNinguém corresponde a esse alvo. Nada foi escrito.\n");
    process.exit(1);
  }

  console.log(`\n  título: ${title}`);
  console.log(`  corpo : ${body ?? "(sem corpo)"}`);
  console.log(`\n  ${recipients.length} destinatário(s):`);
  for (const row of recipients.slice(0, 10)) {
    console.log(`    ${row.email}`);
  }
  if (recipients.length > 10) {
    console.log(`    … e mais ${recipients.length - 10}`);
  }

  if (!enviar) {
    console.log(
      "\n  Ensaio. Nada foi escrito — repita com --enviar para valer.\n"
    );
    process.exit(0);
  }

  // Um INSERT só, com a lista inteira: mil idas ao banco para a mesma frase
  // seriam mil oportunidades de a metade dar certo.
  const { rowCount } = await sql.query(
    `insert into notifications (user_id, type, title, body)
     select id, 'system', $2, $3 from unnest($1::uuid[]) as t(id)`,
    [recipients.map((row) => row.id), title.trim(), body?.trim() || null]
  );

  console.log(`\n  ${rowCount} notificação(ões) escrita(s).\n`);
} finally {
  await sql.end();
}
