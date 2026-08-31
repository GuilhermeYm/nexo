/**
 * Teste de ponta a ponta do sistema de relatório de erro, com sessão real.
 *
 *   bun run shots:erros            # exercita e fotografa
 *   bun run shots:erros -- --keep  # não apaga os usuários de teste no fim
 *
 * O que ele prova, e que uma captura de tela sozinha não provaria:
 *
 *   - a rota devolve um **código** e a linha entra em `error_reports` com a
 *     `message` preenchida — que é justamente o que faltava no caso que
 *     motivou tudo isto (`ai_jobs.error = NULL`);
 *   - a segunda ocorrência do mesmo erro **incrementa** em vez de duplicar, e
 *     devolve o mesmo código;
 *   - um erro diferente ganha um código diferente (o dedupe agrupa, não
 *     colapsa tudo);
 *   - o `PATCH` grava o relato da pessoa, e só o dela: o código de outra
 *     conta responde 404 e não escreve nada;
 *   - **e a chave anônima não lê `message`, `stack` nem `context`.** Esta
 *     última parte é a razão de o roteiro existir: a interface fica idêntica
 *     se o GRANT por coluna estiver aberto, e a diferença só aparece para
 *     quem chegar pelo PostgREST. Mesmo ataque escrito de `shots:entrada`.
 *
 * Precisa de SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY e
 * DATABASE_URL: roda com `node --env-file=.env`.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import pg from "pg";
import { chromium } from "playwright-core";

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

const OUT = ".impeccable/review/erros";
const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const EMAIL = `qa-erros-${Date.now()}@nexo.test`;
const PASSWORD = "SenhaDeTesteForte!2026";
const HIDE_DEV_BADGE = "nextjs-portal{display:none !important}";

const CODE_RE = /^NX-[2-9BCDFGHJKMNPQRSTWXZ]{4}-[2-9BCDFGHJKMNPQRSTWXZ]{3}$/;

function findChrome() {
  const found =
    (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)
      ? process.env.CHROME_PATH
      : null) ?? CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) throw new Error("Chrome não encontrado. Defina CHROME_PATH.");
  return found;
}

/**
 * Reporta um erro de dentro da página, com a sessão real do navegador.
 *
 * Passa por `fetch` e não pela interface de propósito: o que está sendo
 * verificado aqui é o contrato da rota (código, dedupe, dono), e a única
 * forma de forçar um 500 de verdade pela tela seria derrubar um serviço.
 * As telas entram depois, nas capturas.
 */
