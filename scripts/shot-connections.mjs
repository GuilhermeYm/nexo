/**
 * Teste de ponta a ponta das ligações, com sessão real.
 *
 *   bun run shots:links            # exercita e fotografa
 *   bun run shots:links -- --keep  # não apaga o usuário de teste no fim
 *
 * O que ele prova, e que uma captura de tela sozinha não provaria:
 *
 *   - dois toques criam a flecha, e ela vai para o Postgres;
 *   - o destino vira a origem seguinte — a corrente custa um toque por elo;
 *   - a flecha é desenhada de fato, e continua lá depois de recarregar;
 *   - o botão direito nela remove só ela;
 *   - a borracha encosta na flecha e o Desfazer a traz de volta;
 *   - fechar uma janela leva as flechas dela junto, por cascade.
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

const OUT = ".impeccable/review/links";
const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const EMAIL = `qa-links-${Date.now()}@nexo.test`;
const PASSWORD = "SenhaDeTesteForte!2026";
const HIDE_DEV_BADGE = "nextjs-portal{display:none !important}";

const WINDOW = "article[class*='group/window']";
/** As flechas, pelo atributo que só elas têm. */
const ARROWS = "[data-connection]";

const NOTES = [
  ["Pesquisa de campo", "Entrevistas com doze pessoas.", "document"],
  ["Hipótese central", "As pessoas guardam antes de organizar.", "idea"],
  ["Próximo passo", "Prototipar a lousa com ligações.", "task"],
];

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

async function countLinks(sql, userId) {
  const { rows } = await sql.query(
    "select count(*)::int as total from workspace_connections where user_id = $1",
    [userId]
  );
  return rows[0].total;
}

/** Espera o banco chegar na contagem esperada, em vez de dormir um tempo fixo. */
async function waitForLinks(sql, userId, expected, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let total = await countLinks(sql, userId);
  while (total !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    total = await countLinks(sql, userId);
  }
  return total;
}

