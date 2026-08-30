/**
 * Os tetos do plano Gratuito, exercitados pela interface.
 *
 *   bun run shots:planos            # exercita e fotografa
 *   bun run shots:planos -- --keep  # não apaga o usuário de teste no fim
 *
 * Mesmo contrato dos outros roteiros: cria um usuário pelo service role, entra
 * pela interface, e apaga o usuário no fim (o `ON DELETE CASCADE` de
 * `auth.users` leva tudo junto).
 *
 * O que é conferido, e não só fotografado:
 *   - a rota recusa a captura 51 com 409 **e** a marca `upgrade: true`;
 *   - o rascunho mostra o convite ao Pro, e **não** a cara de erro vermelha;
 *   - o rascunho continua no navegador depois da recusa (nada se perde);
 *   - o segundo workspace é recusado, com o aviso de rodapé e o link;
 *   - o aviso do plano **não some sozinho** (o dos outros casos some);
 *   - nada entrou no banco: 50 notas e 1 workspace, como antes da tentativa.
 *
 * A distinção que dá sentido ao roteiro: um 409 de teto tem que sair diferente
 * de um 409 de "já está aberto". Se os dois virarem a mesma mensagem
 * vermelha, a pessoa que bateu no teto vai tentar de novo até desistir.
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

const OUT = ".impeccable/review/planos";
const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const EMAIL = `qa-planos-${Date.now()}@nexo.test`;
const PASSWORD = "SenhaDeTesteForte!2026";
const HIDE_DEV_BADGE = "nextjs-portal{display:none !important}";

/** Tem que bater com `PLAN_LIMITS.free.capturesPerMonth` em lib/plans.ts. */
const FREE_CAPTURES = 50;

function findChrome() {
  const found =
    (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)
      ? process.env.CHROME_PATH
      : null) ?? CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) throw new Error("Chrome não encontrado. Defina CHROME_PATH.");
  return found;
}

function check(problems, label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) problems.push(label);
}

/**
 * Enche a cota do mês.
 *
 * Notas sem anexo, criadas agora: é exatamente o que `countMonthlyCaptures`
 * conta do lado das notas. `created_at` fica em `now()` de propósito — uma
 * nota do mês passado não contaria, e o roteiro estaria testando o nada.
 */
