/**
 * O editor de uma nota derivada de um PDF: o arquivo ao lado, as tags e as
 * referências.
 *
 *   bun run shots:editor            # cria, confere e apaga o usuário
 *   bun run shots:editor -- --keep  # mantém o usuário no fim
 *
 * A nota e o anexo entram direto pelo service role, sem passar pelo upload:
 * o que está em teste aqui é o editor, e a classificação por IA só deixaria o
 * roteiro lento e dependente de chave. O resto é pela interface, e o
 * resultado é conferido no banco.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync } from "node:fs";
import pg from "pg";
import { chromium } from "playwright-core";

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

const OUT = ".impeccable/review/editor";
const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const EMAIL = `qa-editor-${Date.now()}@nexo.test`;
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

/** Um PDF de duas páginas, escrito à mão — o mesmo do `shots:file`. */
function buildPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    null,
  ];
  const streams = {
    4: "BT /F1 28 Tf 60 760 Td (Contrato de prestacao - Acme) Tj ET\nBT /F1 14 Tf 60 700 Td (Vigencia de 12 meses, renovacao automatica.) Tj ET\nBT /F1 14 Tf 60 670 Td (Multa de 20% em caso de rescisao antecipada.) Tj ET",
    7: "BT /F1 28 Tf 60 760 Td (Pagina dois) Tj ET\nBT /F1 14 Tf 60 700 Td (Clausula 7 trata de confidencialidade.) Tj ET",
  };

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i <= objects.length; i++) {
    offsets.push(pdf.length);
    pdf += streams[i]
      ? `${i} 0 obj\n<< /Length ${streams[i].length} >>\nstream\n${streams[i]}\nendstream\nendobj\n`
      : `${i} 0 obj\n${objects[i - 1]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const SUMMARY = [
  "Contrato de prestação de serviços com a Acme, vigência de 12 meses e renovação automática.",
  "Pontos de atenção: multa de 20% na rescisão antecipada e a cláusula 7, de confidencialidade.",
].join("\n\n");

const results = [];
function check(label, ok, detail = "") {
  results.push(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

mkdirSync(OUT, { recursive: true });

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const { data, error } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { display_name: "Pessoa de Teste" },
});
if (error) throw error;
const userId = data.user.id;

const sql = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await sql.connect();

const storagePath = `${userId}/contrato-acme.pdf`;
let browser;

try {
  const pdf = buildPdf();
  const { error: uploadError } = await admin.storage
    .from("files")
    .upload(storagePath, pdf, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;

  const {
    rows: [note],
  } = await sql.query(
    `insert into notes (user_id, title, content, type, source)
     values ($1, 'Contrato Acme — prestação de serviços', $2, 'document', 'ai')
     returning id`,
    [userId, SUMMARY]
  );
  await sql.query(
    `insert into attachments (user_id, note_id, type, storage_path, filename, mime_type, size_bytes)
     values ($1, $2, 'pdf', $3, 'contrato-acme.pdf', 'application/pdf', $4)`,
    [userId, note.id, storagePath, pdf.length]
  );
  // Vocabulário para as sugestões: duas tags que a conta já tem.
  await sql.query(
    `insert into tags (user_id, name, color) values ($1, 'contratos', '2'), ($1, 'jurídico', '5')`,
    [userId]
  );
  // Uma pasta para a ficha trocar, e uma lousa onde a nota já está aberta.
  await sql.query(
    `insert into folders (user_id, name) values ($1, 'Clientes')`,
    [userId]
  );
  const {
    rows: [board],
  } = await sql.query(
    `insert into workspaces (user_id, name) values ($1, 'Contratos 2026') returning id`,
    [userId]
  );
  await sql.query(
    `insert into workspace_windows (user_id, workspace_id, note_id, kind) values ($1, $2, $3, 'note')`,
    [userId, board.id, note.id]
  );

  browser = await chromium.launch({ executablePath: findChrome() });

  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "pt-BR",
      colorScheme: theme,
    });
    await context.addInitScript((value) => {
      try {
        localStorage.setItem("nexo-theme", value);
      } catch {}
    }, theme);
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(m.text());
    });

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard");

    await page.goto(`${BASE}/nota/${note.id}`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(".tiptap");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/nota--desktop-${theme}.png` });

    if (theme === "light") {
      // O arquivo ao lado, pela linha "Origem".
      await page.click("dl button[aria-pressed]");
      const painted = await page
        .waitForFunction(
          () => {
            const canvas = document.querySelector("aside canvas[role='img']");
            return canvas instanceof HTMLCanvasElement && canvas.width > 50;
          },
          null,
          { timeout: 30_000 }
        )
        .then(() => true)
        .catch(() => false);
      check("o PDF abre ao lado da nota", painted);

      // Escrever com o PDF aberto: a nota continua sendo o editor.
      await page.click(".tiptap p:last-of-type");
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Conferir a multa antes de renovar.");

      // Tags: a sugestão da conta e uma nova.
      await page.click('button[aria-label="Adicionar tag"]');
      await page.keyboard.type("con");
      const suggested = await page
        .waitForSelector("[role='option']:has-text('contratos')", {
          timeout: 3000,
        })
        .then(() => true)
        .catch(() => false);
      check("o campo de tags sugere as tags da conta", suggested);
      await page.screenshot({
        path: `${OUT}/tags-sugestao--desktop-light.png`,
      });
      await page.keyboard.press("Enter");
      await page.keyboard.type("renovação");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Escape");

      // A ficha: o workspace onde a nota está e a pasta, trocada ali mesmo.
      const boardChip = await page
        .locator("dl a[href*='/workspace/']:has-text('Contratos 2026')")
        .count();
      check("a ficha mostra o workspace onde a nota está", boardChip === 1);
      await page.click('button[title="Trocar a pasta da nota"]');
      await Promise.all([
        page.waitForResponse((r) => r.url().endsWith("/folder")),
        page.click(
          "[role='dialog'][aria-label='Pasta da nota'] button:has-text('Clientes')"
        ),
      ]);
      const {
        rows: [placed],
      } = await sql.query(
        `select f.name, nf.source from note_folders nf join folders f on f.id = nf.folder_id where nf.note_id = $1`,
        [note.id]
      );
      check(
        "a pasta escolhida na ficha foi gravada",
        placed?.name === "Clientes" && placed?.source === "user",
        JSON.stringify(placed ?? null)
      );

      // A dica de atalho: o nome da ação e as teclas em cápsulas.
      await page.hover('button[aria-keyshortcuts="Control+B"] >> nth=0');
      await page.waitForSelector("[role='tooltip']", { timeout: 2000 });
      const tip = await page.evaluate(() => {
        const node = document.querySelector("[role='tooltip']");
        if (!node) return null;
        return {
          label: node.firstElementChild?.textContent ?? "",
          keys: [...node.querySelectorAll("kbd")].map((k) => k.textContent),
        };
      });
      check(
        "a dica do botão mostra a ação e as teclas separadas",
        tip?.label === "Negrito" && tip?.keys.join("+") === "Ctrl+B",
        JSON.stringify(tip ?? null)
      );
      await page.screenshot({ path: `${OUT}/atalho-dica--desktop-light.png` });
      await page.mouse.move(0, 0);

      // O menu "/" mostra só as teclas: o nome do bloco já é a linha.
      await page.click(".tiptap p >> nth=1");
      await page.keyboard.press("End");
      // O menu só abre depois de um espaço ou no começo da linha.
      await page.keyboard.type(" /");
      await page.waitForSelector("[role='listbox']", { timeout: 3000 });
      await page.screenshot({ path: `${OUT}/menu-barra--desktop-light.png` });
      const slashKeys = await page.evaluate(() => {
        const row = [...document.querySelectorAll("[role='option']")].find(
          (item) => item.textContent.startsWith("Título")
        );
        return [...(row?.querySelectorAll("kbd") ?? [])].map(
          (k) => k.textContent
        );
      });
      check(
        "o menu “/” desenha o atalho em teclas",
        slashKeys.join("+") === "Ctrl+Alt+1",
        slashKeys.join("+") || "sem teclas"
      );
      await page.keyboard.press("Escape");
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");

      // A cor do texto: uma palavra em azul, gravada como nome da paleta.
      await page.click(".tiptap p >> nth=0");
      await page.keyboard.press("Home");
      for (let i = 0; i < "Conferir".length; i++) {
        await page.keyboard.press("Shift+ArrowRight");
      }
      await page.click('button[aria-label="Cor do texto"]');
      await page.click(
        "[role='dialog'][aria-label='Cor do texto'] button[title='Azul']"
      );
      const inked = await page.evaluate(() => {
        const span = document.querySelector(".tiptap [data-text-color='blue']");
        return span
          ? `${span.textContent}|${getComputedStyle(span).color}`
          : null;
      });
      check(
        "a cor do texto pinta a seleção",
        // A cor vem do tema claro (`--nx-ink-blue`), pelo nome gravado.
        inked?.endsWith("|rgb(31, 95, 181)") ?? false,
        inked ?? "sem span"
      );

      // A fonte da nota: JetBrains Mono no corpo e no título (a Literata saiu em ce0f34c).
      await page.click('button[aria-label^="Fonte da nota"]');
      await page.screenshot({ path: `${OUT}/fonte-menu--desktop-light.png` });
      await page.click(
        "[role='dialog'][aria-label='Fonte da nota'] button:has-text('JetBrains Mono')"
      );
      await page.waitForTimeout(600);
      const fonts = await page.evaluate(() => ({
        body: getComputedStyle(document.querySelector(".tiptap")).fontFamily,
        title: getComputedStyle(document.querySelector("#note-title"))
          .fontFamily,
        details: getComputedStyle(document.querySelector("dl")).fontFamily,
      }));
      check(
        "a fonte escolhida vale para o título e o corpo, não para a ficha",
        /JetBrains/i.test(fonts.body) &&
          /JetBrains/i.test(fonts.title) &&
          !/JetBrains/i.test(fonts.details),
        JSON.stringify(fonts)
      );

      // Recolher a ficha: some da tela, o resumo fica na linha.
      await page.click("button[aria-expanded]:has-text('Detalhes')");
      const collapsed = await page.evaluate(() => ({
        hidden:
          getComputedStyle(document.querySelector("dl")).display === "none",
        summary:
          [...document.querySelectorAll("button[aria-expanded='false']")].find(
            (b) => b.textContent.startsWith("Detalhes")
          )?.textContent ?? "",
      }));
      check(
        "a ficha recolhe numa linha de resumo",
        collapsed.hidden && collapsed.summary.includes("contrato-acme.pdf"),
        collapsed.summary
      );
      await page.screenshot({
        path: `${OUT}/ficha-recolhida--desktop-light.png`,
      });
      await page.emulateMedia({ media: "print" });
      const printedDetails = await page.evaluate(
        () => getComputedStyle(document.querySelector("dl")).display !== "none"
      );
      check("recolhida na tela, a ficha ainda vai para o PDF", printedDetails);
      await page.emulateMedia({ media: "screen" });
      await page.click("button[aria-expanded]:has-text('Detalhes')");

      // Referências.
      await page.click("button:has-text('Adicionar referência')");
      await page.fill(
        'input[aria-label="Link"]',
        "planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm"
      );
      await page.fill(
        'input[aria-label="Título (opcional)"]',
        "Código Civil — Lei 10.406/2002"
      );
      await page.keyboard.press("Enter");
      await page.fill('input[aria-label="Link"]', "javascript:alert(1)");
      await page.keyboard.press("Enter");
      const refused = await page
        .waitForSelector("[role='alert']", { timeout: 2000 })
        .then(() => true)
        .catch(() => false);
      check("um link que não é http(s) é recusado", refused);
      await page.fill(
        'input[aria-label="Link"]',
        "https://www.acme.com.br/contratos/prestacao-2026"
      );
      await page.keyboard.press("Enter");
      await page.keyboard.press("Escape");

      await page.waitForTimeout(2000);
      await page.screenshot({
        path: `${OUT}/nota-com-arquivo--desktop-light.png`,
      });
      await page.evaluate(() => {
        document.querySelector(".overflow-y-auto")?.scrollTo(0, 99999);
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/referencias--desktop-light.png` });

      const {
        rows: [saved],
      } = await sql.query(
        "select reference_links, content, content_rich, font from notes where id = $1",
        [note.id]
      );
      check(
        "as referências foram gravadas",
        saved.reference_links.length === 2 &&
          saved.reference_links[0].url.startsWith("https://planalto.gov.br/"),
        JSON.stringify(saved.reference_links.map((r) => r.url))
      );
      check(
        "a fonte e a cor foram gravadas na nota",
        saved.font === "mono" &&
          JSON.stringify(saved.content_rich).includes('"color":"blue"'),
        saved.font
      );
      check(
        "o texto escrito com o PDF aberto foi salvo",
        saved.content.includes("Conferir a multa")
      );
      const { rows: tagRows } = await sql.query(
        "select t.name from note_tags nt join tags t on t.id = nt.tag_id where nt.note_id = $1 order by t.name",
        [note.id]
      );
      check(
        "as tags foram marcadas",
        tagRows.map((r) => r.name).join(",") === "contratos,renovação",
        tagRows.map((r) => r.name).join(", ")
      );

      // O PDF exportado: o chrome some, as referências ficam com a URL.
      await page.emulateMedia({ media: "print" });
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${OUT}/impressao--desktop-light.png`,
        fullPage: true,
      });
      const printed = await page.evaluate(() => {
        const visible = (el) => el && getComputedStyle(el).display !== "none";
        return {
          panel: visible(
            document.querySelector("aside[aria-label^='Arquivo']")
          ),
          fullUrl: [...document.querySelectorAll("section p")].some(
            (p) =>
              visible(p) && p.textContent.startsWith("https://planalto.gov.br/")
          ),
        };
      });
      check("o painel do arquivo não vai para o PDF", !printed.panel);
      check("a URL inteira da referência vai para o PDF", printed.fullUrl);
      await page.pdf?.({ path: `${OUT}/nota.pdf` }).catch(() => {});
      await page.emulateMedia({ media: "screen" });
    } else {
      await page.screenshot({
        path: `${OUT}/nota-com-arquivo--desktop-dark.png`,
      });
    }

    // Celular: o arquivo cobre a nota, e "Nota" volta.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(".tiptap");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/nota--mobile-${theme}.png` });
    await page.click("dl button[aria-pressed]");
    await page
      .waitForSelector("aside canvas[role='img']", { timeout: 30_000 })
      .catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/arquivo--mobile-${theme}.png` });
    if (theme === "light") {
      await page.click("aside button:has-text('Nota')");
      const back = await page
        .waitForSelector("aside[aria-label^='Arquivo']", {
          state: "detached",
          timeout: 3000,
        })
        .then(() => true)
        .catch(() => false);
      check("no celular, “Nota” fecha o arquivo", back);
    }

    const real = [...new Set(problems)].filter(
      (p) => !/favicon|Download the React/i.test(p)
    );
    if (real.length)
      check(`sem erro de console (${theme})`, false, real.join(" | "));
    await context.close();
  }

  console.log(results.join("\n"));
  console.log(`\nImagens em ${OUT}`);
} finally {
  await browser?.close();
  if (!KEEP) {
    await admin.storage.from("files").remove([storagePath]);
    await admin.auth.admin.deleteUser(userId);
  } else {
    console.log(`Usuário mantido: ${EMAIL} / ${PASSWORD}`);
  }
  await sql.end();
}
