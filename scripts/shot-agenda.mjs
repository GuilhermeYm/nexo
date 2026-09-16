/**
 * A Agenda de ponta a ponta, com sessão real.
 *
 *   bun run shots:agenda            # exercita a sala e fotografa
 *   bun run shots:agenda -- --keep  # não apaga o usuário de teste no fim
 *
 * Mesmo contrato de `shot-tags.mjs`: cria um usuário pelo service role, entra
 * pela interface, confere no Postgres e apaga o usuário no fim — o
 * `ON DELETE CASCADE` de `auth.users` leva tudo junto.
 *
 * O que é conferido, e que uma captura de tela **não** provaria:
 *
 *   1. abrir a sala e não escrever nada não gasta captura nenhuma;
 *   2. a primeira tecla cria UMA nota, com `type='task'` e `task_date` igual
 *      ao dia do NAVEGADOR — não ao dia UTC do servidor;
 *   3. marcar a caixa chega ao Postgres, com `tasks_done` derivado batendo,
 *      e sobrevive ao recarregamento;
 *   4. o índice único recusa a segunda lista do mesmo dia (23505);
 *   5. dois PUT simultâneos devolvem a MESMA nota, sem duplicar;
 *   6. apagar a lista libera o dia;
 *   7. a lista do dia não aparece em Recentes, mas aparece na busca — e as
 *      notas comuns continuam em Recentes (um filtro que recusa tudo não
 *      prova nada);
 *   8. uma nota `type='task'` SEM `task_date` — a que a IA cria num upload —
 *      continua em Recentes e não entra na Agenda;
 *   9. o fuso: dois contextos de navegador, UTC+14 e UTC−11, no mesmo
 *      instante de relógio de parede, caem em dias DIFERENTES;
 *  10. data forjada é recusada com 400, sem criar nada;
 *  11. os contadores são do servidor: um PATCH com `tasksDone: 99` não cola;
 *  12. a caixa não sai: Backspace, Enter e apagar tudo não deixam linha sem
 *      caixa no documento;
 *  13. o dashboard avisa quando não há tarefa hoje, e lista as do dia com o
 *      mesmo "x de y" do banco.
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

const OUT = ".impeccable/review/agenda";
const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const EMAIL = `qa-agenda-${Date.now()}@nexo.test`;
const PASSWORD = "SenhaDeTesteForte!2026";
const HIDE_DEV_BADGE = "nextjs-portal{display:none !important}";
/**
 * Onde se clica para escrever.
 *
 * `.tiptap` agora tem a altura do conteúdo — a folga do cartão mora no
 * elemento de fora, justamente para o clique no vazio não cair no gap cursor
 * depois do `<ul>` e virar parágrafo em vez de tarefa. Com isso, o centro do
 * `.tiptap` é a linha da primeira caixa.
 *
 * O `<p>` de dentro do item não serve como alvo: vazio, ele mede 0×26 e o
 * Playwright o considera invisível.
 */
const TASK_LINE = ".tiptap";

function findChrome() {
  const found =
    (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)
      ? process.env.CHROME_PATH
      : null) ?? CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) throw new Error("Chrome não encontrado. Defina CHROME_PATH.");
  return found;
}

function check(problems, label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) problems.push(label);
}

/**
 * Espera o banco chegar no estado esperado, em vez de dormir um tempo fixo.
 * A rota leva de 300ms a 2s conforme o Turbopack já a tenha compilado, e um
 * `waitForTimeout` calibrado na máquina quente falha na fria.
 */
async function waitFor(read, predicate, timeout = 25000) {
  const deadline = Date.now() + timeout;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = await read();
  }
  return value;
}

const agendaRows = (sql, userId) => async () =>
  (
    await sql.query(
      `select id, task_date::text as date, title, tasks_total, tasks_done,
              content, content_rich, status
         from notes
        where user_id = $1 and type = 'task' and task_date is not null
        order by task_date desc`,
      [userId]
    )
  ).rows;

