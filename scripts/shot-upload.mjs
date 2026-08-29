/**
 * Teste de ponta a ponta da classificação por IA.
 *
 *   bun run shots:upload
 *
 * Sobe um arquivo pela interface — o caminho real, pela barra de comando do
 * dashboard — e confere no banco que a nota criada veio do **modelo**, não do
 * stub determinístico. É essa diferença que o teste existe para provar: sem
 * ela, uma chave errada passaria despercebida, porque a interface fica igual
 * nos dois casos.
 *
 * Cria o usuário pelo service role e apaga no fim. Roda com
 * `node --env-file=.env.local --env-file=.env`.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { chromium } from "playwright-core";

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

const OUT = ".impeccable/review/upload";
const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const EMAIL = `qa-upload-${Date.now()}@nexo.test`;
const PASSWORD = "SenhaDeTesteForte!2026";
const HIDE_DEV_BADGE = "nextjs-portal{display:none !important}";

/**
 * O arquivo de teste.
 *
 * Escrito para ter respostas verificáveis: é claramente uma ata de reunião
 * (`noteType: "meeting"`), tem assuntos que geram tags previsíveis e contém
 * um detalhe específico — o prazo — que só aparece no resumo se o modelo
 * realmente leu o conteúdo em vez de chutar pelo nome do arquivo.
 */
const SAMPLE = `ATA — Reunião de produto, 12 de março

Presentes: Guilherme, Marina, Téo.

1. Ficou decidido que o classificador de capturas passa a escolher o workspace
sozinho. Hoje ele devolve apenas título, resumo, tipo e tags, e a landing
promete mais do que isso. Guilherme fecha a lacuna até o fim do mês.

2. Marina levantou que a busca semântica não entra antes do faturamento
começar: o custo de embedding por captura inviabiliza o plano gratuito.
Fica para depois do Stripe ligado.

3. Téo vai medir a latência de classificação em três provedores antes da
troca. Prazo: sexta-feira.

Pendências: responder as seis perguntas que sobraram do FAQ e confirmar os
preços antes de publicar a página de planos.
`;

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
  const samplePath = path.resolve(OUT, "ata-reuniao-produto.txt");
  writeFileSync(samplePath, SAMPLE, "utf8");

  const provider = process.env.GROQ_API_KEY
    ? `Groq (${process.env.GROQ_MODEL ?? "openai/gpt-oss-120b"})`
    : process.env.OPENAI_API_KEY
      ? `OpenAI (${process.env.OPENAI_MODEL ?? "gpt-4o-mini"})`
      : "nenhum — o stub vai responder";
  console.log("provedor configurado:", provider);

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
  const results = [];
  const problems = [];

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

    browser = await chromium.launch({ executablePath: findChrome() });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      locale: "pt-BR",
    });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 20_000 });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForTimeout(900);

    // O caminho real: o input de arquivo da barra de comando.
    const started = Date.now();
    await page.setInputFiles('input[type="file"]', samplePath);

    // A nota aparece quando a classificação termina — é o próprio sinal de
    // conclusão, melhor que cronometrar.
    const appeared = await page
      .waitForFunction(
        () => /reuni[ãa]o de produto/i.test(document.body.innerText),
        null,
        { timeout: 60_000 }
      )
      .then(() => true)
      .catch(() => false);
    const elapsed = Date.now() - started;

    check("o upload cria a nota no dashboard", appeared, `${elapsed}ms`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/dashboard-apos-upload.png` });

    const { rows } = await sql.query(
      `select n.title, n.content, n.type, n.source,
              (select array_agg(t.name order by t.name)
                 from note_tags nt join tags t on t.id = nt.tag_id
                where nt.note_id = n.id) as tags
         from notes n
        where n.user_id = $1
        order by n.created_at desc
        limit 1`,
      [userId]
    );
    const note = rows[0];

    if (!note) {
      check("a nota chegou ao banco", false);
    } else {
      console.log("\n--- o que o modelo devolveu ---");
      console.log("título:", note.title);
      console.log("tipo  :", note.type);
      console.log("tags  :", (note.tags ?? []).join(", "));
      console.log("resumo:", (note.content ?? "").slice(0, 260));
      console.log("-------------------------------\n");

      // O stub devolve o nome do arquivo como título, tipo "document" e a
      // tag "a-classificar". Qualquer um desses é sinal de que a IA não
      // respondeu — e é exatamente o que este teste precisa distinguir.
      const usedStub =
        (note.tags ?? []).includes("a-classificar") ||
        note.title.includes("ata-reuniao-produto");

      check("a classificação veio do modelo, não do stub", !usedStub);
      check(
        "reconheceu que é uma ata de reunião",
        note.type === "meeting",
        note.type
      );
      check(
        "as tags saíram sem acento, como o prompt pede",
        (note.tags ?? []).length > 0 &&
          (note.tags ?? []).every((tag) => !/[áàâãéêíóôõúç]/i.test(tag)),
        (note.tags ?? []).join(", ")
      );
      check(
        "o resumo mostra que o conteúdo foi lido",
        /sexta|workspace|sem[âa]ntica|Stripe/i.test(note.content ?? ""),
        `${(note.content ?? "").length} chars`
      );
      check(
        "a autoria da IA fica registrada",
        note.source === "ai",
        note.source
      );
    }

    // A tarefa também precisa aparecer no feed de Tarefas.
    const { rows: jobs } = await sql.query(
      "select kind, status, label from ai_jobs where user_id = $1 order by created_at desc limit 3",
      [userId]
    );
    check(
      "o trabalho entra no feed de Tarefas",
      jobs.length > 0,
      jobs.map((j) => `${j.kind}:${j.status}`).join(" ")
    );

    console.log(results.join("\n"));
    const pageErrors = problems.filter((p) => p.startsWith("pageerror"));
    console.log(
      pageErrors.length
        ? `\nErros de página:\n  ${pageErrors.join("\n  ")}`
        : "\nNenhum erro de página."
    );
    console.log(`\nImagens em ${OUT}`);
  } finally {
    await browser?.close();
    rmSync(samplePath, { force: true });
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