async function report(page, body) {
  return page.evaluate(async (payload) => {
    const response = await fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, body);
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const sql = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await sql.connect();

  let userId = null;
  let victimId = null;
  let browser = null;
  const problems = [];
  const results = [];

  function check(label, ok, detail = "") {
    results.push(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) problems.push(label);
  }

  try {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: "Guilherme Moura" },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log("usuário de teste:", userId);

    // Uma segunda conta, dona do código que a primeira vai tentar reportar.
    const { data: other, error: otherError } = await admin.auth.admin.createUser({
      email: `qa-erros-alvo-${Date.now()}@nexo.test`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (otherError) throw otherError;
    victimId = other.user.id;

    browser = await chromium.launch({ executablePath: findChrome() });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "pt-BR",
    });
    const page = await context.newPage();

    // Duas das checagens abaixo pedem uma resposta de erro de propósito (o
    // 404 do código alheio). O navegador escreve isso no console como
    // "Failed to load resource", e sem esta janela o roteiro se acusaria de
    // um defeito que ele mesmo provocou.
    let expectingFailure = false;
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (expectingFailure) return;
      problems.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 30000 });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });

    // ---- 1. o código sai, e a linha entra ----
    const first = await report(page, {
      message: "TypeError: não foi possível ler 'id' de undefined",
      route: "dashboard/page",
      stack: "at Painel (dashboard-shell.tsx:120)",
    });
    const code = first.body?.code;
    check(
      "reportar devolve um código no formato ditável",
      first.status === 201 && CODE_RE.test(code ?? ""),
      `${first.status} ${code ?? "(sem código)"}`
    );

    const { rows: stored } = await sql.query(
      "select code, kind, user_id, message, stack, occurrences from error_reports where code = $1",
      [code ?? ""]
    );
    check(
      "a linha entra com message e stack preenchidos e o dono do token",
      stored.length === 1 &&
        stored[0].user_id === userId &&
        stored[0].kind === "client" &&
        (stored[0].message ?? "").length > 0 &&
        (stored[0].stack ?? "").length > 0,
      stored[0]?.message ?? "nenhuma linha"
    );

    // ---- 2. o dedupe ----
    const again = await report(page, {
      message: "TypeError: não foi possível ler 'id' de undefined",
      route: "dashboard/page",
      stack: "at Painel (dashboard-shell.tsx:120)",
    });
    const { rows: deduped } = await sql.query(
      "select occurrences from error_reports where code = $1",
      [code ?? ""]
    );
    const { rows: total } = await sql.query(
      "select count(*)::int as total from error_reports where user_id = $1",
      [userId]
    );
    check(
      "a segunda ocorrência incrementa em vez de duplicar",
      again.body?.code === code &&
        deduped[0]?.occurrences === 2 &&
        total[0].total === 1,
      `código ${again.body?.code}, ${deduped[0]?.occurrences}x, ${total[0].total} linha(s)`
    );

    // Erro diferente, código diferente: o dedupe agrupa, não colapsa tudo.
    const another = await report(page, {
      message: "Failed to fetch",
      route: "dashboard/page",
    });
    check(
      "um erro diferente ganha um código próprio",
      another.body?.code && another.body.code !== code,
      `${another.body?.code}`
    );

    // Um terceiro, que ninguém vai reportar — a aba precisa mostrar os três
    // estados (resolvido, enviado, silencioso) nas capturas do fim.
    await report(page, {
      message: "NetworkError ao carregar a lousa",
      route: "workspace/[id]",
    });

    // ---- 3. o relato da pessoa ----
    const patched = await page.evaluate(async (target) => {
      const response = await fetch(`/api/errors/${target}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report: "Cliquei em Recentes e a tela ficou branca.",
        }),
      });
      return response.status;
    }, code);

    const { rows: withReport } = await sql.query(
      "select user_report, user_reported_at from error_reports where code = $1",
      [code ?? ""]
    );
    check(
      "o PATCH grava o relato da pessoa",
      patched === 200 &&
        withReport[0]?.user_report?.startsWith("Cliquei") &&
        withReport[0]?.user_reported_at !== null,
      `${patched} · ${withReport[0]?.user_report ?? "(vazio)"}`
    );

    // Um segundo relato, para a aba mostrar "Enviado" ao lado de "Resolvido".
    await page.evaluate(async (target) => {
      await fetch(`/api/errors/${target}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: "A busca não retornou nada." }),
      });
    }, another.body?.code);

    // ---- 3.1. a triagem fecha o ciclo ----
    //
    // Roda o CLI de verdade (`bun run errors -- --resolver …`), e não uma
    // cópia da consulta dele: o que precisa ser verificado é que a ferramenta
    // que o suporte usa marca a linha **e** avisa a pessoa. Um aviso que só
    // existe no roteiro de teste não avisa ninguém.
    execFileSync(
      process.execPath,
      ["--env-file=.env", "scripts/errors.mjs", "--resolver", code],
      { stdio: "pipe" }
    );

    const { rows: resolved } = await sql.query(
      "select resolved_at from error_reports where code = $1",
      [code ?? ""]
    );
    const { rows: told } = await sql.query(
      `select title from notifications
        where user_id = $1 and metadata->>'kind' = 'error_resolved'`,
      [userId]
    );
    check(
      "resolver marca a linha e avisa a pessoa na Entrada",
      resolved[0]?.resolved_at !== null && told.length === 1,
      told[0]?.title ?? "sem notificação"
    );

    // ---- 4. o código dos outros não é reportável ----
    //
    // A linha da outra conta é semeada pelo banco: não existe caminho de
    // aplicação para criar erro em nome de terceiro, que é justamente o
    // ponto.
    const victimCode = "NX-2222-333";
    await sql.query(
      `insert into error_reports (code, user_id, route, kind, message, fingerprint)
       values ($1, $2, 'dashboard/page', 'client', 'erro da outra conta', $3)`,
      [victimCode, victimId, `qa-${Date.now()}`]
    );

    expectingFailure = true;
    const stolen = await page.evaluate(async (target) => {
      const response = await fetch(`/api/errors/${target}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: "invadido" }),
      });
      return response.status;
    }, victimCode);
    expectingFailure = false;

    const { rows: victimRow } = await sql.query(
      "select user_report from error_reports where code = $1",
      [victimCode]
    );
    check(
      "reportar o código de outra conta responde 404 e não escreve nada",
      stolen === 404 && victimRow[0]?.user_report === null,
      `${stolen} · ${victimRow[0]?.user_report ?? "null"}`
    );

    // ---- 5. o GRANT por coluna, pelo PostgREST ----
    //
    // Aqui não passa pela interface de propósito: o ataque que interessa é o
    // de quem pega a chave anônima (pública, por definição) e fala direto com
    // o PostgREST. A tela não tem nada a ver com isso.
    const asUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );
    const { error: signInError } = await asUser.auth.signInWithPassword({
      email: EMAIL,
      password: PASSWORD,
    });
    if (signInError) throw signInError;

    for (const column of ["message", "stack", "context", "fingerprint"]) {
      const { error: readError } = await asUser
        .from("error_reports")
        .select(column);
      check(
        `a chave anônima não lê error_reports.${column}`,
        Boolean(readError),
        readError?.message ?? "LEITURA PASSOU"
      );
    }

    // E uma checagem que recusa tudo não prova nada: as colunas liberadas
    // continuam legíveis, e só as do dono.
    const { data: safe, error: safeError } = await asUser
      .from("error_reports")
      .select("code, route, occurrences, user_report");
    check(
      "mas as colunas seguras continuam legíveis, e só as do dono",
      !safeError &&
        Array.isArray(safe) &&
        safe.length === 3 &&
        safe.every((row) => row.code !== victimCode),
      safeError?.message ?? `${safe?.length ?? 0} linha(s)`
    );

    const { error: writeError } = await asUser
      .from("error_reports")
      .update({ user_report: "reescrito pelo PostgREST" })
      .eq("code", code ?? "");
    const { rows: afterWrite } = await sql.query(
      "select user_report from error_reports where code = $1",
      [code ?? ""]
    );
    check(
      "e nem o próprio relato se reescreve por fora da rota",
      afterWrite[0]?.user_report?.startsWith("Cliquei"),
      writeError?.message ?? afterWrite[0]?.user_report
    );

    // ---- 6. as telas ----
    await page.goto(`${BASE}/dashboard/configuracoes`, {
      waitUntil: "networkidle",
    });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.click("button:has-text('Erros')");
    await page.waitForTimeout(500);

    const listed = await page.$$eval("li", (nodes) =>
      nodes.filter((node) => /NX-/.test(node.textContent ?? "")).length
    );
    check('a aba "Meus erros" lista os três relatórios', listed === 3, `${listed}`);
    await page.screenshot({ path: `${OUT}/01-meus-erros-claro.png` });

    await page.evaluate(() => {
      try {
        localStorage.setItem("nexo-theme", "dark");
      } catch {}
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/02-meus-erros-escuro.png` });

    console.log(`\n${results.join("\n")}`);
    const consoleProblems = [...new Set(problems.filter((p) => p.includes(": ")))];
    console.log(
      consoleProblems.length
        ? `\nErros de console:\n  ${consoleProblems.join("\n  ")}`
        : "\nNenhum erro de console."
    );
    console.log(`\nImagens em ${OUT}`);
    process.exitCode = problems.length > 0 ? 1 : 0;
  } finally {
    await browser?.close();
    for (const id of [userId, victimId]) {
      if (id && !KEEP) await admin.auth.admin.deleteUser(id);
    }
    if (KEEP && userId) {
      console.log("usuários de teste MANTIDOS:", EMAIL, "/", PASSWORD);
    } else if (userId) {
      console.log("usuários de teste apagados");
    }
    await sql.end();
  }
}

await main();
