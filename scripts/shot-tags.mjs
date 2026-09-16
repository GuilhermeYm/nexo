/**
 * Captura da página de Tags com sessão real.
 *
 *   bun run shots:tags            # exercita a página e fotografa
 *   bun run shots:tags -- --keep  # não apaga o usuário de teste no fim
 *
 * Mesmo contrato de `shot-dashboard.mjs`: cria um usuário pelo service role,
 * entra pela interface, semeia notas e tags plausíveis, e apaga o usuário no
 * fim — o `ON DELETE CASCADE` de `auth.users` leva tudo junto.
 *
 * O que é conferido, não só fotografado:
 *   - as tags recentes aparecem com a contagem certa de notas;
 *   - abrir uma tag lista as notas dela (via GET /api/tags/[id]/notes);
 *   - a busca encontra tag pelo nome (sem acento) e nota pelo conteúdo;
 *   - na janela da lousa, o painel do chip renomeia e recolore a tag, o
 *     renomeio vai para a trilha de auditoria e a cor não, e as duas coisas
 *     sobrevivem ao recarregamento.
 *
 * A última parte acontece na lousa e mesmo assim mora aqui: o que ela exercita
 * é a tag, que é da conta e não daquela nota.
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

const OUT = ".impeccable/review/tags";
const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const EMAIL = `qa-tags-${Date.now()}@nexo.test`;
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
  ["Áudio da reunião de terça", "Transcrição pendente. Tópicos: prazo do Stripe, quem escreve o FAQ.", "note", "ai", "4 days"],
];

const TAGS = [["reunião", "2"], ["contrato", "4"], ["pesquisa", "1"], ["ideia", "3"], ["agenda", "5"]];

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
}

/**
 * Espera o banco chegar no estado esperado, em vez de dormir um tempo fixo.
 *
 * A rota leva de 300ms a 2s conforme o Turbopack já a tenha compilado ou não,
 * e um `waitForTimeout` calibrado numa máquina quente falha na fria.
 */
async function waitForTag(sql, userId, name, color, timeout = 20000) {
  const deadline = Date.now() + timeout;
  const read = async () =>
    (
      await sql.query(
        "select name, color from tags where user_id = $1 and name = $2",
        [userId, name]
      )
    ).rows;

  let rows = await read();
  while (rows[0]?.color !== color && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    rows = await read();
  }
  return rows;
}

