/**
 * As pastas no trilho: o menu da pasta, as duas maneiras de apagar, e o
 * menu das notas de dentro.
 *
 *   bun run shots:pastas            # o roteiro inteiro
 *   bun run shots:pastas -- --keep  # não apaga o usuário de teste no fim
 *
 * Este é um roteiro de uso, não só de foto: ele entra pela interface, abre os
 * menus com o botão direito e **confere no banco** o que cada escolha fez.
 * A diferença entre "apagar a pasta" e "apagar a pasta e as notas" é
 * invisível na tela — as duas fazem a linha sumir do trilho — e é exatamente
 * por isso que ela precisa ser conferida do outro lado. O mesmo vale para as
 * tags: a compartilhada com uma nota de fora tem de sobreviver.
 *
 * Precisa de SUPABASE_SERVICE_ROLE_KEY e DATABASE_URL, e lê o UPSTASH_* do
 * `.env.local` para conferir o cache da lista de pastas (sem ele, essa parte
 * é pulada e o resto roda igual). A chave nunca sai daqui: é script de terminal, não
 * código da aplicação.
 */
import { createClient } from "@supabase/supabase-js";
import { Redis } from "@upstash/redis";
import { createHash } from "node:crypto";
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

const OUT = ".impeccable/review/pastas";
const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const EMAIL = `qa-pastas-${Date.now()}@nexo.test`;
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