/** Onde cada janela está na tela, para mirar os toques. */
async function readBoxes(page) {
  return page.$$eval(WINDOW, (nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return {
        title: node.querySelector("header span")?.textContent?.trim() ?? "",
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
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

    // Três janelas em linha, longe umas das outras: a flecha precisa de
    // espaço entre as bordas para sobrar traço clicável.
    // Do dashboard, e não da própria lousa: a lousa guarda o enquadramento
    // deste dispositivo, e visitá-la uma vez com ela vazia faria a chegada
    // seguinte herdar aquele enquadramento em vez de enquadrar as janelas.
    await page.evaluate(
      async ([id, ids]) => {
        for (const [index, noteId] of ids.entries()) {
          await fetch(`/api/workspaces/${id}/windows`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "note",
              noteId,
              x: 80 + index * 440,
              y: 120,
              width: 260,
              height: 200,
            }),
          });
        }
      },
      [workspaceId, noteIds]
    );

    await page.goto(`${BASE}/workspace/${workspaceId}`, {
      waitUntil: "networkidle",
    });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(WINDOW, { timeout: 20000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/01-sem-ligacoes-light.png` });

    // ---- a ferramenta de ligação ----
    await page.click('button[title^="Ligar"]');
    await page.waitForTimeout(300);
    check(
      "a barra avisa por onde começar",
      await page.isVisible("text=Toque no elemento de onde a flecha sai")
    );

    const boxes = await readBoxes(page);
    const pesquisa = boxes.find((box) => box.title.includes("Pesquisa"));
    const hipotese = boxes.find((box) => box.title.includes("Hipótese"));
    const passo = boxes.find((box) => box.title.includes("Próximo"));
    if (!pesquisa || !hipotese || !passo) {
      throw new Error(`janelas: ${boxes.map((b) => b.title).join(" | ")}`);
    }

    await page.mouse.click(pesquisa.x, pesquisa.y);
    await page.waitForTimeout(300);
    check(
      "escolhida a origem, a barra pede o destino",
      await page.isVisible("text=Agora toque no outro elemento")
    );
    // A ponta solta segue o ponteiro enquanto o destino não vem.
    await page.mouse.move((pesquisa.x + hipotese.x) / 2, pesquisa.y - 60);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/02-ligando-light.png` });

    await page.mouse.click(hipotese.x, hipotese.y);
    check(
      "dois toques criam a ligação",
      (await waitForLinks(sql, userId, 1)) === 1
    );

    // O destino virou a origem: mais um toque, mais um elo.
    await page.mouse.click(passo.x, passo.y);
    await page.waitForTimeout(2000);
    check(
      "o destino vira a origem seguinte (corrente)",
      (await waitForLinks(sql, userId, 2)) === 2
    );

    const { rows: chain } = await sql.query(
      `select w1.z_index as a, w2.z_index as b
         from workspace_connections c
         join workspace_windows w1 on w1.id = c.from_window_id
         join workspace_windows w2 on w2.id = c.to_window_id
        where c.user_id = $1`,
      [userId]
    );
    check("as duas ligações têm origem e destino distintos", chain.length === 2);

    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    const drawn = await page.$$eval(ARROWS, (nodes) => nodes.length);
    check("as flechas são desenhadas de fato", drawn === 2, `${drawn} desenhadas`);
    await page.screenshot({ path: `${OUT}/03-ligadas-light.png` });

    // ---- sobrevive ao recarregamento: veio do Postgres, não da memória ----
    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(WINDOW, { timeout: 20000 });
    await page.waitForTimeout(1000);
    check(
      "e continuam desenhadas depois de recarregar",
      (await page.$$eval(ARROWS, (nodes) => nodes.length)) === 2
    );

    // ---- a folga entre a flecha e a moldura da janela ----
    //
    // Encostada, a flecha vira parte da moldura: o olho lê um retângulo com
    // um espeto, não duas coisas ligadas. A conta é a distância de cada ponta
    // do traço ao retângulo mais próximo, em pixels de tela.
    const gaps = await page.evaluate(() => {
      const group = document.querySelector("[data-connection]");
      if (!group) return null;
      const box = group.getBoundingClientRect();
      const rects = [
        ...document.querySelectorAll("article[class*='group/window']"),
      ].map((node) => node.getBoundingClientRect());

      const ends = [
        { x: box.left, y: box.top + box.height / 2 },
        { x: box.right, y: box.top + box.height / 2 },
      ];

      return ends.map((point) =>
        Math.min(
          ...rects.map((rect) => {
            const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
            const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
            return Math.hypot(dx, dy);
          })
        )
      );
    });
    check(
      "a flecha para antes de encostar na janela",
      Boolean(gaps) && gaps.every((gap) => gap >= 6 && gap <= 30),
      gaps ? gaps.map((gap) => Math.round(gap)).join(" / ") : "sem flecha"
    );

    // ---- o par recíproco não fica uma flecha em cima da outra ----
    const windowIds = await page.evaluate(
      async (id) => {
        const response = await fetch(`/api/workspaces/${id}/windows`, {
          cache: "no-store",
        });
        const body = await response.json();
        return body.connections.map((c) => [c.fromWindowId, c.toWindowId]);
      },
      workspaceId
    );
    const [firstPair] = windowIds;
    await page.evaluate(
      async ([id, from, to]) => {
        await fetch(`/api/workspaces/${id}/connections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // A de volta: B → A. É outra linha de propósito.
          body: JSON.stringify({ fromWindowId: to, toWindowId: from }),
        });
      },
      [workspaceId, firstPair[0], firstPair[1]]
    );
    await page.waitForTimeout(1500);

    const traces = await page.$$eval("[data-connection]", (nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return `${Math.round(box.top)}:${Math.round(box.height)}`;
      })
    );
    check(
      "A→B e B→A são desenhadas separadas",
      traces.length === 3 && new Set(traces).size === traces.length,
      traces.join(" | ")
    );
    await page.screenshot({ path: `${OUT}/04-par-reciproco-light.png` });

    // Desfeita a de volta: o resto do roteiro conta com duas flechas.
    await page.evaluate(
      async ([id, from, to]) => {
        const response = await fetch(`/api/workspaces/${id}/windows`, {
          cache: "no-store",
        });
        const body = await response.json();
        const back = body.connections.find(
          (c) => c.fromWindowId === to && c.toWindowId === from
        );
        await fetch(`/api/workspaces/${id}/connections`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [back.id] }),
        });
      },
      [workspaceId, firstPair[0], firstPair[1]]
    );
    await page.waitForTimeout(1500);

    // ---- o rótulo ----
    const between = {
      x: (pesquisa.x + hipotese.x) / 2,
      y: (pesquisa.y + hipotese.y) / 2,
    };
    await page.mouse.click(between.x, between.y, { button: "right" });
    await page.waitForSelector("[role='menu']", { timeout: 5000 });
    check(
      "o menu da flecha oferece escrever nela",
      await page.isVisible("[role='menu'] :text('Escrever na ligação')")
    );
    await page.click(
      "[role='menu'] [role='menuitem']:has-text('Escrever na ligação')"
    );
    await page.waitForSelector("input[aria-label='Texto da ligação']", {
      timeout: 5000,
    });
    await page.fill("input[aria-label='Texto da ligação']", "sustenta");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);

    const { rows: labelled } = await sql.query(
      "select label from workspace_connections where user_id = $1 and label is not null",
      [userId]
    );
    check(
      "o texto escrito na flecha vai para o banco",
      labelled.length === 1 && labelled[0].label === "sustenta",
      labelled.map((row) => row.label).join(", ") || "nenhum"
    );

    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(WINDOW, { timeout: 20000 });
    await page.waitForTimeout(1000);
    check(
      "e continua na tela depois de recarregar",
      await page.isVisible("button:has-text('sustenta')")
    );
    await page.screenshot({ path: `${OUT}/05-com-rotulo-light.png` });

    // ---- botão direito na flecha ----
    await page.mouse.click(between.x, between.y, { button: "right" });
    await page.waitForSelector("[role='menu']", { timeout: 5000 });
    check(
      "o botão direito na flecha abre o menu dela",
      await page.isVisible("[role='menu'] :text('Remover a ligação')")
    );

    await page.click("[role='menu'] [role='menuitem']:has-text('Remover a ligação')");
    check(
      "e remove só ela",
      (await waitForLinks(sql, userId, 1)) === 1
    );

    // ---- a borracha encosta na flecha ----
    const remaining = {
      x: (hipotese.x + passo.x) / 2,
      y: (hipotese.y + passo.y) / 2,
    };
    await page.click('button[title^="Borracha"]');
    await page.waitForTimeout(300);
    await page.mouse.move(remaining.x - 40, remaining.y);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/06-borracha-na-flecha-light.png` });

    await page.mouse.down();
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(remaining.x - 40 + (80 * step) / 12, remaining.y);
    }
    await page.mouse.up();
    check(
      "a borracha apaga a flecha que encostou",
      (await waitForLinks(sql, userId, 0)) === 0
    );

    await page.click('button:has-text("Desfazer")');
    check(
      "e o Desfazer traz a flecha de volta",
      (await waitForLinks(sql, userId, 1)) === 1
    );

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // ---- fechar a janela leva a flecha junto ----
    const { rows: before } = await sql.query(
      "select count(*)::int as total from workspace_windows where user_id = $1",
      [userId]
    );
    await page.click(`${WINDOW}:has-text("Hipótese") button[title^="Fechar"]`);
    check(
      "fechar uma ponta leva a flecha junto (cascade)",
      (await waitForLinks(sql, userId, 0)) === 0,
      `${before[0].total} janelas antes`
    );

    const { rows: notesAlive } = await sql.query(
      "select count(*)::int as total from notes where user_id = $1 and status <> 'deleted'",
      [userId]
    );
    check(
      "e a nota continua na conta",
      notesAlive[0].total === NOTES.length,
      `${notesAlive[0].total} notas`
    );

    await page.evaluate(() => {
      try {
        localStorage.setItem("nexo-theme", "dark");
      } catch {}
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/07-escuro.png` });

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
