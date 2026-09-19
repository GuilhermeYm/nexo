/**
 * Teste de ponta a ponta da busca, com sessão real.
 *
 *   bun run shots:busca            # exercita e fotografa
 *   bun run shots:busca -- --keep  # não apaga os usuários de teste no fim
 *
 * A busca da barra procura em notas **e** arquivos. Este roteiro semeia os
 * dois, de duas contas diferentes, e confere o que costuma quebrar sem dar
 * erro: o arquivo da outra conta não pode aparecer, a nota na lixeira não
 * pode emprestar o conteúdo dela para um resultado, `%` é texto e não
 * curinga, e o caminho do Storage não pode sair na resposta da API.
 *
 * Também usa o teclado (seta + Enter abre o visualizador) e a busca ampliada.
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

const OUT = ".impeccable/review/search";
const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const STAMP = Date.now();
const EMAIL = `qa-search-${STAMP}@nexo.test`;
const PASSWORD = "SenhaDeTesteForte!2026";
const HIDE_DEV_BADGE = "nextjs-portal{display:none !important}";

function findChrome() {
  const found =
    (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)
      ? process.env.CHROME_PATH
      : null) ?? CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Chrome não encontrado. Defina CHROME_PATH.");
  return found;
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

  const problems = [];
  const users = [];
  const objects = [];
  let browser = null;

  const check = (label, ok, extra = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
    if (!ok) problems.push(label);
  };

  try {
    const makeUser = async (email) => {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      users.push(data.user.id);
      return data.user.id;
    };
    const makeNote = async (uid, title, content, status = "active") =>
      (
        await sql.query(
          "insert into notes (user_id, title, content, source, status) values ($1, $2, $3, 'ai', $4) returning id",
          [uid, title, content, status]
        )
      ).rows[0].id;
    const makeFile = async (uid, noteId, type, name, mime, body) => {
      const storagePath = `${uid}/${STAMP}-${name}`;
      if (body) {
        const upload = await admin.storage
          .from("files")
          .upload(storagePath, new Blob([body], { type: mime }), { contentType: mime });
        if (upload.error) throw upload.error;
        objects.push(storagePath);
      }
      return (
        await sql.query(
          `insert into attachments (user_id, note_id, type, storage_path, filename, mime_type, size_bytes)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [uid, noteId, type, storagePath, name, mime, body ? body.length : 2048]
        )
      ).rows[0].id;
    };

    const userId = await makeUser(EMAIL);
    const otherId = await makeUser(`qa-search-other-${STAMP}@nexo.test`);

    await makeNote(userId, "Planejamento do orçamento anual", "Revisar o orçamento com o time financeiro.");
    const meetingNote = await makeNote(
      userId,
      "Reunião com fornecedores",
      "Transcrição: discutimos o orçamento do trimestre e os prazos de entrega."
    );
    await makeFile(userId, meetingNote, "audio", "gravacao-0412.m4a", "audio/mp4", null);
    await makeFile(userId, null, "image", "foto-praia.png", "image/png", null);
    await makeFile(
      userId,
      null,
      "document",
      "contrato.txt",
      "text/plain",
      "Cláusula 1: o aluguel vence todo dia 5."
    );
    const trashed = await makeNote(userId, "Nota na lixeira", "palavrasecreta xylofone", "deleted");
    await makeFile(userId, trashed, "pdf", "escaneado.pdf", "application/pdf", null);
    await makeFile(otherId, null, "image", "foto-alheia.png", "image/png", null);

    browser = await chromium.launch({ executablePath: findChrome() });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "pt-BR",
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 60000 });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });

    const box = page.getByRole("combobox", { name: "Buscar nas suas notas e arquivos" }).first();
    const list = page.getByRole("listbox", { name: "Resultados da busca" });
    const search = async (term) => {
      await box.fill(term);
      await page.waitForTimeout(400);
      await list.locator("[role=option], p").first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(300);
    };

    console.log("\n1. Grupos e procedência");
    await search("orçamento");
    const files = list.getByRole("group", { name: "Arquivos" });
    const notesGroup = list.getByRole("group", { name: "Notas" });
    check("notas e arquivos em grupos", (await notesGroup.count()) === 1 && (await files.count()) === 1);
    check(
      "áudio achado pelo que a Nexo leu dele",
      (await files.getByText("gravacao-0412.m4a").count()) === 1
    );
    check(
      "nota achada ao lado",
      (await notesGroup.getByText("Planejamento do orçamento anual").count()) === 1
    );
    await page.screenshot({ path: `${OUT}/grouped--desktop-light.png` });

    await search("foto");
    check("imagem achada pelo nome", (await list.getByText("foto-praia.png").count()) === 1);
    check(
      "arquivo de outra conta não aparece",
      (await list.getByText("foto-alheia.png").count()) === 0
    );
    check(
      "só arquivos: sem grupo de notas",
      (await list.getByRole("group", { name: "Notas" }).count()) === 0
    );

    console.log("\n2. Lixeira e curingas");
    await search("xylofone");
    check("nota na lixeira não empresta conteúdo", (await list.getByRole("option").count()) === 0);
    await search("escaneado");
    check(
      "arquivo da nota na lixeira segue achável pelo nome",
      (await list.getByText("escaneado.pdf").count()) === 1
    );
    await search("%");
    check("% é texto, não curinga", (await list.getByRole("option").count()) === 0);

    console.log("\n3. Teclado e busca ampliada");
    await search("contrato");
    await box.press("ArrowDown");
    await box.press("Enter");
    const viewer = page.locator("dialog[open]");
    await viewer.getByText("Cláusula 1", { exact: false }).waitFor({ timeout: 15000 });
    check(
      "Enter abre o arquivo no visualizador",
      (await viewer.getByRole("heading", { name: "contrato.txt" }).count()) === 1
    );
    await page.screenshot({ path: `${OUT}/viewer--desktop-light.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check("Esc fecha o visualizador", (await page.locator("dialog[open]").count()) === 0);

    await page.getByRole("button", { name: "Abrir a busca ampliada" }).click();
    const big = page.getByRole("combobox", { name: "Buscar nas suas notas e arquivos" }).last();
    await big.fill("contrato");
    await page.waitForTimeout(600);
    const bigList = page.getByRole("listbox", { name: "Resultados da busca ampliada" });
    await bigList.getByText("contrato.txt").waitFor({ timeout: 10000 });
    await page.screenshot({ path: `${OUT}/expanded--desktop-light.png` });
    await bigList.getByText("contrato.txt").click();
    await page
      .locator("dialog[open]")
      .getByText("Cláusula 1", { exact: false })
      .waitFor({ timeout: 15000 });
    check(
      "busca ampliada fecha e visualizador abre",
      (await page.locator("dialog[open]").count()) === 1 &&
        (await page.locator("dialog[open]").getByRole("heading", { name: "contrato.txt" }).count()) === 1
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    console.log("\n4. A API");
    const scoped = await page.evaluate(
      async () => await (await fetch("/api/search?scope=notes&q=foto")).json()
    );
    check("scope=notes não busca arquivos", Array.isArray(scoped.files) && scoped.files.length === 0);
    const leak = await page.evaluate(async () =>
      JSON.stringify(await (await fetch("/api/search?q=foto")).json())
    );
    check(
      "caminho do storage não sai",
      !leak.includes("storage") && !leak.includes(String(STAMP))
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await search("orçamento");
    await page.screenshot({ path: `${OUT}/grouped--mobile-light.png` });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/grouped--mobile-dark.png` });
  } catch (err) {
    problems.push(String(err?.stack || err));
  } finally {
    await browser?.close();
    if (!KEEP) {
      if (objects.length) await admin.storage.from("files").remove(objects);
      for (const id of users) await admin.auth.admin.deleteUser(id);
    }
    await sql.end();
    console.log(
      problems.length ? `\nPROBLEMAS:\n${problems.join("\n")}` : `\ntudo certo — imagens em ${OUT}`
    );
    process.exitCode = problems.length ? 1 : 0;
  }
}

await main();
