/**
 * Teste de ponta a ponta da Entrada, com sessão real.
 *
 *   bun run shots:entrada            # exercita e fotografa
 *   bun run shots:entrada -- --keep  # não apaga o usuário de teste no fim
 *
 * O que ele prova, e que uma captura de tela sozinha não provaria:
 *
 *   - a trigger `handle_new_user` cria a notificação de boas-vindas: toda
 *     conta nova nasce com a Entrada ocupada;
 *   - a trigger de `ai_jobs` (0031) avisa o fim das tarefas — e cala nos dois
 *     casos em que deve calar (leitura de nota que deu certo, classificação
 *     sem chave de IA);
 *   - o número sobre o ícone da Entrada sobe sozinho, pelo Realtime;
 *   - "Ver em Tarefas" abre a tela cheia no detalhe daquela tarefa, marca o
 *     aviso como lido e tira o `?tarefa=` da URL;
 *   - apagar a tarefa falha leva o aviso dela junto;
 *   - marcar como lida e desmarcar, uma a uma e em lote, vão para o
 *     Postgres, não só para a tela; apagar em lote também;
 *   - "marcar todas" zera o contador de não lidas;
 *   - **e o cliente não escreve na tabela.** Esta última parte é a razão de
 *     este roteiro existir: a interface fica idêntica se a RLS estiver
 *     aberta, e a diferença só aparece para quem chegar com a chave anônima
 *     na mão. Ver 0011.
 *
 * Precisa de SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY e
 * DATABASE_URL: roda com `node --env-file=.env`.
 */
import { createClient } from "@supabase/supabase-js";
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

const OUT = ".impeccable/review/entrada";
const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const EMAIL = `qa-inbox-${Date.now()}@nexo.test`;
const PASSWORD = "SenhaDeTesteForte!2026";
const HIDE_DEV_BADGE = "nextjs-portal{display:none !important}";

const ITEM = "li button";

function findChrome() {
  const found =
    (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)
      ? process.env.CHROME_PATH
      : null) ?? CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) throw new Error("Chrome não encontrado. Defina CHROME_PATH.");
  return found;
}

async function countUnread(sql, userId) {
  const { rows } = await sql.query(
    "select count(*)::int as total from notifications where user_id = $1 and read = false",
    [userId]
  );
  return rows[0].total;
}