async function fillCaptureQuota(sql, userId) {
  const { rows } = await sql.query(
    "select id from workspaces where user_id = $1 order by is_default desc limit 1",
    [userId]
  );
  const workspaceId = rows[0]?.id ?? null;

  await sql.query(
    `insert into notes (user_id, workspace_id, title, content, type, source)
     select $1, $2, 'Captura de teste ' || g, 'conteúdo', 'note'::note_type, 'user'::note_source
     from generate_series(1, $3) g`,
    [userId, workspaceId, FREE_CAPTURES]
  );
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
  let browser = null;
  const problems = [];

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

    // Nasce no Gratuito? É a premissa de tudo o que vem abaixo.
    const { rows: planRows } = await sql.query(
      "select plan, subscription_status from profiles where id = $1",
      [userId]
    );
    check(
      problems,
      "conta nova nasce no plano Gratuito",
      planRows[0]?.plan === "free",
      `plan=${planRows[0]?.plan}`
    );

    await fillCaptureQuota(sql, userId);

    browser = await chromium.launch({ executablePath: findChrome() });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "pt-BR",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 20_000 });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    // A URL trocar não é a página estar de pé: `/dashboard` é dinâmico e
    // aparece primeiro pelo `loading.tsx`. Sem esta espera, o "n" mais abaixo
    // era disparado antes de o rascunho montar o ouvinte dele — e o roteiro
    // ficava esperando por um campo que ninguém tinha aberto.
    await page.waitForSelector("a:has-text('Entrada')", { timeout: 30_000 });

    /* --- A rota, antes da interface ---------------------------------- */

    console.log("→ POST /api/notes com a cota cheia");
    const apiResult = await page.evaluate(async () => {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Captura 51", content: "não deve entrar" }),
      });
      return { status: response.status, body: await response.json() };
    });

    check(
      problems,
      "a captura 51 é recusada com 409",
      apiResult.status === 409,
      `status=${apiResult.status}`
    );
    check(
      problems,
      "a recusa vem marcada como teto de plano (upgrade: true)",
      apiResult.body?.upgrade === true,
      JSON.stringify(apiResult.body)
    );

    /* --- O rascunho -------------------------------------------------- */

    console.log("→ rascunho no teto");
    await page.keyboard.press("n");
    await page.waitForSelector("#draft-content", { timeout: 10_000 });
    await page.fill("#draft-title", "Ideia que não vai caber");
    await page.click("#draft-content");
    await page.keyboard.type("Este texto não pode se perder.");
    await page.click("button:has-text('Guardar na conta')");
    await page.waitForSelector("section[aria-label='Rascunho'] a[href='/#planos']", {
      timeout: 10_000,
    });

    const draftNoticeIsError = await page.$eval(
      "section[aria-label='Rascunho'] p[role='status']",
      (node) => node.className.includes("text-error")
    );
    check(
      problems,
      "o teto do rascunho não é pintado de erro",
      draftNoticeIsError === false,
      draftNoticeIsError ? "veio com text-error" : "cor de informação"
    );

    const draftKept = (await page.textContent("#draft-content")) ?? "";
    check(
      problems,
      "o rascunho continua no navegador depois da recusa",
      draftKept.includes("Este texto não pode se perder."),
      `"${draftKept}"`
    );
    await page.screenshot({ path: `${OUT}/rascunho-no-teto.png` });

    /* --- O segundo workspace ----------------------------------------- */

    console.log("→ segundo workspace no Gratuito");
    await page.click("button[title='Novo workspace']");
    await page.fill("input[aria-label='Nome do novo workspace']", "Segundo");
    await page.keyboard.press("Enter");

    await page.waitForSelector("div[role='status'] a[href='/#planos']", {
      timeout: 10_000,
    });
    const noticeText = await page.$eval("div[role='status']", (node) =>
      node.textContent.trim()
    );
    check(
      problems,
      "o aviso explica o teto de workspace do Gratuito",
      noticeText.includes("Gratuito") && noticeText.includes("Pro"),
      noticeText
    );

    // O aviso comum some em 3,6s; o do plano tem que continuar de pé.
    await page.waitForTimeout(5000);
    const stillThere = await page.$("div[role='status'] a[href='/#planos']");
    check(
      problems,
      "o aviso do plano não some sozinho",
      stillThere !== null,
      stillThere ? "continua de pé aos 5s" : "sumiu antes dos 5s"
    );
    await page.screenshot({ path: `${OUT}/workspace-no-teto.png` });

    /* --- O banco ----------------------------------------------------- */

    console.log("→ conferindo o banco");
    const { rows: counted } = await sql.query(
      `select (select count(*)::int from notes where user_id = $1) as notes,
              (select count(*)::int from workspaces where user_id = $1) as workspaces`,
      [userId]
    );
    check(
      problems,
      "nenhuma captura extra entrou",
      counted[0].notes === FREE_CAPTURES,
      `${counted[0].notes} notas (esperado ${FREE_CAPTURES})`
    );
    check(
      problems,
      "nenhum workspace extra entrou",
      counted[0].workspaces === 1,
      `${counted[0].workspaces} workspace(s)`
    );

    /* --- A aba Uso --------------------------------------------------- */

    console.log("→ aba Uso das configurações");
    await page.goto(`${BASE}/dashboard/configuracoes`, {
      waitUntil: "networkidle",
    });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForTimeout(600);

    const meterText = await page.$eval("main", (node) => node.textContent);
    check(
      problems,
      "a aba Uso mostra a cota estourada",
      meterText.includes(`${FREE_CAPTURES}`) && meterText.includes("de 50"),
      meterText.includes("de 50") ? "50 de 50" : "não achou o medidor"
    );
    await page.screenshot({ path: `${OUT}/uso-no-teto.png`, fullPage: true });
  } finally {
    if (browser) await browser.close();
    if (userId && !KEEP) {
      await admin.auth.admin.deleteUser(userId);
      console.log("usuário de teste removido");
    } else if (userId) {
      console.log("usuário mantido:", EMAIL, PASSWORD);
    }
    await sql.end();
  }

  console.log(`\nImagens em ${OUT}`);
  if (problems.length > 0) {
    console.error(`\n${problems.length} problema(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log("\nTudo certo.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
