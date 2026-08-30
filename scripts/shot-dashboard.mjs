/**
 * Captura do dashboard com sessão real.
 *
 *   bun run shots:dash            # vazio + populado, claro + escuro + mobile
 *   bun run shots:dash -- --keep  # não apaga o usuário de teste no fim
 *
 * O dashboard exige autenticação, então `scripts/shots.mjs` só alcançaria a
 * tela de login. Aqui a rotina cria um usuário de teste pelo service role,
 * entra pela interface (o caminho real, não um cookie forjado), semeia
 * conteúdo plausível, fotografa e **apaga o usuário no fim** — o `ON DELETE
 * CASCADE` de `auth.users` leva junto workspaces, notas, tags e jobs.
 *
 * Precisa de SUPABASE_SERVICE_ROLE_KEY e DATABASE_URL, então roda com
 * `node --env-file=.env`. A chave nunca sai daqui: é script de terminal, não
 * código da aplicação.
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

const OUT = ".impeccable/review/dash";
const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const EMAIL = `qa-dashboard-${Date.now()}@nexo.test`;
const PASSWORD = "SenhaDeTesteForte!2026";
const HIDE_DEV_BADGE = "nextjs-portal{display:none !important}";

function findChrome() {
  const found =
    (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)
      ? process.env.CHROME_PATH
      : null) ?? CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) throw new Error("Chrome não encontrado. Defina CHROME_PATH.");
  return found;
}

/** Notas de exemplo: [título, conteúdo, tipo, origem, idade]. */
const NOTES = [
  ["Reunião de alinhamento — squad Nexo", "Decidido: o classificador passa a escolher workspace. A fila de jobs entra depois.", "meeting", "ai", "12 minutes"],
  ["Contrato de prestação — Acme", "Vigência de 12 meses, renovação automática, aviso prévio de 30 dias. Cláusula 7 fala de confidencialidade.", "document", "ai", "3 hours"],
  ["Ideia: busca por proximidade de tag", "Se duas notas dividem 3+ tags, a Nexo podia sugerir ligação entre elas sem o usuário pedir.", "idea", "user", "1 day"],
  ["Comprar cabo HDMI 2.1", "Para o monitor novo. Verificar se aguenta 4K a 120Hz.", "task", "user", "2 days"],
  ["Áudio da reunião de terça", "Transcrição pendente. Tópicos: prazo do Stripe, quem escreve o FAQ, decisão sobre Redis.", "note", "ai", "4 days"],
];

const TAGS = [["reunião", "2"], ["contrato", "4"], ["pesquisa", "1"], ["ideia", "3"], ["agenda", "5"]];

/** Tarefas de exemplo: [tipo, estado, rótulo, detalhe, custo, idade]. */
const JOBS = [
  ["transcribe", "insufficient_credits", "Transcrição de call-cliente.m4a parada", "Faltaram créditos com 4 min de 41 restando. O arquivo está guardado — retomar continua de onde parou.", 12, "1 day"],
  ["organize", "insufficient_credits", "Organização de 23 capturas pendente", "A Nexo escolheria workspace e pastas para o lote inteiro.", 30, "2 days"],
  ["summarize", "running", "Resumindo áudio-reuniao-terca.m4a", "18 min de áudio · 62% transcrito", 0, "1 minute"],
  ["tag", "succeeded", "Marcou 5 notas com #reunião", "As notas de terça e quinta entraram no mesmo grupo.", 0, "3 hours"],
  ["classify", "succeeded", "Classificou contrato-acme.pdf", "Documento · 3 tags · 12 páginas lidas", 0, "3 hours"],
  ["extract", "failed", "Não conseguiu ler quadro-branco.png", "Imagem sem texto reconhecível. Você pode escrever a nota à mão.", 0, "5 days"],
];