/** Espera o banco em vez de dormir um tempo fixo. */
async function waitForUnread(sql, userId, expected, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let total = await countUnread(sql, userId);
  while (total !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    total = await countUnread(sql, userId);
  }
  return total;
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

    // Uma segunda conta, só para ser o alvo da tentativa de invasão abaixo.
    const { data: other, error: otherError } =
      await admin.auth.admin.createUser({
        email: `qa-inbox-alvo-${Date.now()}@nexo.test`,
        password: PASSWORD,
        email_confirm: true,
      });
    if (otherError) throw otherError;
    victimId = other.user.id;

    // ---- a trigger de boas-vindas ----
    const { rows: welcome } = await sql.query(
      "select type, title, read from notifications where user_id = $1",
      [userId]
    );
    check(
      "a conta nova nasce com a notificação de boas-vindas",
      welcome.length === 1 &&
        welcome[0].type === "system" &&
        welcome[0].read === false,
      welcome.map((row) => `${row.type}: ${row.title}`).join(", ") || "nenhuma"
    );

    // ---- a trigger de fim de tarefa (0031) ----
    //
    // Direto no banco, como o worker faz: `ai_jobs` não aceita escrita do
    // cliente. Quatro tarefas, dois avisos — as outras duas são os silêncios.
    async function insertJob(kind, status, label, extra = {}) {
      const { rows } = await sql.query(
        `insert into ai_jobs (user_id, kind, status, label, detail, error, error_code)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [userId, kind, status, label, extra.detail ?? null, extra.error ?? null, extra.errorCode ?? null]
      );
      return rows[0].id;
    }
    await insertJob("summarize", "failed", "Ler “Teste QA”", {
      detail: "Não conseguiu depois de 3 tentativas.",
      error: "timeout",
    });
    await insertJob("transcribe", "succeeded", "Transcreveu reuniao.mp3", {
      detail: "12 min de áudio",
    });
    await insertJob("summarize", "succeeded", "Leu “Outra nota”");
    await insertJob("classify", "failed", "Não conseguiu classificar a.pdf");

    const { rows: jobNotices } = await sql.query(
      `select title, metadata->>'href' as href from notifications
        where user_id = $1 and metadata->>'kind' = 'job' order by title`,
      [userId]
    );
    check(
      "a falha e a conclusão viram aviso; a leitura certa e a classificação sem chave, não",
      jobNotices.length === 2 &&
        jobNotices.some((row) => row.title === "Leitura de nota falhou") &&
        jobNotices.some((row) => row.title === "Transcrição concluída") &&
        jobNotices.every((row) => row.href?.startsWith("/dashboard?tarefa=")),
      jobNotices.map((row) => row.title).join(", ") || "nenhum"
    );

    browser = await chromium.launch({ executablePath: findChrome() });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "pt-BR",
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 30000 });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });

    // Esperar o trilho, e não um tempo fixo: o `loading.tsx` do dashboard
    // aparece primeiro, e um `waitForTimeout` calibrado numa máquina quente
    // fotografa a tela de carregamento na fria.
    //
    // O badge do trilho é a única coisa do dashboard que toca `notifications`
    // — e foi ele que derrubava a página inteira enquanto a tabela não
    // existia, porque o `await` dele está no `Promise.all` que a página espera.
    await page.waitForSelector("a:has-text('Entrada')", { timeout: 30000 });
    const entrada = page.locator("nav a:has-text('Entrada')");
    const badge = await entrada.textContent();
    check(
      "o dashboard carrega e o ícone da Entrada mostra as não lidas",
      (badge ?? "").includes("3 não lidas"),
      (badge ?? "").replace(/\s+/g, " ").trim()
    );

    // O número sobe sem recarregar: uma tarefa termina com o dashboard aberto.
    const organizeId = await insertJob("organize", "failed", "Organizando as notas em pastas", {
      detail: "As pastas ficaram como estavam.",
      error: "timeout",
    });
    const live = await entrada
      .filter({ hasText: "4 não lidas" })
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    check("o número sobre o ícone sobe sozinho, pelo Realtime", live);

    // Recolhido, o trilho só tem o ícone — e o número continua lá.
    await page.keyboard.press("Control+Shift+B");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/01-dashboard-com-badge-light.png` });
    await page.keyboard.press("Control+Shift+B");

    await page.goto(`${BASE}/dashboard/entrada`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(ITEM, { timeout: 20000 });
    await page.waitForTimeout(600);

    const listed = await page.$$eval(ITEM, (nodes) => nodes.length);
    check("a Entrada lista as quatro notificações", listed === 4, `${listed}`);
    await page.screenshot({ path: `${OUT}/02-entrada-light.png` });

    // ---- marcar como lida ----
    await page.click(`${ITEM} >> nth=0`);
    check(
      "tocar numa notificação a marca como lida no banco",
      (await waitForUnread(sql, userId, 3)) === 3
    );

    await page.click(`${ITEM} >> nth=0`);
    check(
      "e tocar de novo a devolve para não lida",
      (await waitForUnread(sql, userId, 4)) === 4
    );

    // ---- da Entrada para Tarefas ----
    await page
      .locator("li", { hasText: "Leitura de nota falhou" })
      .locator("a:has-text('Ver em Tarefas')")
      .click();
    const detailOpened = await page
      .locator("dialog[open]", { hasText: "Ler “Teste QA”" })
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(600);
    check(
      "\"Ver em Tarefas\" abre a tela cheia no detalhe da tarefa",
      detailOpened,
      page.url()
    );
    check(
      "e tira o ?tarefa= da URL",
      new URL(page.url()).search === "",
      page.url()
    );
    check("e marca o aviso como lido", (await waitForUnread(sql, userId, 3)) === 3);
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.screenshot({ path: `${OUT}/03-tarefas-pela-entrada-light.png` });
    await page.keyboard.press("Escape");

    // Apagar a tarefa falha leva o aviso junto — ele apontaria para o nada.
    const jobDelete = await page.evaluate(async (id) => {
      const response = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      return response.status;
    }, organizeId);
    const { rows: orphan } = await sql.query(
      "select count(*)::int as total from notifications where user_id = $1 and metadata->>'jobId' = $2",
      [userId, organizeId]
    );
    check(
      "apagar a tarefa falha apaga o aviso dela",
      jobDelete === 200 && orphan[0].total === 0,
      `DELETE ${jobDelete}, ${orphan[0].total} aviso(s)`
    );

    // ---- seleção em lote ----
    await page.goto(`${BASE}/dashboard/entrada`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(ITEM, { timeout: 20000 });
    await page.click("button:has-text('Selecionar')");
    await page.click("button:has-text('Selecionar todas')");
    await page.click("button:has-text('Marcar como lida')");
    check(
      "selecionar todas e marcar como lida vai para o banco",
      (await waitForUnread(sql, userId, 0)) === 0
    );

    await page.click("li label >> nth=0");
    await page.click("button:has-text('Não lida')");
    check(
      "e marcar uma como não lida também",
      (await waitForUnread(sql, userId, 1)) === 1
    );

    await page.click("li label >> nth=0");
    await page.click("li label >> nth=1");
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/04-selecao-light.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/04-selecao-mobile-light.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click("button:has-text('Apagar')");
    await page.click("dialog[open] button:has-text('Apagar notificações')");
    await page.locator("dialog[open]").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    const { rows: remaining } = await sql.query(
      "select count(*)::int as total from notifications where user_id = $1",
      [userId]
    );
    check(
      "apagar as selecionadas tira as duas do banco",
      remaining[0].total === 1,
      `${remaining[0].total} restante(s)`
    );
    await page.click("button:has-text('Concluir')");

    // ---- marcar todas ----
    await sql.query(
      "update notifications set read = false, read_at = null where user_id = $1",
      [userId]
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.click("button:has-text('Marcar todas como lidas')");
    check(
      "\"marcar todas\" zera o contador",
      (await waitForUnread(sql, userId, 0)) === 0
    );
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.screenshot({ path: `${OUT}/05-todas-lidas-light.png` });

    // ---- o cliente não escreve na tabela ----
    //
    // Aqui não passa pela interface de propósito: o ataque que interessa é o
    // de quem pega a chave anônima (que é pública, por definição) e fala
    // direto com o PostgREST. A interface não tem nada a ver com isso.
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

    const { data: readable } = await asUser
      .from("notifications")
      .select("id, user_id");
    check(
      "a RLS deixa a pessoa ler só as próprias",
      Array.isArray(readable) &&
        readable.length === 1 &&
        readable.every((row) => row.user_id === userId),
      `${readable?.length ?? 0} linha(s)`
    );

    const { error: insertError } = await asUser
      .from("notifications")
      .insert({ user_id: userId, type: "system", title: "Forjada" });
    check(
      "e não deixa criar notificação nenhuma",
      Boolean(insertError),
      insertError?.message ?? "INSERT PASSOU"
    );

    const { error: deleteError, count: deleted } = await asUser
      .from("notifications")
      .delete({ count: "exact" })
      .eq("id", readable?.[0]?.id ?? "00000000-0000-0000-0000-000000000000");
    // Apagar existe, mas pela rota (`DELETE /api/notifications`), que filtra
    // pelo token. O PostgREST continua sem `DELETE` (0011, 0031).
    check(
      "nem apagar as próprias pelo PostgREST",
      Boolean(deleteError) || deleted === 0,
      deleteError?.message ?? `${deleted} apagada(s)`
    );

    // O ataque que o `WITH CHECK` de 0011 fecha: mover a própria notificação
    // para a Entrada de outra pessoa. Sem ele, `USING` aprova (a linha de
    // origem é minha) e ninguém pergunta sobre a de destino.
    const { error: moveError } = await asUser
      .from("notifications")
      .update({ user_id: victimId })
      .eq("id", readable?.[0]?.id ?? "");
    const { rows: injected } = await sql.query(
      "select count(*)::int as total from notifications where user_id = $1",
      [victimId]
    );
    check(
      "e não deixa empurrar uma notificação para outra conta",
      injected[0].total === 1,
      moveError
        ? moveError.message
        : `a conta alvo ficou com ${injected[0].total} (esperado 1, a de boas-vindas)`
    );

    // Reescrever o texto de uma notificação de sistema: o GRANT por coluna é
    // o que recusa, mesmo a linha sendo dela.
    const { error: rewriteError } = await asUser
      .from("notifications")
      .update({ title: "A Nexo pede sua senha" })
      .eq("id", readable?.[0]?.id ?? "");
    const { rows: titles } = await sql.query(
      "select count(*)::int as total from notifications where user_id = $1 and title = 'A Nexo pede sua senha'",
      [userId]
    );
    check(
      "e não deixa reescrever o texto de uma notificação de sistema",
      titles[0].total === 0,
      rewriteError?.message ?? "título reescrito"
    );

    // Marcar como lida, essa sim, o cliente pode: é para isso que o GRANT de
    // duas colunas existe, e uma checagem que recusa tudo não prova nada.
    const { error: readError } = await asUser
      .from("notifications")
      .update({ read: false })
      .eq("id", readable?.[0]?.id ?? "");
    check(
      "mas marcar como lida/não lida continua funcionando",
      !readError && (await waitForUnread(sql, userId, 1)) === 1,
      readError?.message ?? ""
    );

    await page.evaluate(() => {
      try {
        localStorage.setItem("nexo-theme", "dark");
      } catch {}
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/06-entrada-escuro.png` });

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
      console.log("usuário de teste MANTIDO:", EMAIL, "/", PASSWORD);
    } else if (userId) {
      console.log("usuários de teste apagados");
    }
    await sql.end();
  }
}

await main();
