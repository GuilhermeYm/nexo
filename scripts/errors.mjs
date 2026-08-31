/**
 * Triagem dos relatórios de erro, do terminal.
 *
 *   bun run errors                             # a fila: reportado e não resolvido
 *   bun run errors -- --todos                  # tudo, do mais recente
 *   bun run errors -- --codigo NX-7F3A-2K9     # um relatório inteiro
 *   bun run errors -- --resolver NX-7F3A-2K9   # marca resolvido e avisa a pessoa
 *   bun run errors -- --limpar                 # retenção (ensaio)
 *   bun run errors -- --limpar --confirmar     # retenção de verdade
 *
 * **Por que um script e não uma tela interna.** A tela viria com autenticação
 * de administrador, papéis, e uma segunda superfície de leitura para uma
 * tabela cujo conteúdo interno não deve ter superfície de leitura nenhuma no
 * navegador. Enquanto o suporte for quem escreveu o produto, o terminal com a
 * `DATABASE_URL` na mão responde melhor e não abre porta. No dia em que
 * houver equipe de suporte, isto vira a especificação da tela.
 *
 * Roda com `node --env-file=.env` (o `package.json` já faz isso).
 */
import pg from "pg";

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
};

/** Resolvido e parado há mais de isto: pode sair. */
const RETENTION_DAYS = 90;

async function main() {
  const sql = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await sql.connect();

  try {
    const code = valueOf("--codigo");
    const resolving = valueOf("--resolver");

    if (code) return await showOne(sql, code);
    if (resolving) return await resolve(sql, resolving);
    if (has("--limpar")) return await purge(sql, has("--confirmar"));
    return await list(sql, has("--todos"));
  } finally {
    await sql.end();
  }
}

/**
 * A fila.
 *
 * O padrão é **só o que alguém reportou e ninguém resolveu**, e não "todos os
 * erros": a tabela guarda muita coisa que ninguém notou nem se incomodou com,
 * e uma lista que mistura as duas transforma a triagem em leitura de log. O
 * que pede resposta é o que tem gente do outro lado esperando.
 */
async function list(sql, todos) {
  const { rows } = await sql.query(
    `select code, kind, route, occurrences, user_id,
            user_report, user_reported_at, resolved_at, last_seen_at
       from error_reports
      ${todos ? "" : "where user_reported_at is not null and resolved_at is null"}
      order by coalesce(user_reported_at, last_seen_at) desc
      limit 50`
  );

  if (rows.length === 0) {
    console.log(
      todos
        ? "Nenhum relatório de erro."
        : "Nada na fila — ninguém está esperando resposta."
    );
    return;
  }

  for (const row of rows) {
    const state = row.resolved_at
      ? "resolvido"
      : row.user_reported_at
        ? "REPORTADO"
        : "silencioso";
    console.log(
      `${row.code}  ${state.padEnd(11)} ${row.kind.padEnd(9)} ${row.route}` +
        (row.occurrences > 1 ? `  (${row.occurrences}x)` : "")
    );
    if (row.user_report) console.log(`             "${row.user_report}"`);
  }

  console.log(`\n${rows.length} relatório(s). Detalhes: --codigo <NX-…>`);
}

