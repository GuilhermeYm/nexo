/**
 * Sobe um PDF de verdade, abre a nota na lousa e abre o **arquivo** ao lado.
 * Apagado ao fim junto com o usuário de teste.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { chromium } from "playwright-core";

const CH = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
].find(existsSync);
const OUT = ".impeccable/review/attachment";
const BASE = "http://localhost:3000";
const EMAIL = `qa-pdf-${Date.now()}@nexo.test`;
const PASSWORD = "SenhaDeTesteForte!2026";
const HIDE = "nextjs-portal{display:none !important}";

/**
 * Um PDF mínimo, escrito à mão.
 *
 * Duas páginas com texto visível: dá para conferir que a primeira foi
 * desenhada e que a navegação chega à segunda — que é o que distingue "o
 * visualizador abriu" de "o visualizador funciona".
 */
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
    4: "BT /F1 28 Tf 60 760 Td (Contrato de prestacao - Acme) Tj ET\nBT /F1 14 Tf 60 700 Td (Vigencia de 12 meses, renovacao automatica.) Tj ET",
    7: "BT /F1 28 Tf 60 760 Td (Pagina dois) Tj ET\nBT /F1 14 Tf 60 700 Td (Clausula 7 trata de confidencialidade.) Tj ET",
  };

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i <= objects.length; i++) {
    offsets.push(pdf.length);
    if (streams[i]) {
      pdf += `${i} 0 obj\n<< /Length ${streams[i].length} >>\nstream\n${streams[i]}\nendstream\nendobj\n`;
    } else {
      pdf += `${i} 0 obj\n${objects[i - 1]}\nendobj\n`;
    }
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

mkdirSync(OUT, { recursive: true });
const pdfPath = path.resolve(OUT, "contrato-acme.pdf");
writeFileSync(pdfPath, buildPdf());

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const { data, error } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { display_name: "Guilherme Moura" },
});
if (error) throw error;
const sql = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await sql.connect();

const browser = await chromium.launch({ executablePath: CH });
const results = [];
function check(label, ok, detail = "") {
  results.push(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
  });
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
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(800);

  await page.setInputFiles('input[type="file"]', pdfPath);
  const arrived = await page
    .waitForFunction(() => /contrato/i.test(document.body.innerText), null, {
      timeout: 90_000,
    })
    .then(() => true)
    .catch(() => false);
  check("o PDF sobe e vira nota", arrived);

  // A nota entra antes do anexo na rota de upload, então esperar a nota
  // aparecer não garante que a linha do anexo já exista.
  let att = [];
  for (let tentativa = 0; tentativa < 20 && att.length === 0; tentativa++) {
    ({ rows: att } = await sql.query(
      "select id, type, filename from attachments where user_id = $1",
      [data.user.id]
    ));
    if (att.length === 0) await new Promise((r) => setTimeout(r, 500));
  }
  check(
    "o anexo foi registrado como pdf",
    att[0]?.type === "pdf",
    `${att[0]?.filename ?? "—"} / ${att[0]?.type ?? "—"}`
  );

  // Abre a nota na lousa, e de lá o arquivo.
  await page.click('a[href^="/workspace/"]');
  await page.waitForURL("**/workspace/**");
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(1200);

  await page.click('button[title^="Trazer da conta"]');
  await page.waitForSelector("aside[aria-label='Trazer da conta'] li button");
  await page.click("aside[aria-label='Trazer da conta'] li button");
  await page.waitForTimeout(1500);
  await page.waitForFunction(
    () => document.querySelectorAll("article[class*='group/window']").length === 1,
    null,
    { timeout: 20_000 }
  );

  // Botão direito na janela da nota → "Abrir o arquivo".
  const handle = await page.$('button[aria-label^="Mover "]');
  const box = await handle.boundingBox();
  await page.mouse.click(box.x + 40, box.y + 4, { button: "right" });
  await page.waitForSelector("[role='menu']", { timeout: 5000 });
  const hasItem = await page
    .waitForSelector("[role='menu'] [role='menuitem']:has-text('Abrir o arquivo')", {
      timeout: 3000,
    })
    .then(() => true)
    .catch(() => false);
  check("a nota do arquivo oferece abrir o documento", hasItem);
  await page.screenshot({ path: `${OUT}/menu-abrir-arquivo.png` });

  if (hasItem) {
    await page.click("[role='menu'] [role='menuitem']:has-text('Abrir o arquivo')");
    const opened = await page
      .waitForFunction(
        () =>
          document.querySelectorAll("article[class*='group/window']").length === 2,
        null,
        { timeout: 20_000 }
      )
      .then(() => true)
      .catch(() => false);
    check("a janela do arquivo abre na lousa", opened);
  }

  // O canvas do pdf.js precisa existir e ter pixels.
  const painted = await page
    .waitForFunction(
      () => {
        const canvas = document.querySelector("canvas[role='img']");
        return canvas instanceof HTMLCanvasElement && canvas.width > 50;
      },
      null,
      { timeout: 30_000 }
    )
    .then(() => true)
    .catch(() => false);
  check("o pdf.js desenhou a página", painted);

  const pages = await page
    .$eval("canvas[role='img']", (n) => n.getAttribute("aria-label"))
    .catch(() => null);
  check("o visualizador reconhece as duas páginas", pages === "Página 1 de 2", pages ?? "—");

  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/lousa-com-pdf-light.png` });

  // Vai para a página dois.
  const next = await page.$('button[title="Próxima página"]');
  if (next) {
    await next.click();
    await page.waitForTimeout(900);
    const label = await page.$eval("canvas[role='img']", (n) =>
      n.getAttribute("aria-label")
    );
    check("a navegação chega à página dois", label === "Página 2 de 2", label);
    await page.screenshot({ path: `${OUT}/pdf-pagina-2.png` });
  }

  const { rows: win } = await sql.query(
    "select kind, attachment_id is not null as tem_anexo from workspace_windows where user_id = $1 and kind = 'attachment'",
    [data.user.id]
  );
  check(
    "a janela de anexo está no banco",
    win.length === 1 && win[0].tem_anexo === true
  );

  console.log(results.join("\n"));
  const real = [...new Set(problems)].filter((p) => !/favicon|Download the React/i.test(p));
  console.log(real.length ? `\nErros:\n  ${real.join("\n  ")}` : "\nNenhum erro de console.");
  console.log(`\nImagens em ${OUT}`);
} finally {
  await browser.close();
  rmSync(pdfPath, { force: true });
  await admin.auth.admin.deleteUser(data.user.id);
  await sql.end();
}
