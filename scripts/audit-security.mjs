/**
 * Auditoria de segurança do banco.
 *
 *   bun run audit
 *
 * Confere no Postgres — não no código — as invariantes que o AGENTS.md exige
 * e que nenhum teste de interface alcança. Uma policy esquecida não quebra
 * nada visível: a aplicação continua funcionando porque o Drizzle entra pela
 * `DATABASE_URL` e passa por cima da RLS. Quem sente a falta é quem chegar
 * pela chave anônima, e aí já é tarde.
 *
 * O que ele verifica:
 *
 *   1. RLS ligada em toda tabela de `public`.
 *   2. Nenhuma policy com `true` como condição — RLS ligada e inútil.
 *   3. Toda policy de INSERT/UPDATE com `WITH CHECK`. Sem ele, `USING` decide
 *      só de qual linha a pessoa parte, não para onde ela vai: dá para mover
 *      a própria linha para outra conta.
 *   4. As colunas que o cliente pode escrever, onde o GRANT é por coluna.
 *   5. As funções `SECURITY DEFINER` fora do alcance de anon/authenticated.
 *   6. Que toda tabela do schema do Drizzle existe de fato — é o que pega
 *      migration escrita e nunca aplicada.
 *
 * Roda com `node --env-file=.env`.
 */
import pg from "pg";

/** Tabelas que o `lib/db/schema.ts` declara. Fora daqui, o app não lê nada. */
const EXPECTED_TABLES = [
  "ai_jobs",
  "attachments",
  "audit_logs",
  "note_tags",
  "notes",
  "notifications",
  "profiles",
  "tags",
  "workspace_connections",
  "workspace_windows",
  "workspaces",
];

/**
 * Onde o cliente escreve por coluna, e quais colunas.
 *
 * A regra vale para tudo que o servidor considera seu: assinatura, autoria,
 * destino de uma flecha. O GRANT por coluna é o que impede o PostgREST de
 * aceitar o que a rota recusaria.
 */
const COLUMN_GRANTS = [
  { table: "profiles", privilege: "UPDATE", columns: ["display_name", "avatar_url"] },
  { table: "notifications", privilege: "UPDATE", columns: ["read", "read_at"] },
  { table: "workspace_connections", privilege: "UPDATE", columns: ["label"] },
];

/**
 * O que a role `authenticated` **não** pode fazer, por tabela.
 *
 * São as escritas que pertencem ao servidor. Uma linha de auditoria que o
 * auditado apaga não é auditoria; um job de IA que o dono edita não é o
 * registro do que o worker fez; uma notificação que o destinatário escreve
 * não é notificação.
 */
const SERVER_ONLY_WRITES = [
  { table: "ai_jobs", privileges: ["INSERT", "UPDATE", "DELETE"] },
  { table: "audit_logs", privileges: ["INSERT", "UPDATE", "DELETE"] },
  { table: "notifications", privileges: ["INSERT", "DELETE"] },
];

/** Funções internas que nenhuma rota chama por RPC. */
const PRIVATE_FUNCTIONS = ["handle_new_user", "rls_auto_enable"];

