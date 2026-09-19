/**
 * Teste de ponta a ponta das imagens, com sessão real.
 *
 *   bun run shots:images            # exercita e fotografa
 *   bun run shots:images -- --keep  # não apaga o usuário de teste no fim
 *
 * Cobre o caminho inteiro de uma imagem: sobe pela barra do dashboard, espera
 * a IA ler o que está escrito nela, acha o arquivo pela busca por uma palavra
 * que só existe **dentro** da foto, abre o visualizador, recusa SVG e PNG
 * falso, e então põe imagem na lousa pelas três portas (soltar, colar e o
 * botão da barra), conferindo que a janela nasce na proporção certa e que
 * tudo continua lá depois de recarregar.
 *
 * As imagens de teste são geradas aqui mesmo, com o `sharp`, num diretório
 * temporário: um recibo de mercado 1200×600 (PNG, com texto para a IA ler),
 * um retrato 600×900 (JPEG) e um quadrado 300×300 (WebP). São elas que
 * provam a proporção da janela — deitada, em pé e quadrada.
 *
 * Mesmo contrato dos outros roteiros: cria o usuário pelo service role, entra
 * pela interface e apaga o usuário (e os objetos do Storage) no fim.
 *
 * Precisa de SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL e da chave de visão
 * (OPENAI_API_KEY). Roda com `node --env-file=.env.local --env-file=.env`.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { chromium } from "playwright-core";
import sharp from "sharp";

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

const OUT = ".impeccable/review/images";
const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const EMAIL = `qa-img-${Date.now()}@nexo.test`;
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

/**
 * Gera as três imagens de teste.
 *
 * O recibo é desenhado a partir de um SVG só porque é a maneira mais direta
 * de escrever texto com o `sharp` — o que sobe para a aplicação é o PNG
 * rasterizado. SVG, aliás, é recusado pela rota de upload de propósito.
 */