const problems = [];
function check(label, ok, detail = "") {
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

    const { rows: spaces } = await sql.query(
      "select id from workspaces where user_id = $1 order by is_default desc limit 1",
      [userId]
    );
    const workspaceId = spaces[0]?.id ?? null;

    /** Uma pasta da pessoa. */
    const folder = async (name) =>
      (
        await sql.query(
          "insert into folders (user_id, name, source) values ($1, $2, 'user') returning id",
          [userId, name]
        )
      ).rows[0].id;

    /** Uma nota, opcionalmente dentro de uma pasta e/ou marcada para um dia. */
    const note = async (title, folderId, taskDate = null) => {
      const { rows } = await sql.query(
        `insert into notes (user_id, workspace_id, title, content, type, source, task_date)
         values ($1, $2, $3, 'Conteúdo de teste.', 'note', 'user', $4) returning id`,
        [userId, workspaceId, title, taskDate]
      );
      const id = rows[0].id;
      if (folderId) {
        await sql.query(
          "insert into note_folders (note_id, user_id, folder_id, source) values ($1, $2, $3, 'user')",
          [id, userId, folderId]
        );
      }
      return id;
    };

    /** Uma tag da pessoa, pendurada nas notas indicadas. */
    const tag = async (name, color, noteIds) => {
      const { rows } = await sql.query(
        "insert into tags (user_id, name, color) values ($1, $2, $3) returning id",
        [userId, name, color]
      );
      const id = rows[0].id;
      for (const noteId of noteIds) {
        await sql.query("insert into note_tags (note_id, tag_id) values ($1, $2)", [noteId, id]);
      }
      return id;
    };

    const keepFolder = await folder("Guardar");
    const purgeFolder = await folder("Sumir");
    const survivor = await note("Nota que fica", keepFolder);
    const doomedA = await note("Nota que vai junto A", purgeFolder);
    const doomedB = await note("Nota que vai junto B", purgeFolder);
    // Tarefa da Agenda dentro da pasta: não entra na contagem, então também
    // não pode entrar na exclusão. É a armadilha que este roteiro vigia.
    const agendaTask = await note("Tarefa de amanhã", purgeFolder, "2099-01-01");

    // Duas tags de teor diferente: uma que só vive nas notas condenadas, e
    // outra que também está numa nota de fora da pasta. Marcar "apagar as
    // tags" leva as duas — e o diálogo precisa dizer isso antes.
    const onlyHere = await tag("sóaqui", "1", [doomedA, doomedB]);
    const sharedTag = await tag("compartilhada", "2", [doomedA, survivor]);

    // Uma nota à parte, para exercitar o menu de uma nota só: ela tem a
    // própria tag, e a exclusão pelo trilho precisa oferecer levá-la junto.
    const loose = await note("Nota com tag própria", keepFolder);
    const looseTag = await tag("sódela", "3", [loose]);

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

    // O trilho mostra o que a pessoa escolheu, e a escolha mora no navegador.
    await page.evaluate(() => {
      try {
        localStorage.setItem("nexo-sidebar-view", "both");
      } catch {}
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForTimeout(1500);

    const sidebar = "section[aria-label='Pastas de notas']";
    // Há mais de um diálogo montado (o da nota, o da pasta, o de Recentes),
    // todos fechados até alguém pedir. As conferências entram no aberto.
    const dialog = page.locator("dialog[open]");
    const folderRow = (name) =>
      page.locator(`${sidebar} button`, { hasText: name }).first();

    const status = async (id) =>
      (await sql.query("select status from notes where id = $1", [id])).rows[0]?.status;
    const folderExists = async (id) =>
      (await sql.query("select 1 from folders where id = $1", [id])).rowCount > 0;
    const tagGone = async (id) =>
      (await sql.query("select 1 from tags where id = $1", [id])).rowCount === 0;

    console.log("→ o trilho");
    check("as pastas aparecem com a contagem", await folderRow("Sumir").isVisible());
    await page.screenshot({ path: `${OUT}/trilho.png` });

    console.log("→ o cache da lista de pastas");
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const redis = Redis.fromEnv();
      // Mesma derivação de `lib/notes/cache.ts`: o id da conta não aparece
      // legível nas chaves.
      const scope = createHash("sha256").update(userId).digest("base64url").slice(0, 32);
      const version = (await redis.get(`notes-cache:v3:version:${scope}`)) ?? "0";
      const cachedFolders = await redis.get(`notes-cache:v3:folders:${scope}:${version}`);
      check(
        "a primeira leitura do trilho gravou as pastas no Redis",
        Array.isArray(cachedFolders) && cachedFolders.length === 2
      );

      const folderNames = () =>
        page.evaluate(async () => {
          const response = await fetch("/api/folders", { cache: "no-store" });
          const body = await response.json();
          return body.folders.map((folder) => folder.name);
        });

      // Uma pasta enfiada direto no banco, por fora das rotas: nenhuma
      // invalidação acontece. Se a segunda leitura a mostrar, ela foi ao banco.
      const ghost = await folder("Fantasma");
      check(
        "a segunda leitura vem do cache, não do banco",
        !(await folderNames()).includes("Fantasma")
      );

      // Qualquer escrita pelas rotas troca o namespace — renomear para o
      // mesmo nome basta.
      await page.evaluate(
        async (id) =>
          fetch(`/api/folders/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Guardar" }),
          }),
        keepFolder
      );
      check(
        "uma escrita pela rota invalida o cache",
        (await folderNames()).includes("Fantasma")
      );
      await sql.query("delete from folders where id = $1", [ghost]);
    } else {
      console.log("  – UPSTASH_* ausente: sem cache para conferir");
    }

    console.log("→ o menu da pasta");
    await folderRow("Sumir").click({ button: "right" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/menu-pasta.png` });
    check(
      "o menu oferece as duas maneiras de apagar",
      (await page.getByText("Apagar a pasta", { exact: true }).isVisible()) &&
        (await page.getByText("Apagar com as notas").isVisible())
    );
    // A pasta tem 3 notas, mas uma é tarefa da Agenda: o menu promete 2.
    // O diálogo de apagar tudo também fala em notas que "saem", e ele já
    // está no DOM fechado: o padrão tem de prender no número do menu.
    check(
      "o aviso conta só as notas contadas, sem a tarefa da Agenda",
      await page.locator("text=/^2 notas saem/").first().isVisible()
    );

    console.log("→ apagar a pasta com as notas");
    await page.getByText("Apagar com as notas").click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/menu-armado.png` });
    check(
      "o item destrutivo pede o segundo clique",
      await page.getByText("Escolher o que vai junto").isVisible()
    );
    await page.getByText("Escolher o que vai junto").click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/dialogo-pasta.png` });

    check(
      "o diálogo pergunta pelas tags",
      await dialog.getByText("Apagar também todas as tags destas notas").isVisible()
    );
    check(
      "o diálogo avisa que uma tag é usada fora da pasta",
      (await dialog.getByText("fora da pasta").isVisible()) &&
        (await dialog.getByText("Em mais 1").isVisible())
    );

    // Marcada a caixa, as tags das notas condenadas saem junto — inclusive a
    // compartilhada, que é o que o aviso acabou de prometer.
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Apagar tudo" }).click();
    await page.waitForTimeout(3000);

    check("a pasta saiu do banco", !(await folderExists(purgeFolder)));
    check(
      "as notas de dentro foram excluídas",
      (await status(doomedA)) === "deleted" && (await status(doomedB)) === "deleted"
    );
    check(
      "a tarefa da Agenda continua viva",
      (await status(agendaTask)) === "active",
      `status: ${await status(agendaTask)}`
    );
    check("a tag que só vivia ali foi apagada", await tagGone(onlyHere));
    check(
      "a tag compartilhada também foi apagada, como o aviso prometeu",
      await tagGone(sharedTag)
    );
    // O trilho relê as pastas depois da resposta do DELETE; esperar a linha
    // sumir é esperar essa releitura, não um atraso fixo que às vezes não basta.
    check(
      "a pasta saiu do trilho",
      await folderRow("Sumir")
        .waitFor({ state: "hidden", timeout: 10_000 })
        .then(() => true)
        .catch(() => false)
    );

    console.log("→ o menu de uma nota dentro da pasta");
    const dialogsClosed = await page.locator("dialog").count();
    await folderRow("Guardar").click();
    const noteRow = page.locator(`${sidebar} a`, { hasText: "Nota que fica" }).first();
    // As notas de uma pasta só são buscadas quando ela abre: esperar o
    // pedido chegar é parte do roteiro, não um atraso de conveniência.
    const listed = await noteRow
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check("a pasta aberta lista as notas", listed);
    // O diálogo de exclusão é um por lista, não um por nota: abrir uma pasta
    // com várias notas não pode acrescentar <dialog> nenhum à página.
    const dialogsOpen = await page.locator("dialog").count();
    check(
      "abrir a pasta não monta um diálogo por nota",
      dialogsOpen === dialogsClosed,
      `${dialogsClosed} → ${dialogsOpen} <dialog> na página`
    );
    await noteRow.click({ button: "right" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/menu-nota.png` });
    check(
      "a nota oferece o mesmo menu de Recentes",
      (await page.getByText("Abrir no editor").isVisible()) &&
        (await page.getByText("Abrir no workspace").isVisible()) &&
        (await page.getByText("Excluir", { exact: true }).isVisible())
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    console.log("→ excluir uma nota pelo trilho, com a tag dela");
    const looseRow = page
      .locator(`${sidebar} a`, { hasText: "Nota com tag própria" })
      .first();
    await looseRow.click({ button: "right" });
    await page.waitForTimeout(400);
    await page.getByText("Excluir", { exact: true }).click();
    await page.waitForTimeout(200);
    await page.getByText("Excluir para valer").click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/dialogo-nota.png` });
    check(
      "o diálogo da nota pergunta pelas tags",
      await dialog.getByText("Apagar também todas as tags desta nota").isVisible()
    );
    // A primeira caixa é a dos arquivos; a das tags é a segunda.
    await dialog.getByRole("checkbox").last().check();
    await dialog.getByRole("button", { name: "Excluir nota" }).click();
    await page.waitForTimeout(2500);
    check("a nota foi excluída", (await status(loose)) === "deleted");
    check("a tag dela saiu junto", await tagGone(looseTag));

    console.log("→ apagar a pasta preservando as notas");
    await folderRow("Guardar").click({ button: "right" });
    await page.waitForTimeout(400);
    await page.getByText("Apagar a pasta", { exact: true }).click();
    await page.waitForTimeout(200);
    await page.getByText("Apagar só a pasta").click();
    await page.waitForTimeout(3000);

    check("a pasta saiu do banco", !(await folderExists(keepFolder)));
    check(
      "a nota continua viva, agora sem pasta",
      (await status(survivor)) === "active" &&
        (await sql.query("select 1 from note_folders where note_id = $1", [survivor]))
          .rowCount === 0
    );
    await page.screenshot({ path: `${OUT}/depois.png` });

    if (problems.length === 0) console.log("\nNenhum erro de console.");
    console.log(`Imagens em ${OUT}`);
  } finally {
    if (browser) await browser.close();
    if (userId && !KEEP) {
      await admin.auth.admin.deleteUser(userId);
      console.log("usuário de teste apagado:", userId);
    }
    await sql.end();
  }

  if (problems.length > 0) {
    console.log(`\nPROBLEMAS:\n- ${problems.join("\n- ")}`);
    process.exitCode = 1;
  }
}

await main();
