/**
 * Teste de ponta a ponta da borracha, com sessão real.
 *
 *   bun run shots:eraser            # exercita e fotografa
 *   bun run shots:eraser -- --keep  # não apaga o usuário de teste no fim
 *
 * O que ele prova, e que uma captura de tela sozinha não provaria:
 *
 *   - a passada apaga **o que ela encostou**, e só isso;
 *   - o que saiu da lousa **continua na conta** — é a promessa da ferramenta;
 *   - o post-it, que só existe na lousa, some de verdade;
 *   - o "Desfazer" traz tudo de volta, no lugar em que estava;
 *   - "Apagar tudo" esvazia a lousa sem tocar em nota nenhuma.
 *
 * Mesmo contrato dos outros roteiros: cria o usuário pelo service role, entra
 * pela interface e apaga o usuário no fim.
 *
 * Precisa de SUPABASE_SERVICE_ROLE_KEY e DATABASE_URL: roda com
 * `node --env-file=.env`.
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

const OUT = ".impeccable/review/eraser";
const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const EMAIL = `qa-eraser-${Date.now()}@nexo.test`;
const PASSWORD = "SenhaDeTesteForte!2026";
const HIDE_DEV_BADGE = "nextjs-portal{display:none !important}";

const NOTES = [
  ["Contrato de prestação — Acme", "Vigência de 12 meses.", "document"],
  ["Reunião de alinhamento", "O classificador escolhe o workspace.", "meeting"],
  ["Comprar cabo HDMI 2.1", "Verificar 4K a 120Hz.", "task"],
];

const WINDOW = "article[class*='group/window']";

function findChrome() {
  const found =
    (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)
      ? process.env.CHROME_PATH
      : null) ?? CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) throw new Error("Chrome não encontrado. Defina CHROME_PATH.");
  return found;
}

async function seed(sql, userId) {
  const { rows } = await sql.query(
    "select id from workspaces where user_id = $1 order by is_default desc limit 1",
    [userId]
  );
  const workspaceId = rows[0].id;

  const noteIds = [];
  for (const [title, content, type] of NOTES) {
    const { rows: created } = await sql.query(
      `insert into notes (user_id, workspace_id, title, content, type, source)
       values ($1, $2, $3, $4, $5::note_type, 'user') returning id`,
      [userId, workspaceId, title, content, type]
    );
    noteIds.push(created[0].id);
  }

  return { workspaceId, noteIds };
}

/**
 * Espera o banco chegar na contagem esperada.
 *
 * Sondagem, e não um tempo fixo: a primeira chamada a uma rota em `next dev`
 * paga a compilação dela, e um `waitForTimeout` generoso o bastante para
 * cobrir isso deixaria o roteiro lento em todas as outras vezes.
 */
async function waitForWindowCount(sql, userId, expected, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let total = await countWindows(sql, userId);
  while (total !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    total = await countWindows(sql, userId);
  }
  return total;
}

/** Quantas janelas a lousa tem no banco — a única contagem que vale. */
async function countWindows(sql, userId) {
  const { rows } = await sql.query(
    "select count(*)::int as total from workspace_windows where user_id = $1",
    [userId]
  );
  return rows[0].total;
}

async function countNotes(sql, userId) {
  const { rows } = await sql.query(
    "select count(*)::int as total from notes where user_id = $1 and status <> 'deleted'",
    [userId]
  );
  return rows[0].total;
}