function check(problems, label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) problems.push(label);
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

    await seed(sql, userId);

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
    await page.waitForURL("**/dashboard", { timeout: 20_000 });

    console.log("→ página de tags");
    await page.goto(`${BASE}/dashboard/tags`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForTimeout(1200);

    const tagCards = await page.$$eval(
      "section[aria-labelledby='recent-tags-heading'] button",
      (nodes) => nodes.map((node) => node.textContent.trim())
    );
    check(
      problems,
      "as cinco tags aparecem nas recentes",
      tagCards.length === 5,
      tagCards.join(" | ")
    );
    check(
      problems,
      "a contagem de notas aparece no cartão",
      tagCards.some((text) => text.includes("#reunião") && text.includes("1 nota")),
      tagCards.find((text) => text.includes("#reunião")) ?? "sem #reunião"
    );
    check(
      problems,
      "a ordem é pelo uso mais recente",
      /^#(reunião|agenda)/.test(tagCards[0] ?? ""),
      `primeira: ${tagCards[0] ?? "nenhuma"}`
    );
    await page.screenshot({ path: `${OUT}/recent-light.png` });

    console.log("→ abrir uma tag");
    // Sai da busca se houver, para garantir que o clique atinja a tela inicial.
    await page.fill('input[aria-label="Buscar notas e tags"]', "");
    await page.waitForTimeout(400);
    await page.click("button:has-text('#pesquisa')");
    await page.waitForFunction(
      () => {
        const row = document.querySelector(
          "section[aria-labelledby='selected-tag-heading'] li button"
        );
        return row && row.textContent?.includes("Ideia: busca");
      },
      { timeout: 10_000 }
    );
    await page.waitForTimeout(200);
    const selectedNotes = await page.$$eval(
      "section[aria-labelledby='selected-tag-heading'] li button",
      (nodes) => nodes.map((node) => node.textContent.trim())
    );
    check(
      problems,
      "a tag aberta lista a nota dela",
      selectedNotes.some((text) => text.includes("Ideia: busca por proximidade")),
      selectedNotes.join(" | ") || "lista vazia"
    );
    await page.screenshot({ path: `${OUT}/selected-light.png` });

    console.log("→ busca");
    await page.fill('input[aria-label="Buscar notas e tags"]', "reuniao");
    await page.waitForTimeout(2500);
    const matchedTag = await page.$(
      "section[aria-labelledby='matched-tags-heading'] button:has-text('#reunião')"
    );
    check(
      problems,
      "a busca sem acento encontra a tag com acento",
      Boolean(matchedTag)
    );

    // Agora procurando por conteúdo de nota, com acento, no servidor.
    await page.fill('input[aria-label="Buscar notas e tags"]', "reunião");
    await page.waitForFunction(
      () => {
        const row = document.querySelector(
          "section[aria-labelledby='matched-notes-heading'] li button"
        );
        return row && row.textContent?.includes("Reunião de alinhamento");
      },
      { timeout: 10_000 }
    );
    const matchedNotes = await page.$$eval(
      "section[aria-labelledby='matched-notes-heading'] li button",
      (nodes) => nodes.map((node) => node.textContent.trim())
    );
    check(
      problems,
      "a busca encontra nota pelo conteúdo",
      matchedNotes.some((text) => text.includes("Reunião de alinhamento")),
      matchedNotes.join(" | ") || "lista vazia"
    );
    await page.screenshot({ path: `${OUT}/search-light.png` });

    // ---- modo grafo ----
    //
    // O grafo é a outra face da página: zoom com controles, highlight de
    // vizinhança em hover e troca de cor no clique da tag. Aqui se confere o
    // que dá para conferir sem mirar nó em canvas: renderização, os botões de
    // zoom de fato mudando o zoom, e as duas capturas (claro/escuro) para o
    // revisor humano — o tema escuro só funciona no canvas porque as cores
    // são resolvidas via estilo computado com observer em `data-theme`.
    console.log("→ modo grafo");
    await page.fill('input[aria-label="Buscar notas e tags"]', "");
    await page.click("button:has-text('Ver como grafo')");
    await page.waitForSelector("canvas", { timeout: 20_000 });
    await page.waitForTimeout(2500); // a simulação assenta

    const canvasSize = await page.$eval("canvas", (el) => ({
      w: el.width,
      h: el.height,
    }));
    check(
      problems,
      "o canvas do grafo renderiza",
      canvasSize.w > 0 && canvasSize.h > 0,
      `${canvasSize.w}x${canvasSize.h}`
    );

    const zoomLevel = () =>
      page
        .locator('div:has(> button[aria-label="Aproximar"]) > span')
        .textContent()
        .then((text) => parseInt(text ?? "0", 10));
    const zoomBefore = await zoomLevel();
    await page.click('button[aria-label="Aproximar"]');
    await page.waitForTimeout(600);
    const zoomAfter = await zoomLevel();
    check(
      problems,
      "o botão de zoom aproxima de verdade",
      zoomAfter > zoomBefore,
      `${zoomBefore}% → ${zoomAfter}%`
    );

    await page.click('button[aria-label="Ajustar ao conteúdo"]');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/graph-light.png` });

    await page.evaluate(() => {
      try {
        localStorage.setItem("nexo-theme", "dark");
      } catch {}
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/graph-dark.png` });
    await page.evaluate(() => {
      try {
        localStorage.setItem("nexo-theme", "light");
      } catch {}
      document.documentElement.setAttribute("data-theme", "light");
    });
    await page.click("button:has-text('Voltar para lista')");
    await page.waitForTimeout(400);

    // ---- editar a tag na janela da lousa ----
    //
    // A tag é da conta, não da nota: o painel que abre no chip renomeia e
    // recolore em todas as notas marcadas. Aqui é onde se prova que o gesto
    // chega ao Postgres — a interface fica idêntica se a rota falhar em
    // silêncio.
    console.log("→ editar a tag na lousa");
    const { rows: boardRows } = await sql.query(
      `select w.id as workspace_id, n.id as note_id
         from workspaces w
         join notes n on n.user_id = w.user_id and n.type = 'meeting'
        where w.user_id = $1
        order by w.is_default desc
        limit 1`,
      [userId]
    );
    const board = boardRows[0];

    await page.evaluate(
      async ([workspaceId, noteId]) => {
        await fetch(`/api/workspaces/${workspaceId}/windows`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "note", noteId, x: 120, y: 120 }),
        });
      },
      [board.workspace_id, board.note_id]
    );

    await page.goto(`${BASE}/workspace/${board.workspace_id}`, {
      waitUntil: "networkidle",
    });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector("button[aria-label='Editar a tag reunião']", {
      timeout: 20000,
    });
    await page.click("button[aria-label='Editar a tag reunião']");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/editor-da-tag-light.png` });

    // A cor grava na hora; o nome espera o Enter.
    await page.click("button[aria-label='Cor 6']");
    const recolored = await waitForTag(sql, userId, "reunião", "6");
    check(
      problems,
      "a amostra de cor grava na hora",
      recolored[0]?.color === "6",
      `color = ${recolored[0]?.color}`
    );

    await page.fill("input[aria-label='Nome da tag']", "alinhamento");
    await page.keyboard.press("Enter");
    const renamed = await waitForTag(sql, userId, "alinhamento", "6");
    check(
      problems,
      "renomear a tag vale para a conta inteira",
      renamed.length === 1 && renamed[0].color === "6",
      renamed.length ? `${renamed[0].name} / ${renamed[0].color}` : "não achou"
    );

    // E a trilha registra o renomeio — o nome é como a pessoa reencontra o
    // que guardou; a cor, não.
    const { rows: audited } = await sql.query(
      "select count(*)::int as total from audit_logs where user_id = $1 and table_name = 'tags'",
      [userId]
    );
    check(
      problems,
      "o renomeio é auditado (e a cor não)",
      audited[0].total === 1,
      `${audited[0].total} registro(s)`
    );

    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector("button[aria-label='Editar a tag alinhamento']", {
      timeout: 20000,
    });
    check(
      problems,
      "o novo nome sobrevive ao recarregamento",
      await page.isVisible("button[aria-label='Editar a tag alinhamento']")
    );
    await page.screenshot({ path: `${OUT}/tag-editada-light.png` });

    await page.goto(`${BASE}/dashboard/tags`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForTimeout(1200);

    // Tema escuro, de volta à tela de descanso.
    await page.evaluate(() => {
      try {
        localStorage.setItem("nexo-theme", "dark");
      } catch {}
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.fill('input[aria-label="Buscar notas e tags"]', "");
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/recent-dark.png` });

    console.log(
      problems.length
        ? `\nProblemas:\n  ${[...new Set(problems)].join("\n  ")}`
        : "\nNenhum erro de console."
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