const countNotes = async (sql, userId) =>
  Number(
    (
      await sql.query("select count(*)::int as n from notes where user_id = $1", [
        userId,
      ])
    ).rows[0].n
  );

/** Login pela interface, numa aba nova. Devolve a página. */
async function signIn(context, problems, { expectErrors = false } = {}) {
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" && !expectErrors.value) {
      problems.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 20_000 });
  return page;
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
  // Ligado em volta dos testes que provocam 4xx de propósito, para o ouvinte
  // de console não acusar o erro que o roteiro pediu.
  const expectErrors = { value: false };

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

    // Uma nota comum e uma nota `type='task'` SEM data (a que a IA cria ao
    // classificar um upload). As duas têm de continuar em Recentes.
    await sql.query(
      `insert into notes (user_id, title, content, type, source)
       values ($1, 'Contrato Acme', 'Vigência de 12 meses.', 'document', 'ai'),
              ($1, 'Lista de compras (PDF)', 'Arroz, café, papel.', 'task', 'ai')`,
      [userId]
    );

    browser = await chromium.launch({ executablePath: findChrome() });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
    });
    const page = await signIn(context, problems, { expectErrors });

    /* ---------------------------------------------------------------- */
    /* 1. Dia em branco não gasta captura                                */
    /* ---------------------------------------------------------------- */
    console.log("→ o dashboard, sem tarefa nenhuma");
    await page.waitForSelector("#today-tasks-title", { timeout: 20_000 });
    const emptyShown = await page
      .getByText("Nenhuma tarefa para hoje")
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    check(problems, "o dashboard avisa que ainda não há tarefa hoje", emptyShown);

    console.log("→ a sala, sem escrever nada");
    const before = await countNotes(sql, userId);

    await page.goto(`${BASE}/dashboard/agenda`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(".tiptap", { timeout: 20_000 });
    await page.waitForTimeout(2000);

    check(
      problems,
      "abrir a Agenda sem escrever não gasta captura",
      (await countNotes(sql, userId)) === before,
      `antes ${before}, depois ${await countNotes(sql, userId)}`
    );
    await page.screenshot({ path: `${OUT}/vazia-light.png`, fullPage: true });

    /* ---------------------------------------------------------------- */
    /* 2. A primeira tecla cria uma nota, no dia do NAVEGADOR            */
    /* ---------------------------------------------------------------- */
    console.log("→ escrevendo a primeira tarefa");
    const browserDay = await page.evaluate(() => {
      const now = new Date();
      const pad = (value) => String(value).padStart(2, "0");
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    });

    await page.click(TASK_LINE);
    await page.keyboard.type("Terminar a migration da Agenda");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Escrever o roteiro de ponta a ponta");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Revisar o AGENTS.md");

    const read = agendaRows(sql, userId);
    let rows = await waitFor(read, (value) => value.length === 1);

    check(problems, "a primeira tecla criou exatamente uma lista", rows.length === 1);
    check(
      problems,
      "task_date é o dia do NAVEGADOR",
      rows[0]?.date === browserDay,
      `banco ${rows[0]?.date} × navegador ${browserDay}`
    );
    check(
      problems,
      "a captura foi contada (uma, não duas)",
      (await countNotes(sql, userId)) === before + 1,
      `${await countNotes(sql, userId)} vs ${before + 1}`
    );

    rows = await waitFor(read, (value) => value[0]?.tasks_total === 3);
    check(
      problems,
      "tasks_total derivado no servidor bate com as três caixas",
      rows[0]?.tasks_total === 3,
      `total=${rows[0]?.tasks_total}`
    );
    check(
      problems,
      "o texto puro foi derivado do documento (alimenta a busca)",
      (rows[0]?.content ?? "").includes("migration da Agenda"),
      JSON.stringify(rows[0]?.content ?? "")
    );

    const noteId = rows[0].id;

    /* ---------------------------------------------------------------- */
    /* 3. Marcar a caixa chega ao banco e sobrevive ao recarregamento    */
    /* ---------------------------------------------------------------- */
    console.log("→ marcando a primeira caixa");
    await page.click('ul[data-type="taskList"] li input[type="checkbox"]');

    rows = await waitFor(read, (value) => value[0]?.tasks_done === 1);
    check(
      problems,
      "tasks_done derivado chegou ao Postgres",
      rows[0]?.tasks_done === 1,
      `done=${rows[0]?.tasks_done}`
    );

    const checkedInDoc = JSON.stringify(rows[0]?.content_rich ?? {}).includes(
      '"checked":true'
    );
    check(problems, "content_rich guardou checked: true", checkedInDoc);

    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector('.tiptap li[data-checked="true"]', { timeout: 20_000 });
    check(
      problems,
      "a caixa marcada sobrevive ao recarregamento",
      (await page.$$('.tiptap li[data-checked="true"]')).length === 1
    );
    await page.screenshot({ path: `${OUT}/hoje-light.png`, fullPage: true });

    /* ---------------------------------------------------------------- */
    /* 3b. O dashboard mostra as tarefas de hoje                         */
    /* ---------------------------------------------------------------- */
    console.log("→ as tarefas de hoje no dashboard");
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    const listed = await page
      .getByText("Terminar a migration da Agenda")
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    check(problems, "o dashboard lista as tarefas do dia", listed);
    const counter = await page
      .locator('section[aria-labelledby="today-tasks-title"] header')
      .innerText();
    check(
      problems,
      "o contador do dashboard bate com o banco",
      counter.includes(`${rows[0]?.tasks_done} de ${rows[0]?.tasks_total}`),
      `${JSON.stringify(counter)} × banco ${rows[0]?.tasks_done}/${rows[0]?.tasks_total}`
    );
    await page.screenshot({ path: `${OUT}/dashboard-hoje-light.png`, fullPage: true });

    /* ---------------------------------------------------------------- */
    /* 3c. A caixa não sai: Backspace e Enter não a transformam em texto */
    /* ---------------------------------------------------------------- */
    console.log("→ tentando apagar a caixa");
    await page.goto(`${BASE}/dashboard/agenda`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(".tiptap", { timeout: 20_000 });

    const shape = () =>
      page.evaluate(() => {
        const root = document.querySelector(".tiptap");
        const top = [...root.children].map((child) => child.tagName);
        // O node view do TaskItem não põe `data-type` no `<li>`.
        const items = root.querySelectorAll('ul[data-type="taskList"] > li');
        const withBox = [...items].filter((li) =>
          li.querySelector(':scope > label input[type="checkbox"]')
        );
        return { top, items: items.length, withBox: withBox.length };
      });
    const onlyBoxes = (value) =>
      value.top.every((tag) => tag === "UL") && value.items === value.withBox;
    const press = async (key, times = 1) => {
      for (let i = 0; i < times; i++) {
        await page.keyboard.press(key);
        await page.waitForTimeout(40);
      }
    };

    // Esvazia a última linha e continua apertando: sem a trava, a caixa vazia
    // viraria parágrafo e depois se juntaria à linha de cima.
    await page.locator(".tiptap p", { hasText: "Revisar o AGENTS.md" }).click();
    await press("End");
    await press("Shift+Home");
    await press("Backspace", 6);
    let now = await shape();
    check(
      problems,
      "Backspace não deixa linha sem caixa",
      onlyBoxes(now) && now.items >= 2,
      JSON.stringify(now)
    );

    await press("End");
    await press("Enter");
    const withNewLine = await shape();
    await press("Enter", 3);
    now = await shape();
    check(
      problems,
      "Enter numa caixa vazia não cria linha sem caixa",
      onlyBoxes(now) && now.items === withNewLine.items,
      `${JSON.stringify(withNewLine)} → ${JSON.stringify(now)}`
    );

    await press("Control+A");
    await press("Backspace", 3);
    now = await shape();
    check(
      problems,
      "apagar tudo deixa uma caixa, e não um parágrafo",
      now.top.join() === "UL" && now.items === 1 && now.withBox === 1,
      JSON.stringify(now)
    );

    // Reescreve as três tarefas para o resto do roteiro.
    await page.keyboard.type("Terminar a migration da Agenda");
    await press("Enter");
    await page.keyboard.type("Escrever o roteiro de ponta a ponta");
    await press("Enter");
    await page.keyboard.type("Revisar o AGENTS.md");
    rows = await waitFor(
      read,
      (value) =>
        value[0]?.tasks_total === 3 &&
        (value[0]?.content ?? "").includes("Revisar o AGENTS.md")
    );
    check(
      problems,
      "a lista reescrita chegou ao banco com três caixas",
      rows[0]?.tasks_total === 3,
      `total=${rows[0]?.tasks_total}`
    );

    /* ---------------------------------------------------------------- */
    /* 4 e 5. O índice único, e dois PUT ao mesmo tempo                  */
    /* ---------------------------------------------------------------- */
    console.log("→ a invariante de uma lista por dia");
    let duplicated = null;
    try {
      await sql.query(
        `insert into notes (user_id, title, content, type, source, task_date)
         values ($1, 'Duplicata', 'x', 'task', 'user', $2::date)`,
        [userId, browserDay]
      );
      duplicated = "INSERIU";
    } catch (e) {
      duplicated = e.code;
    }
    check(
      problems,
      "o índice único recusa a segunda lista do mesmo dia",
      duplicated === "23505",
      `código ${duplicated}`
    );

    const amanha = await page.evaluate(async (base) => {
      const now = new Date();
      now.setDate(now.getDate() + 1);
      const pad = (value) => String(value).padStart(2, "0");
      const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const body = JSON.stringify({
        contentRich: {
          type: "doc",
          content: [
            {
              type: "taskList",
              content: [
                {
                  type: "taskItem",
                  attrs: { checked: false },
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "Corrida" }] },
                  ],
                },
              ],
            },
          ],
        },
      });
      const put = () =>
        fetch(`${base}/api/agenda/${day}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        }).then((response) => response.json());
      const [a, b] = await Promise.all([put(), put()]);
      return { day, idA: a?.note?.id ?? null, idB: b?.note?.id ?? null };
    }, BASE);

    check(
      problems,
      "dois PUT simultâneos devolvem a MESMA nota",
      Boolean(amanha.idA) && amanha.idA === amanha.idB,
      `${amanha.idA} × ${amanha.idB}`
    );
    const forDay = await sql.query(
      "select count(*)::int as n from notes where user_id = $1 and task_date = $2::date and status <> 'deleted'",
      [userId, amanha.day]
    );
    check(
      problems,
      "e só existe uma linha para aquele dia",
      Number(forDay.rows[0].n) === 1,
      `linhas: ${forDay.rows[0].n}`
    );

    /* ---------------------------------------------------------------- */
    /* 6. Apagar libera o dia                                            */
    /* ---------------------------------------------------------------- */
    console.log("→ apagar e recriar o mesmo dia");
    await sql.query("update notes set status = 'deleted' where id = $1", [
      amanha.idA,
    ]);
    let reborn = null;
    try {
      await sql.query(
        `insert into notes (user_id, title, content, type, source, task_date)
         values ($1, 'Renascida', 'x', 'task', 'user', $2::date)`,
        [userId, amanha.day]
      );
      reborn = "OK";
    } catch (e) {
      reborn = e.code;
    }
    check(
      problems,
      "apagar a lista libera o dia para uma nova",
      reborn === "OK",
      `resultado ${reborn}`
    );
    await sql.query(
      "delete from notes where user_id = $1 and task_date = $2::date",
      [userId, amanha.day]
    );

    /* ---------------------------------------------------------------- */
    /* 7 e 8. Recentes x busca, e a nota de tarefa sem data              */
    /* ---------------------------------------------------------------- */
    console.log("→ Recentes, busca e a tarefa sem data");
    const recent = await page.evaluate(
      async (base) =>
        (await fetch(`${base}/api/notes/recent`, { cache: "no-store" }).then((r) =>
          r.json()
        ))?.notes ?? [],
      BASE
    );
    const recentIds = recent.map((note) => note.id);
    const recentTitles = recent.map((note) => note.title);

    check(
      problems,
      "a lista do dia NÃO aparece em Recentes",
      !recentIds.includes(noteId),
      recentTitles.join(" | ")
    );
    check(
      problems,
      "a nota comum continua em Recentes",
      recentTitles.includes("Contrato Acme")
    );
    check(
      problems,
      "a nota type=task SEM data continua em Recentes",
      recentTitles.includes("Lista de compras (PDF)"),
      "é captura de verdade — o discriminador é a data, não o tipo"
    );

    const found = await page.evaluate(
      async (base) =>
        (await fetch(`${base}/api/search?q=migration`, { cache: "no-store" }).then(
          (r) => r.json()
        ))?.notes ?? [],
      BASE
    );
    check(
      problems,
      "mas a lista do dia É achável pela busca",
      found.some((note) => note.id === noteId),
      found.map((note) => note.title).join(" | ")
    );

    // A faixa tem de ser válida: `agendaDateSchema` recusa data a mais de 370
    // dias, e um `from=2000-01-01` voltaria 400 — a Agenda pareceria vazia
    // porque a requisição falhou, não porque o filtro funcionou. Uma checagem
    // que recusa tudo não prova nada.
    const agendaList = await page.evaluate(
      async ({ base, day }) => {
        const shift = (amount) => {
          const [y, m, d] = day.split("-").map(Number);
          const probe = new Date(Date.UTC(y, m - 1, d));
          probe.setUTCDate(probe.getUTCDate() + amount);
          const pad = (value) => String(value).padStart(2, "0");
          return `${probe.getUTCFullYear()}-${pad(probe.getUTCMonth() + 1)}-${pad(
            probe.getUTCDate()
          )}`;
        };
        const response = await fetch(
          `${base}/api/agenda?from=${shift(-35)}&to=${shift(1)}`,
          { cache: "no-store" }
        );
        return { status: response.status, days: (await response.json())?.days ?? [] };
      },
      { base: BASE, day: browserDay }
    );

    check(
      problems,
      "a faixa da Agenda responde 200",
      agendaList.status === 200,
      `status ${agendaList.status}`
    );
    check(
      problems,
      "a lista de hoje ESTÁ na Agenda",
      agendaList.days.some((day) => day.date === browserDay),
      agendaList.days.map((day) => day.date).join(", ") || "nenhum dia"
    );
    check(
      problems,
      "a tarefa sem data NÃO entra na Agenda",
      agendaList.days.every((day) => day.title !== "Lista de compras (PDF)"),
      `${agendaList.days.length} dia(s) na faixa`
    );

    /* ---------------------------------------------------------------- */
    /* 9. O fuso — a prova que não aparece numa máquina só               */
    /* ---------------------------------------------------------------- */
    console.log("→ dois fusos, o mesmo instante");
    const days = {};
    for (const [zone, label] of [
      ["Pacific/Kiritimati", "leste"], // UTC+14
      ["Pacific/Niue", "oeste"], // UTC−11
    ]) {
      const zoned = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale: "pt-BR",
        timezoneId: zone,
      });
      const zonedPage = await signIn(zoned, problems, { expectErrors });
      await zonedPage.goto(`${BASE}/dashboard/agenda`, { waitUntil: "networkidle" });
      await zonedPage.waitForSelector(".tiptap", { timeout: 20_000 });
      await zonedPage.click(TASK_LINE);
      // O fuso oeste pode cair no MESMO dia do contexto principal, que já tem
      // linhas escritas. Ir para o fim antes de digitar deixa o roteiro
      // determinístico nos dois casos.
      await zonedPage.keyboard.press("Control+End");
      await zonedPage.keyboard.press("Enter");
      await zonedPage.keyboard.type(`Tarefa do ${label}`);
      await waitFor(read, (value) =>
        value.some((row) => (row.content ?? "").includes(`do ${label}`))
      );
      const rowsNow = await read();
      days[label] = rowsNow.find((row) =>
        (row.content ?? "").includes(`do ${label}`)
      )?.date;
      await zoned.close();
    }

    check(
      problems,
      "UTC+14 e UTC−11 caem em dias DIFERENTES",
      Boolean(days.leste) && Boolean(days.oeste) && days.leste !== days.oeste,
      `leste ${days.leste} × oeste ${days.oeste}`
    );

    /* ---------------------------------------------------------------- */
    /* 10. Data forjada                                                  */
    /* ---------------------------------------------------------------- */
    console.log("→ datas forjadas");
    expectErrors.value = true;
    const countBeforeForge = await countNotes(sql, userId);
    const forged = await page.evaluate(async (base) => {
      const body = JSON.stringify({
        contentRich: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "forjado" }] },
          ],
        },
      });
      const results = {};
      for (const day of ["1999-01-01", "2026-02-31", "nao-e-data"]) {
        const response = await fetch(`${base}/api/agenda/${day}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        });
        results[day] = response.status;
      }
      return results;
    }, BASE);
    // Os eventos de console do Playwright chegam com atraso: desligar a
    // tolerância no mesmo tick deixaria o 400 que o roteiro pediu vazar para
    // a lista de problemas.
    await page.waitForTimeout(700);
    expectErrors.value = false;

    check(
      problems,
      "data fora da faixa é recusada com 400",
      forged["1999-01-01"] === 400,
      `status ${forged["1999-01-01"]}`
    );
    check(
      problems,
      "31 de fevereiro é recusado com 400 (e não vira 500 do Postgres)",
      forged["2026-02-31"] === 400,
      `status ${forged["2026-02-31"]}`
    );
    check(
      problems,
      "texto que não é data é recusado com 400",
      forged["nao-e-data"] === 400,
      `status ${forged["nao-e-data"]}`
    );
    check(
      problems,
      "e nenhuma das três criou nota",
      (await countNotes(sql, userId)) === countBeforeForge
    );

    /* ---------------------------------------------------------------- */
    /* 11. Os contadores são do servidor                                 */
    /* ---------------------------------------------------------------- */
    console.log("→ contador forjado");
    await page.evaluate(
      async ({ base, id }) => {
        await fetch(`${base}/api/notes/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tasksDone: 99,
            tasksTotal: 99,
            contentRich: {
              type: "doc",
              content: [
                {
                  type: "taskList",
                  content: [
                    {
                      type: "taskItem",
                      attrs: { checked: true },
                      content: [
                        { type: "paragraph", content: [{ type: "text", text: "só uma" }] },
                      ],
                    },
                  ],
                },
              ],
            },
          }),
        });
      },
      { base: BASE, id: noteId }
    );

    rows = await waitFor(read, (value) => {
      const row = value.find((item) => item.id === noteId);
      return row?.tasks_total === 1;
    });
    const forgedRow = rows.find((row) => row.id === noteId);
    check(
      problems,
      "PATCH com tasksDone: 99 não cola — o servidor derivou 1 de 1",
      forgedRow?.tasks_total === 1 && forgedRow?.tasks_done === 1,
      `total=${forgedRow?.tasks_total} done=${forgedRow?.tasks_done}`
    );

    /* ---------------------------------------------------------------- */
    /* Fotos                                                             */
    /* ---------------------------------------------------------------- */
    await page.goto(`${BASE}/dashboard/agenda`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(".tiptap", { timeout: 20_000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/agenda-light.png`, fullPage: true });

    await page.evaluate(() => {
      try {
        localStorage.setItem("nexo-theme", "dark");
      } catch {}
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/agenda-dark.png`, fullPage: true });

    console.log(
      problems.length
        ? `\nProblemas:\n  ${[...new Set(problems)].join("\n  ")}`
        : "\nNenhum problema."
    );
    console.log(`\nImagens em ${OUT}`);
    if (problems.length) process.exitCode = 1;
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