/** Geometria das janelas na tela, para mirar a borracha. */
async function readBoxes(page) {
  return page.$$eval(WINDOW, (nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return {
        title: node.querySelector("header span")?.textContent?.trim() ?? "",
        x: box.x + box.width / 2,
        y: box.y + 60,
      };
    })
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

    const { workspaceId, noteIds } = await seed(sql, userId);

    browser = await chromium.launch({ executablePath: findChrome() });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "pt-BR",
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      console.log("PAGEERROR:", error.message);
      problems.push(`pageerror: ${error.message}`);
    });

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 20000 });

    // ---- a lousa de partida: duas notas, um post-it e uma caixa de texto ----
    // Montada pela rota, e não pela barra de ferramentas: o que este roteiro
    // testa é a borracha, e montar o cenário pela interface só acrescentaria
    // formas de ele falhar por outro motivo.
    await page.goto(`${BASE}/workspace/${workspaceId}`, {
      waitUntil: "networkidle",
    });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });

    await page.evaluate(
      async ([id, ids]) => {
        const post = (body) =>
          fetch(`/api/workspaces/${id}/windows`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

        await post({ kind: "note", noteId: ids[0], x: 80, y: 80 });
        await post({ kind: "note", noteId: ids[1], x: 440, y: 80 });
        await post({ kind: "sticky", tone: "3", text: "Só vive aqui.", x: 800, y: 80 });
        await post({ kind: "text", text: "Caixa de texto da lousa.", x: 80, y: 400 });
      },
      [workspaceId, noteIds]
    );

    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(WINDOW, { timeout: 20000 });
    await page.waitForTimeout(1200);

    const startWindows = await countWindows(sql, userId);
    const startNotes = await countNotes(sql, userId);
    check("a lousa começa com quatro elementos", startWindows === 4, `${startWindows}`);
    await page.screenshot({ path: `${OUT}/01-antes-light.png` });

    // ---- a borracha na mão ----
    await page.click('button[title^="Borracha"]');
    await page.waitForTimeout(300);
    check(
      "a barra avisa que a borracha está ligada",
      await page.isVisible("text=Passe por cima para tirar da lousa")
    );
    await page.screenshot({ path: `${OUT}/02-borracha-ligada-light.png` });

    // ---- uma passada por cima de duas janelas ----
    const boxes = await readBoxes(page);
    const sticky = boxes.find((box) => box.title.includes("Post-it"));
    const contract = boxes.find((box) => box.title.includes("Contrato"));
    if (!sticky || !contract) {
      throw new Error(`janelas não encontradas: ${boxes.map((b) => b.title).join(" | ")}`);
    }

    await page.mouse.move(contract.x, contract.y);
    await page.waitForTimeout(200);
    // O alvo marcado antes de sumir: a moldura vermelha por cima da janela.
    check(
      "a borracha marca o que vai apagar",
      await page.isVisible("div.border-error")
    );
    await page.screenshot({ path: `${OUT}/03-alvo-marcado-light.png` });

    await page.mouse.down();
    // Em passos, como uma passada de verdade: um salto único não geraria os
    // pointermove intermediários, e é neles que a borracha encosta.
    const steps = 24;
    for (let step = 1; step <= steps; step++) {
      await page.mouse.move(
        contract.x + ((sticky.x - contract.x) * step) / steps,
        contract.y + ((sticky.y - contract.y) * step) / steps
      );
    }
    await page.mouse.up();

    // O traçado cruza as três janelas de cima; a caixa de texto fica embaixo
    // dele e é a testemunha de que a borracha só apaga o que ela encosta.
    const afterSweep = await waitForWindowCount(sql, userId, 1);
    check(
      "a passada apaga as três que encostou, e só elas",
      afterSweep === 1,
      `${startWindows} → ${afterSweep}`
    );

    const { rows: survivor } = await sql.query(
      "select kind from workspace_windows where user_id = $1",
      [userId]
    );
    check(
      "o que ficou fora do traçado continua na lousa",
      survivor[0]?.kind === "text",
      survivor.map((row) => row.kind).join(", ") || "nada"
    );
    check(
      "e as notas continuam na conta",
      (await countNotes(sql, userId)) === startNotes,
      `${startNotes} notas`
    );
    check(
      "o cartão explica o que aconteceu com o que sumiu",
      await page.isVisible("text=continuam na sua conta")
    );
    await page.screenshot({ path: `${OUT}/04-depois-da-passada-light.png` });

    // ---- desfazer ----
    await page.click('button:has-text("Desfazer")');
    const afterUndo = await waitForWindowCount(sql, userId, startWindows);
    check(
      "o Desfazer traz de volta o que a passada apagou",
      afterUndo === startWindows,
      `${afterSweep} → ${afterUndo}`
    );

    const { rows: restored } = await sql.query(
      "select x, y from workspace_windows where user_id = $1 and kind = 'sticky'",
      [userId]
    );
    check(
      "e o post-it volta para onde estava",
      restored[0]?.x === 800 && restored[0]?.y === 80,
      `${restored[0]?.x}, ${restored[0]?.y}`
    );

    // ---- apagar tudo ----
    await page.waitForSelector('button:has-text("Apagar tudo")');
    await page.click('button:has-text("Apagar tudo")');
    await page.waitForTimeout(200);
    check(
      "apagar tudo pede confirmação antes",
      await page.isVisible('button:has-text("Apagar mesmo")')
    );
    await page.screenshot({ path: `${OUT}/05-apagar-tudo-armado-light.png` });

    await page.click('button:has-text("Apagar mesmo")');
    // O cartão do Desfazer vive 3 s — e para enquanto o ponteiro está nele.
    // As conferências abaixo levam mais que isso; o ponteiro fica no cartão,
    // como ficaria o de quem está lendo.
    await page.hover('[role="status"]:has(button:has-text("Desfazer"))');
    check("a lousa esvazia", (await waitForWindowCount(sql, userId, 0)) === 0);
    check(
      "e nenhuma nota foi embora com ela",
      (await countNotes(sql, userId)) === startNotes,
      `${startNotes} notas`
    );
    check(
      "a lousa vazia volta a oferecer o primeiro passo",
      await page.isVisible("text=Uma superfície vazia")
    );

    // Visível não é o bastante: a camada da borracha é invisível e cobriria
    // justamente os botões que a pessoa precisa alcançar depois de apagar
    // tudo. Quem responde pelo ponto é quem está por cima.
    check(
      "e os botões dela continuam alcançáveis com a borracha na mão",
      await page.evaluate(() => {
        const button = [...document.querySelectorAll("button")].find((node) =>
          (node.textContent ?? "").includes("Criar uma nota")
        );
        if (!button) return false;
        const box = button.getBoundingClientRect();
        const top = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2
        );
        return button.contains(top);
      })
    );
    await page.screenshot({ path: `${OUT}/06-lousa-vazia-light.png` });

    // ---- desfazer o apagar tudo, e conferir no recarregamento ----
    await page.click('button:has-text("Desfazer")');
    const afterFullUndo = await waitForWindowCount(sql, userId, startWindows);
    check(
      "o Desfazer devolve a lousa inteira",
      afterFullUndo === startWindows,
      `${afterFullUndo}`
    );

    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(WINDOW, { timeout: 20000 });
    await page.waitForTimeout(1200);
    const onScreen = await page.$$eval(WINDOW, (nodes) => nodes.length);
    check(
      "e o que voltou sobrevive ao recarregamento",
      onScreen === startWindows,
      `${onScreen} na tela`
    );
    await page.screenshot({ path: `${OUT}/07-restaurada-light.png` });

    await page.evaluate(() => {
      try {
        localStorage.setItem("nexo-theme", "dark");
      } catch {}
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.waitForTimeout(400);
    await page.click('button[title^="Borracha"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/08-borracha-ligada-dark.png` });

    console.log(`\n${results.join("\n")}`);
    const consoleProblems = [...new Set(problems.filter((p) => p.includes(":")))];
    console.log(
      consoleProblems.length
        ? `\nErros de console:\n  ${consoleProblems.join("\n  ")}`
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
