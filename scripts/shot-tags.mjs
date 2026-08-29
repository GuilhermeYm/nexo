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
 *   - a busca encontra tag pelo nome (sem acento) e nota pelo conteúdo.
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