async function seed(sql, userId) {
  const { rows } = await sql.query(
    "select id from workspaces where user_id = $1 order by is_default desc limit 1",
    [userId]
  );
  const workspaceId = rows[0]?.id ?? null;

  for (const [title, content, type, source, ago] of NOTES) {
    await sql.query(
      `insert into notes (user_id, workspace_id, title, content, type, source, created_at, updated_at)
       values ($1, $2, $3, $4, $5::note_type, $6::note_source, now() - $7::interval, now() - $7::interval)`,
      [userId, workspaceId, title, content, type, source, ago]
    );
  }

  for (const [name, color] of TAGS) {
    await sql.query(
      "insert into tags (user_id, name, color) values ($1, $2, $3) on conflict do nothing",
      [userId, name, color]
    );
  }

  await sql.query(
    `insert into note_tags (note_id, tag_id)
     select n.id, t.id from notes n cross join tags t
     where n.user_id = $1 and t.user_id = $1
       and ((n.type = 'meeting' and t.name in ('reunião','agenda'))
         or (n.type = 'document' and t.name = 'contrato')
         or (n.type = 'idea'    and t.name in ('ideia','pesquisa')))
     on conflict do nothing`,
    [userId]
  );

  for (const [kind, status, label, detail, cost, ago] of JOBS) {
    await sql.query(
      `insert into ai_jobs (user_id, workspace_id, kind, status, label, detail, credits_cost, created_at, finished_at)
       values ($1, $2, $3::ai_job_kind, $4::ai_job_status, $5, $6, $7, now() - $8::interval,
               case when $4 = 'running' then null else now() - $8::interval end)`,
      [userId, workspaceId, kind, status, label, detail, cost, ago]
    );
  }
}