/** Um relatório inteiro — é aqui, e só aqui, que `message` e `stack` saem. */
async function showOne(sql, code) {
  const { rows } = await sql.query(
    "select * from error_reports where code = $1",
    [code.trim().toUpperCase()]
  );

  const row = rows[0];
  if (!row) {
    // Vale dizer o motivo provável: código efêmero (a escrita falhou) e
    // código expirado pela retenção dão exatamente esta resposta.
    console.log(
      `Nada com ${code}. Pode ter expirado pela retenção, ou ser um código efêmero — nesse caso o motivo está no log do servidor, procure por ele lá.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`código        ${row.code}`);
  console.log(`origem        ${row.kind}`);
  console.log(`rota          ${row.route}`);
  console.log(`usuário       ${row.user_id ?? "(sem sessão)"}`);
  console.log(`ocorrências   ${row.occurrences}`);
  console.log(`primeira      ${row.first_seen_at.toISOString()}`);
  console.log(`última        ${row.last_seen_at.toISOString()}`);
  console.log(`resolvido     ${row.resolved_at?.toISOString() ?? "não"}`);
  console.log(`user-agent    ${row.user_agent ?? "-"}`);
  console.log(`ip            ${row.ip_address ?? "-"}`);
  if (row.user_report) {
    console.log(`\nrelato da pessoa (${row.user_reported_at.toISOString()}):`);
    console.log(row.user_report);
  }
  console.log(`\nmensagem:\n${row.message}`);
  if (row.context) console.log(`\ncontexto:\n${JSON.stringify(row.context, null, 2)}`);
  if (row.stack) console.log(`\nstack:\n${row.stack}`);
}

/**
 * Marca resolvido e fecha o ciclo na Entrada.
 *
 * **A notificação só sai se a pessoa reportou.** Um erro que ela nunca viu,
 * nunca citou e nunca reclamou não precisa virar um aviso dizendo que foi
 * resolvido — seria contar um problema depois de consertá-lo, o que produz
 * exatamente a preocupação que não existia.
 *
 * O `INSERT` é escrito à mão aqui porque `notifySystem` é TypeScript da
 * aplicação; a porta é a mesma (a `DATABASE_URL` passa por cima da RLS, e
 * `notifications` tem INSERT revogado de `authenticated`).
 */
async function resolve(sql, code) {
  const {
    rows: [row],
  } = await sql.query(
    `update error_reports
        set resolved_at = now()
      where code = $1 and resolved_at is null
      returning code, user_id, user_reported_at, route`,
    [code.trim().toUpperCase()]
  );

  if (!row) {
    console.log(`Nada a resolver em ${code} (inexistente ou já resolvido).`);
    process.exitCode = 1;
    return;
  }

  console.log(`${row.code} marcado como resolvido.`);

  if (!row.user_id || !row.user_reported_at) {
    console.log("Sem aviso na Entrada: ninguém reportou este erro.");
    return;
  }

  await sql.query(
    `insert into notifications (user_id, type, title, body, metadata)
     values ($1, 'system', $2, $3, $4)`,
    [
      row.user_id,
      "O erro que você reportou foi resolvido",
      `Obrigado por avisar. O problema do código ${row.code} foi corrigido — se ele voltar a acontecer, é só reportar de novo.`,
      JSON.stringify({ kind: "error_resolved", code: row.code }),
    ]
  );

  console.log("Aviso enviado para a Entrada da pessoa.");
}

/**
 * Retenção.
 *
 * Erro é diagnóstico, não conteúdo da pessoa — diferente de `ai_jobs` e de
 * `notes`, onde uma limpeza por tempo destruiria justamente as linhas que
 * pedem ação. Aqui um relatório resolvido e parado há três meses não responde
 * mais pergunta nenhuma.
 *
 * **O que não sai:** o que ninguém resolveu. Um erro antigo e nunca triado é
 * dívida, não lixo, e apagá-lo faria a fila parecer limpa por decurso de
 * prazo.
 *
 * Ensaia por padrão, como `bun run notify`: apagar linha por engano num
 * comando de manutenção é o tipo de coisa que só se descobre quando alguém
 * procura o código e ele não está lá.
 */
async function purge(sql, confirmed) {
  const where = `resolved_at is not null and last_seen_at < now() - interval '${RETENTION_DAYS} days'`;

  if (!confirmed) {
    const {
      rows: [row],
    } = await sql.query(`select count(*)::int as total from error_reports where ${where}`);
    console.log(
      `${row.total} relatório(s) resolvido(s) há mais de ${RETENTION_DAYS} dias.\n` +
        "Nada foi apagado. Repita com --confirmar para apagar de verdade."
    );
    return;
  }

  const { rowCount } = await sql.query(`delete from error_reports where ${where}`);
  console.log(`${rowCount} relatório(s) apagado(s).`);
}

await main();