async function main() {
  const sql = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await sql.connect();

  const problems = [];
  const results = [];

  function check(label, ok, detail = "") {
    results.push(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) problems.push(label);
  }

  try {
    // ---- 1. as tabelas existem ----
    const { rows: tables } = await sql.query(
      `select c.relname as name, c.relrowsecurity as rls
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`
    );
    const byName = new Map(tables.map((row) => [row.name, row]));

    const missing = EXPECTED_TABLES.filter((name) => !byName.has(name));
    check(
      "toda tabela do schema existe no banco",
      missing.length === 0,
      missing.length ? `faltam: ${missing.join(", ")}` : `${tables.length} tabelas`
    );

    // ---- 2. RLS em todas ----
    const noRls = tables.filter((row) => !row.rls).map((row) => row.name);
    check(
      "RLS ligada em toda tabela de public",
      noRls.length === 0,
      noRls.length ? `sem RLS: ${noRls.join(", ")}` : ""
    );

    // ---- 3. nenhuma policy com `true` ----
    const { rows: policies } = await sql.query(
      `select tablename, policyname, cmd, qual, with_check
         from pg_policies where schemaname = 'public'`
    );
    check("existe policy em public", policies.length > 0, `${policies.length}`);

    const permissive = policies.filter(
      (row) =>
        normalize(row.qual) === "true" || normalize(row.with_check) === "true"
    );
    check(
      "nenhuma policy usa `true` como condição",
      permissive.length === 0,
      permissive.map((row) => `${row.tablename}.${row.policyname}`).join(", ")
    );

    // ---- 4. INSERT/UPDATE sempre com WITH CHECK ----
    //
    // `ALL` conta como as duas: o Postgres aplica o `USING` como `WITH CHECK`
    // implícito quando ele não é declarado, e é isso que a policy única de
    // `notes`, `tags` e companhia usa.
    const writable = policies.filter((row) => ["INSERT", "UPDATE"].includes(row.cmd));
    const unchecked = writable.filter((row) => !row.with_check);
    check(
      "toda policy de INSERT/UPDATE tem WITH CHECK",
      unchecked.length === 0,
      unchecked.map((row) => `${row.tablename}.${row.policyname}`).join(", ")
    );

    // ---- 5. GRANTs por coluna ----
    for (const grant of COLUMN_GRANTS) {
      const { rows: granted } = await sql.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = $1
            and grantee = 'authenticated' and privilege_type = $2
          order by column_name`,
        [grant.table, grant.privilege]
      );
      const actual = granted.map((row) => row.column_name).sort();
      const expected = [...grant.columns].sort();
      check(
        `${grant.table}: authenticated só ${grant.privilege} em (${expected.join(", ")})`,
        actual.length === expected.length &&
          actual.every((name, index) => name === expected[index]),
        actual.length ? actual.join(", ") : "nenhuma coluna"
      );
    }

    // ---- 6. escritas que só o servidor faz ----
    //
    // `has_table_privilege` e não `information_schema`: o privilégio pode vir
    // de PUBLIC ou de uma role herdada, e a tabela de catálogo lista só o que
    // foi concedido diretamente.
    for (const rule of SERVER_ONLY_WRITES) {
      const held = [];
      for (const privilege of rule.privileges) {
        const {
          rows: [row],
        } = await sql.query(
          `select has_table_privilege('authenticated', $1, $2) as ok`,
          [`public.${rule.table}`, privilege]
        );
        if (row.ok) held.push(privilege);
      }
      check(
        `${rule.table}: authenticated não faz ${rule.privileges.join("/")}`,
        held.length === 0,
        held.length ? `ainda pode: ${held.join(", ")}` : ""
      );
    }

    // ---- 7. funções internas fora do PostgREST ----
    for (const name of PRIVATE_FUNCTIONS) {
      const { rows } = await sql.query(
        `select
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
            p.prosecdef as definer
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [name]
      );
      if (rows.length === 0) {
        check(`${name}() existe`, false, "função não encontrada");
        continue;
      }
      check(
        `${name}() não é chamável por anon/authenticated`,
        rows.every((row) => !row.auth && !row.anon),
        rows.map((row) => `definer=${row.definer}`).join(", ")
      );
    }

    // ---- 8. o bucket de arquivos é privado ----
    const { rows: buckets } = await sql.query(
      "select id, public from storage.buckets"
    );
    const open = buckets.filter((row) => row.public).map((row) => row.id);
    check(
      "nenhum bucket do Storage é público",
      open.length === 0,
      open.length ? `públicos: ${open.join(", ")}` : `${buckets.length} bucket(s)`
    );

    // ---- 9. o Storage tem policy própria ----
    //
    // O bucket privado só impede a URL pública. Quem chega com a chave anônima
    // fala com `storage.objects`, e é lá que a RLS decide — sem policy, o
    // bucket privado é uma porta trancada com a janela aberta.
    const { rows: storagePolicies } = await sql.query(
      `select policyname, cmd, qual, with_check
         from pg_policies where schemaname = 'storage' and tablename = 'objects'`
    );
    check(
      "storage.objects tem policy de RLS",
      storagePolicies.length > 0,
      `${storagePolicies.length} policy(s)`
    );
    const looseStorage = storagePolicies.filter(
      (row) =>
        normalize(row.qual) === "true" || normalize(row.with_check) === "true"
    );
    check(
      "nenhuma policy do Storage usa `true`",
      looseStorage.length === 0,
      looseStorage.map((row) => row.policyname).join(", ")
    );

    console.log(results.join("\n"));
    console.log(
      problems.length
        ? `\n${problems.length} problema(s):\n  ${problems.join("\n  ")}`
        : "\nNenhum problema."
    );
    process.exitCode = problems.length > 0 ? 1 : 0;
  } finally {
    await sql.end();
  }
}

/** `qual` e `with_check` vêm com parênteses e espaços do parser do Postgres. */
function normalize(expression) {
  return (expression ?? "").replace(/[()\s]/g, "").toLowerCase();
}

await main();