async function shootThemes(page, name) {
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      try {
        localStorage.setItem("nexo-theme", value);
      } catch {}
      document.documentElement.setAttribute("data-theme", value);
    }, theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
  }
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
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 20_000 });
    await page.waitForTimeout(1800);
    await page.addStyleTag({ content: HIDE_DEV_BADGE });

    console.log("→ estados vazios");
    await shootThemes(page, "empty");

    await seed(sql, userId);
    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForTimeout(1200);

    console.log("→ estados populados");
    await shootThemes(page, "full");

    // ---- a barra de abas ----
    //
    // Fechar uma aba não pode tocar no banco: o que sai da tela é o atalho,
    // não o workspace. A conferência olha as duas pontas, porque uma
    // interface que apaga a linha errada por engano parece, na tela,
    // exatamente igual à que faz o certo.
    function check(label, ok, detail = "") {
      console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
      if (!ok) problems.push(label);
    }

    const tabLabels = () =>
      page.$$eval("nav[aria-label='Abas abertas'] > span", (nodes) =>
        nodes.map((node) => node.textContent.replace(/Fechar a aba.*/, "").trim())
      );

    console.log("→ abas");
    // Direto no banco: pela rota o plano gratuito para no primeiro workspace,
    // e o que está sendo conferido aqui é a barra, não o limite.
    await sql.query("insert into workspaces (user_id, name) values ($1, $2)", [
      userId,
      "Estudos",
    ]);
    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForTimeout(1000);

    let tabs = await tabLabels();
    check(
      "a barra abre com Início e os workspaces",
      tabs.length === 3,
      tabs.join(" | ")
    );

    await page.click(
      'nav[aria-label="Abas abertas"] button[title^="Fechar a aba Estudos"]'
    );
    await page.waitForTimeout(300);
    tabs = await tabLabels();
    check(
      "fechar tira só aquela aba",
      tabs.length === 2 && !tabs.includes("Estudos"),
      tabs.join(" | ")
    );

    const rail = await page.$$eval(
      "aside[aria-label='Navegação principal'] a[href^='/workspace/']",
      (nodes) => nodes.length
    );
    const { rows: alive } = await sql.query(
      "select count(*)::int as total from workspaces where user_id = $1",
      [userId]
    );
    check(
      "fechar não exclui: segue no trilho e no banco",
      rail === 2 && alive[0].total === 2,
      `${rail} no trilho, ${alive[0].total} no banco`
    );

    await page.click(
      'nav[aria-label="Abas abertas"] button[title^="Fechar a aba Início"]'
    );
    await page.waitForTimeout(300);
    tabs = await tabLabels();
    check("a aba do Início também fecha", !tabs.includes("Início"), tabs.join(" | "));
    check(
      "o atalho do Início aparece no lugar dela",
      Boolean(await page.$('button[title="Abrir a aba Início"]'))
    );

    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForTimeout(1000);
    tabs = await tabLabels();
    check("a escolha sobrevive ao recarregamento", tabs.length === 1, tabs.join(" | "));
    await page.screenshot({ path: `${OUT}/abas-fechadas.png` });

    await page.click('button[title="Abrir a aba Início"]');
    await page.waitForTimeout(300);
    tabs = await tabLabels();
    check("o atalho reabre o Início, e na frente", tabs[0] === "Início", tabs.join(" | "));

    // ---- o rascunho: o único conteúdo que não vai sozinho para o servidor ----
    //
    // A conferência tem de olhar o banco, não a tela: um rascunho que
    // aparece certo na interface e mesmo assim foi gravado teria destruído a
    // única razão de ele existir.
    console.log("→ rascunho");
    await page.click("button:has-text('Escrever um rascunho')");
    // O editor entra por `next/dynamic` — espera o contenteditable montar.
    await page.waitForSelector("#draft-content", { timeout: 10_000 });
    await page.fill("#draft-title", "Ideia da madrugada");
    await page.click("#draft-content");
    await page.keyboard.type("Ligar o classificador ao workspace.");
    await page.waitForTimeout(400);

    const { rows: unsaved } = await sql.query(
      "select count(*)::int as total from notes where user_id = $1 and title = $2",
      [userId, "Ideia da madrugada"]
    );
    check("o rascunho não vai sozinho para o banco", unsaved[0].total === 0);

    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector("#draft-content", { timeout: 10_000 });
    await page.waitForTimeout(1200);
    check(
      "o rascunho sobrevive ao recarregamento (está no navegador)",
      (await page.inputValue("#draft-title")) === "Ideia da madrugada" &&
        (await page.textContent("#draft-content"))?.includes(
          "Ligar o classificador ao workspace."
        )
    );
    await page.screenshot({ path: `${OUT}/rascunho.png` });

    await page.click("button:has-text('Guardar na conta')");
    await page.waitForTimeout(2000);
    const { rows: saved } = await sql.query(
      "select content, workspace_id from notes where user_id = $1 and title = $2",
      [userId, "Ideia da madrugada"]
    );
    check(
      "guardar na conta cria a nota de verdade, num workspace",
      saved.length === 1 && saved[0].workspace_id !== null,
      saved[0]?.content ?? "sumiu"
    );
    check(
      "o rascunho some do navegador depois de guardado",
      await page.evaluate(() => localStorage.getItem("nexo-draft") === null)
    );

    // ---- renomear pelo trilho ----
    console.log("→ renomear");
    await page.click(
      "aside[aria-label='Navegação principal'] a[href^='/workspace/']",
      { button: "right" }
    );
    await page.waitForSelector("[role='menu']", { timeout: 5000 });
    await page.click("[role='menu'] [role='menuitem']:has-text('Renomear')");
    await page.waitForTimeout(400);
    await page.fill("input[aria-label^='Novo nome de']", "Trabalho");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);

    const { rows: renamed } = await sql.query(
      "select name from workspaces where user_id = $1 order by created_at",
      [userId]
    );
    check(
      "renomear pelo trilho grava no banco",
      renamed.some((row) => row.name === "Trabalho"),
      renamed.map((row) => row.name).join(", ")
    );
    const { rows: trail } = await sql.query(
      "select count(*)::int as total from audit_logs where user_id = $1 and table_name = 'workspaces'",
      [userId]
    );
    check("o renomeio deixa rastro no audit log", trail[0].total >= 1);

    // Trilho recolhido.
    await page.click('button[aria-expanded="true"]');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/collapsed-dark.png` });

    // Busca com resultados.
    await page.evaluate(() => {
      try {
        localStorage.setItem("nexo-theme", "light");
      } catch {}
      document.documentElement.setAttribute("data-theme", "light");
    });
    await page.click('input[type="search"]');
    await page.fill('input[type="search"]', "reunião");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/search-light.png` });

    // Mobile: fechado e com a gaveta aberta.
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      locale: "pt-BR",
      storageState: await context.storageState(),
    });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await mobilePage.addStyleTag({ content: HIDE_DEV_BADGE });
    await mobilePage.waitForTimeout(1500);
    await mobilePage.screenshot({ path: `${OUT}/mobile-light.png`, fullPage: true });

    await mobilePage.click('button[aria-label*="navegação"]');
    await mobilePage.waitForTimeout(700);
    await mobilePage.screenshot({ path: `${OUT}/mobile-drawer.png` });

    console.log(
      problems.length ? `\nProblemas:\n  ${[...new Set(problems)].join("\n  ")}` : "\nNenhum erro de console."
    );
    console.log(`\nImagens em ${OUT}`);
  } finally {
    await browser?.close();
    if (userId && !KEEP) {
      await admin.auth.admin.deleteUser(userId);
      console.log("usuário de teste apagado:", userId);
    } else if (userId) {
      console.log("usuário de teste MANTIDO:", EMAIL, "/", PASSWORD);
    }
    await sql.end();
  }
}

await main();