async function makeImages(dir) {
  const receipt = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600">
<rect width="100%" height="100%" fill="#fffdf5"/>
<text x="60" y="130" font-family="DejaVu Sans, sans-serif" font-size="64" font-weight="bold" fill="#111">SUPERMERCADO BOA VISTA</text>
<text x="60" y="250" font-family="DejaVu Sans, sans-serif" font-size="48" fill="#222">Arroz 5kg ........ R$ 27,90</text>
<text x="60" y="330" font-family="DejaVu Sans, sans-serif" font-size="48" fill="#222">Cafe 500g ........ R$ 15,00</text>
<text x="60" y="470" font-family="DejaVu Sans, sans-serif" font-size="56" font-weight="bold" fill="#111">TOTAL R$ 42,90</text>
</svg>`;

  await sharp(Buffer.from(receipt)).png().toFile(path.join(dir, "recibo-mercado.png"));
  await sharp({ create: { width: 600, height: 900, channels: 3, background: "#3b82f6" } })
    .jpeg()
    .toFile(path.join(dir, "foto-retrato.jpg"));
  await sharp({
    create: { width: 300, height: 300, channels: 4, background: { r: 16, g: 185, b: 129, alpha: 1 } },
  })
    .webp()
    .toFile(path.join(dir, "quadrado.webp"));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const images = mkdtempSync(path.join(tmpdir(), "nexo-imagens-"));
  await makeImages(images);

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
  let userId = null;
  let browser = null;
  // A seção das recusas manda de propósito um SVG e um PNG falso: o 415 e o
  // 400 aparecem no console do navegador e não são defeito.
  let expectRejections = false;

  const check = (label, ok, extra = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
    if (!ok) problems.push(label);
  };
  const query = async (text, params) => (await sql.query(text, params)).rows;
  const poll = async (fn, ok, ms = 90000) => {
    const end = Date.now() + ms;
    let value;
    while (Date.now() < end) {
      value = await fn();
      if (ok(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return value;
  };
  const b64 = (name) => readFileSync(path.join(images, name)).toString("base64");

  try {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;

    browser = await chromium.launch({ executablePath: findChrome() });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "pt-BR",
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error" && !expectRejections) problems.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 60000 });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });

    // ---- 1. Upload pela barra do dashboard ----
    console.log("\n1. Upload e leitura pela IA");
    await page.setInputFiles(
      'input[type="file"][accept*=".png"]',
      path.join(images, "recibo-mercado.png")
    );
    await page
      .getByText("recibo-mercado.png chegou", { exact: false })
      .waitFor({ timeout: 30000 });

    const [attachment] = await query(
      "select id, type, mime_type, metadata, note_id from attachments where user_id = $1 and filename = 'recibo-mercado.png'",
      [userId]
    );
    check(
      "imagem vira anexo do tipo image",
      attachment?.type === "image" && attachment?.mime_type === "image/png"
    );
    check(
      "as medidas vão para metadata",
      attachment?.metadata?.width === 1200 && attachment?.metadata?.height === 600,
      JSON.stringify(attachment?.metadata)
    );

    const job = await poll(
      async () =>
        (
          await query("select kind, status, detail, result, error from ai_jobs where note_id = $1", [
            attachment.note_id,
          ])
        )[0],
      (row) => row && !["queued", "running"].includes(row.status)
    );
    check(
      "a tarefa de leitura termina",
      job?.kind === "extract" && job?.status === "succeeded",
      `${job?.status} ${job?.error ?? ""}`
    );
    console.log("     resultado:", JSON.stringify(job?.result));

    const [note] = await query("select title, content, source, type from notes where id = $1", [
      attachment.note_id,
    ]);
    console.log(
      "     nota:",
      note?.title,
      "|",
      (note?.content ?? "").replace(/\n/g, " ⏎ ").slice(0, 300)
    );
    check(
      "a nota ganha o texto lido da imagem",
      /Texto na imagem/.test(note?.content ?? "") && /42[,.]90/.test(note?.content ?? "")
    );
    check("e o redutor mandou bytes ao modelo", (job?.result?.sentBytes ?? 0) > 0);

    const tagRows = await query(
      "select t.name from note_tags nt join tags t on t.id = nt.tag_id where nt.note_id = $1",
      [attachment.note_id]
    );
    check("a nota ganha tags", tagRows.length >= 1, tagRows.map((row) => row.name).join(", "));

    // ---- 2. A busca acha a imagem pelo texto que está dentro dela ----
    console.log("\n2. Busca e visualizador");
    const box = page.getByRole("combobox", { name: "Buscar nas suas notas e arquivos" }).first();
    await box.fill("arroz");
    const list = page.getByRole("listbox", { name: "Resultados da busca" });
    await list.locator("[role=option], p").first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    const hit = list.getByRole("group", { name: "Arquivos" }).getByText("recibo-mercado.png");
    check("a busca acha a imagem por uma palavra escrita nela", (await hit.count()) === 1);

    await hit.click();
    const dialogImage = page.locator("dialog[open] img");
    await dialogImage.waitFor({ timeout: 15000 });
    await page
      .waitForFunction(
        () => {
          const img = document.querySelector("dialog[open] img");
          return img && img.complete && img.naturalWidth > 0;
        },
        null,
        { timeout: 15000 }
      )
      .catch(() => {});
    check(
      "o visualizador desenha a imagem",
      await dialogImage.evaluate((img) => img.naturalWidth === 1200)
    );
    await page.screenshot({ path: `${OUT}/viewer--desktop-light.png` });
    await page.keyboard.press("Escape");

    // ---- 3. O que a rota recusa ----
    console.log("\n3. Recusas");
    expectRejections = true;
    const rejected = await page.evaluate(async () => {
      const send = async (blob, name) => {
        const form = new FormData();
        form.append("file", new File([blob], name, { type: blob.type }));
        return (await fetch("/api/attachments", { method: "POST", body: form })).status;
      };
      return {
        svg: await send(
          new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], {
            type: "image/svg+xml",
          }),
          "x.svg"
        ),
        fake: await send(new Blob(["isto não é um png"], { type: "image/png" }), "falso.png"),
      };
    });
    check("SVG é recusado", rejected.svg === 415, String(rejected.svg));
    check(
      "PNG falso (assinatura errada) é recusado",
      rejected.fake === 400,
      String(rejected.fake)
    );
    expectRejections = false;

    // ---- 4. Lousa: soltar, colar e o botão ----
    console.log("\n4. As três portas da lousa");
    const [workspace] = await query("select id from workspaces where user_id = $1 limit 1", [
      userId,
    ]);
    await page.goto(`${BASE}/workspace/${workspace.id}`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });

    const frame = page.locator("div.relative.min-h-0.flex-1.overflow-clip").first();
    const frameBox = await frame.boundingBox();
    const drop = { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 };

    const transfer = await page.evaluateHandle(
      ({ data }) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], "foto-retrato.jpg", { type: "image/jpeg" }));
        return dt;
      },
      { data: b64("foto-retrato.jpg") }
    );
    await frame.dispatchEvent("dragenter", {
      dataTransfer: transfer,
      clientX: drop.x,
      clientY: drop.y,
    });
    await frame.dispatchEvent("dragover", {
      dataTransfer: transfer,
      clientX: drop.x,
      clientY: drop.y,
    });
    check(
      "arrastar por cima mostra onde soltar",
      await page.getByText("Solte para pôr na lousa").isVisible()
    );
    await page.screenshot({ path: `${OUT}/board-dragover--desktop-light.png` });
    await frame.dispatchEvent("drop", {
      dataTransfer: transfer,
      clientX: drop.x,
      clientY: drop.y,
    });

    const dropped = await poll(
      async () =>
        query(
          `select w.width, w.height, w.x, w.y, a.filename
             from workspace_windows w
             join attachments a on a.id = w.attachment_id
            where w.user_id = $1`,
          [userId]
        ),
      (rows) => rows.length >= 1,
      30000
    );
    check(
      "soltar abre a janela da imagem",
      dropped.length === 1 && dropped[0].filename === "foto-retrato.jpg"
    );
    // 600×900 → escala min(480/600, 524/900) = 0,582 → 352 × (524 + 36)
    check(
      "a janela nasce em pé, na proporção da foto",
      dropped[0] && dropped[0].height > dropped[0].width,
      `${dropped[0]?.width}×${dropped[0]?.height}`
    );

    // Colar um print: o foco precisa estar na lousa, não num campo de texto.
    await page.mouse.click(frameBox.x + 60, frameBox.y + frameBox.height - 60);
    await page.evaluate(
      ({ data }) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], "quadrado.webp", { type: "image/webp" }));
        window.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
        );
      },
      { data: b64("quadrado.webp") }
    );
    const pasted = await poll(
      async () =>
        query(
          `select a.filename from workspace_windows w
             join attachments a on a.id = w.attachment_id
            where w.user_id = $1`,
          [userId]
        ),
      (rows) => rows.length >= 2,
      30000
    );
    check(
      "colar uma imagem também a põe na lousa",
      pasted.some((row) => row.filename === "quadrado.webp")
    );

    await page.setInputFiles(
      'input[type="file"][accept*=".webp"]',
      path.join(images, "recibo-mercado.png")
    );
    const byButton = await poll(
      async () =>
        query(
          `select w.width, w.height from workspace_windows w
             join attachments a on a.id = w.attachment_id
            where w.user_id = $1 and a.filename = 'recibo-mercado.png'`,
          [userId]
        ),
      (rows) => rows.length >= 1,
      30000
    );
    check("o botão Enviar arquivo põe a imagem na lousa", byButton.length === 1);
    check(
      "e a janela de um print deitado nasce deitada",
      byButton[0] && byButton[0].width > byButton[0].height,
      `${byButton[0]?.width}×${byButton[0]?.height}`
    );

    const drawn = () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll("[data-board-window] img")].filter(
            (img) => img.naturalWidth > 0
          ).length
      );
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll("[data-board-window] img")].filter(
            (img) => img.complete && img.naturalWidth > 0
          ).length >= 3,
        null,
        { timeout: 20000 }
      )
      .catch(() => {});
    check("as três imagens aparecem desenhadas na lousa", (await drawn()) >= 3);

    await page.waitForTimeout(500);
    await page
      .getByRole("button", { name: "Enquadrar tudo" })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/board--desktop-light.png` });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/board--desktop-dark.png` });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

    // Recarregar: o arranjo foi para o Postgres, não ficou só na memória.
    await page.reload({ waitUntil: "networkidle" });
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll("[data-board-window] img")].filter(
            (img) => img.complete && img.naturalWidth > 0
          ).length >= 3,
        null,
        { timeout: 20000 }
      )
      .catch(() => {});
    check("e continuam depois de recarregar", (await drawn()) >= 3);

    await page.getByRole("button", { name: "Trazer da conta" }).click();
    await page
      .getByRole("tab", { name: /Arquivos/ })
      .click()
      .catch(async () => page.getByText("Arquivos", { exact: true }).last().click());
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/picker--desktop-light.png` });
    await page.keyboard.press("Escape");

    // ---- 5. O acervo filtra imagens ----
    console.log("\n5. Acervo e celular");
    await page.goto(`${BASE}/dashboard/arquivos`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page
      .getByRole("button", { name: /Imagens/ })
      .first()
      .click();
    await page.waitForTimeout(1500);
    const cards = await page.locator("article").count();
    check("Arquivos → Imagens lista as imagens", cards === 4, String(cards));

    // ---- 6. Celular ----
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/workspace/${workspace.id}`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForTimeout(1500);
    check(
      "no celular o botão de enviar está na barra",
      await page.locator('button[title^="Enviar arquivo"]').isVisible()
    );
    await page.screenshot({ path: `${OUT}/board--mobile-light.png` });
  } catch (err) {
    problems.push(String(err?.stack || err));
  } finally {
    await browser?.close();
    if (userId && !KEEP) {
      const paths = (
        await query("select storage_path from attachments where user_id = $1", [userId])
      ).map((row) => row.storage_path);
      if (paths.length) await admin.storage.from("files").remove(paths);
      await admin.auth.admin.deleteUser(userId);
    }
    await sql.end();
    rmSync(images, { recursive: true, force: true });
    console.log(
      problems.length ? `\nPROBLEMAS:\n${problems.join("\n")}` : `\ntudo certo — imagens em ${OUT}`
    );
    process.exitCode = problems.length ? 1 : 0;
  }
}

await main();
